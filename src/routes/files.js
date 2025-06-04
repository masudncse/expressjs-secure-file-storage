const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const crypto = require('crypto');

const CHUNK_SIZE = parseInt(process.env.CHUNK_SIZE) || 1024 * 1024; // 1MB chunks
const UPLOAD_DIR = path.join(__dirname, '../../uploads');
const DB_PATH = path.join(__dirname, '../data/files.json');

// Ensure files.json exists
async function ensureFilesFile() {
    try {
        await fs.access(DB_PATH);
    } catch {
        await fs.writeFile(DB_PATH, JSON.stringify({ files: [] }));
    }
}

// Configure multer for file upload
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, UPLOAD_DIR);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ storage });

// Helper function to encrypt file chunks
function encryptChunk(chunk, key) {
    const cipher = crypto.createCipher('aes-256-cbc', key);
    return Buffer.concat([cipher.update(chunk), cipher.final()]);
}

// Helper function to decrypt file chunks
function decryptChunk(chunk, key) {
    const decipher = crypto.createDecipher('aes-256-cbc', key);
    return Buffer.concat([decipher.update(chunk), decipher.final()]);
}

// Upload file with chunking
router.post('/upload', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        await ensureFilesFile();
        const filePath = req.file.path;
        const fileStats = await fs.stat(filePath);
        const totalChunks = Math.ceil(fileStats.size / CHUNK_SIZE);
        
        // Create chunks directory
        const chunksDir = path.join(UPLOAD_DIR, path.basename(filePath, path.extname(filePath)));
        await fs.mkdir(chunksDir, { recursive: true });

        // Read and split file into chunks
        const fileHandle = await fs.open(filePath, 'r');
        const chunks = [];

        for (let i = 0; i < totalChunks; i++) {
            const buffer = Buffer.alloc(CHUNK_SIZE);
            const { bytesRead } = await fileHandle.read(buffer, 0, CHUNK_SIZE, i * CHUNK_SIZE);
            
            if (bytesRead === 0) break;

            const chunk = buffer.slice(0, bytesRead);
            const encryptedChunk = encryptChunk(chunk, process.env.ENCRYPTION_KEY || 'default-key');
            const chunkPath = path.join(chunksDir, `chunk-${i}`);
            
            await fs.writeFile(chunkPath, encryptedChunk);
            chunks.push(chunkPath);
        }

        await fileHandle.close();
        await fs.unlink(filePath); // Remove original file

        // Save file metadata
        const fileData = JSON.parse(await fs.readFile(DB_PATH, 'utf8'));
        const fileMetadata = {
            id: Date.now().toString(),
            originalName: req.file.originalname,
            size: fileStats.size,
            mimeType: req.file.mimetype,
            chunks: chunks,
            uploadedBy: req.user.id,
            uploadedAt: new Date().toISOString()
        };

        fileData.files.push(fileMetadata);
        await fs.writeFile(DB_PATH, JSON.stringify(fileData, null, 2));

        res.status(201).json({
            message: 'File uploaded successfully',
            fileId: fileMetadata.id
        });
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ error: 'Error uploading file' });
    }
});

// Stream file download
router.get('/download/:fileId', async (req, res) => {
    try {
        const fileData = JSON.parse(await fs.readFile(DB_PATH, 'utf8'));
        const file = fileData.files.find(f => f.id === req.params.fileId);

        if (!file) {
            return res.status(404).json({ error: 'File not found' });
        }

        // Set headers for streaming
        res.setHeader('Content-Type', file.mimeType);
        res.setHeader('Content-Disposition', `attachment; filename="${file.originalName}"`);
        res.setHeader('Content-Length', file.size);

        // Create a transform stream for decryption
        const decryptStream = new (require('stream').Transform)({
            transform(chunk, encoding, callback) {
                try {
                    const decrypted = decryptChunk(chunk, process.env.ENCRYPTION_KEY || 'default-key');
                    callback(null, decrypted);
                } catch (error) {
                    callback(error);
                }
            }
        });

        // Pipe each chunk through the decrypt stream
        for (const chunkPath of file.chunks) {
            const chunkStream = fsSync.createReadStream(chunkPath);
            await new Promise((resolve, reject) => {
                chunkStream
                    .pipe(decryptStream)
                    .pipe(res, { end: false })
                    .on('error', reject)
                    .on('finish', resolve);
            });
        }

        res.end();
    } catch (error) {
        console.error('Download error:', error);
        res.status(500).json({ error: 'Error downloading file' });
    }
});

// List user's files
router.get('/list', async (req, res) => {
    try {
        const fileData = JSON.parse(await fs.readFile(DB_PATH, 'utf8'));
        const userFiles = fileData.files
            .filter(f => f.uploadedBy === req.user.id)
            .map(({ id, originalName, size, mimeType, uploadedAt }) => ({
                id,
                originalName,
                size,
                mimeType,
                uploadedAt
            }));
        
        res.json(userFiles);
    } catch (error) {
        console.error('List files error:', error);
        res.status(500).json({ error: 'Error listing files' });
    }
});

// Delete file
router.delete('/:fileId', async (req, res) => {
    try {
        const fileData = JSON.parse(await fs.readFile(DB_PATH, 'utf8'));
        const fileIndex = fileData.files.findIndex(f => f.id === req.params.fileId);

        if (fileIndex === -1) {
            return res.status(404).json({ error: 'File not found' });
        }

        const file = fileData.files[fileIndex];
        if (file.uploadedBy !== req.user.id) {
            return res.status(403).json({ error: 'Not authorized to delete this file' });
        }

        // Delete all chunks
        const chunksDir = path.dirname(file.chunks[0]);
        await fs.rm(chunksDir, { recursive: true, force: true });

        // Remove file metadata
        fileData.files.splice(fileIndex, 1);
        await fs.writeFile(DB_PATH, JSON.stringify(fileData, null, 2));

        res.json({ message: 'File deleted successfully' });
    } catch (error) {
        console.error('Delete error:', error);
        res.status(500).json({ error: 'Error deleting file' });
    }
});

module.exports = router; 