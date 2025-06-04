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

// Helper function to generate IV
function generateIV() {
    return crypto.randomBytes(16);
}

// Helper function to get encryption key
function getKey(key) {
    // Create a consistent 32-byte key using SHA-256
    return crypto.createHash('sha256').update(key).digest();
}

// Helper function to encrypt file chunks
function encryptChunk(chunk, key) {
    try {
        // Use new encryption method with IV
        const iv = generateIV();
        const cipher = crypto.createCipheriv('aes-256-cbc', getKey(key), iv);
        const encrypted = Buffer.concat([cipher.update(chunk), cipher.final()]);
        // Store IV with encrypted data and add a marker to indicate new encryption method
        return Buffer.concat([Buffer.from([1]), iv, encrypted]); // 1 indicates new method
    } catch (error) {
        console.error('Encryption error:', error);
        throw new Error(`Failed to encrypt chunk: ${error.message}`);
    }
}

// Helper function to decrypt file chunks
function decryptChunk(chunk, key) {
    try {
        if (!Buffer.isBuffer(chunk)) {
            throw new Error('Chunk must be a Buffer');
        }

        if (chunk.length === 0) {
            throw new Error('Empty chunk received');
        }

        // Check if it's using new encryption method (has marker byte)
        if (chunk[0] === 1) {
            if (chunk.length < 18) { // 1 byte marker + 16 bytes IV + at least 1 byte data
                throw new Error('Chunk too small for new encryption format');
            }
            // New method: [marker(1)][iv(16)][encrypted data]
            const iv = chunk.slice(1, 17);
            const encryptedData = chunk.slice(17);
            const decipher = crypto.createDecipheriv('aes-256-cbc', getKey(key), iv);
            return Buffer.concat([decipher.update(encryptedData), decipher.final()]);
        } else {
            // Old method: legacy decryption
            try {
                const decipher = crypto.createDecipher('aes-256-cbc', key);
                return Buffer.concat([decipher.update(chunk), decipher.final()]);
            } catch (legacyError) {
                console.error('Legacy decryption failed:', legacyError);
                // If legacy decryption fails, try with the hashed key
                const decipher = crypto.createDecipher('aes-256-cbc', getKey(key).toString('hex'));
                return Buffer.concat([decipher.update(chunk), decipher.final()]);
            }
        }
    } catch (error) {
        console.error('Decryption error details:', {
            chunkLength: chunk.length,
            firstBytes: chunk.slice(0, 5).toString('hex'),
            error: error.message
        });
        throw new Error(`Failed to decrypt chunk: ${error.message}`);
    }
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
    let fileHandle;
    try {
        const fileData = JSON.parse(await fs.readFile(DB_PATH, 'utf8'));
        const file = fileData.files.find(f => f.id === req.params.fileId);

        if (!file) {
            console.error(`File not found with ID: ${req.params.fileId}`);
            return res.status(404).json({ error: 'File not found' });
        }

        console.log('=== Download Debug Info ===');
        console.log(`File: ${file.originalName}`);
        console.log(`Total size: ${file.size} bytes`);
        console.log(`Total chunks: ${file.chunks.length}`);
        console.log(`Chunk paths:`, file.chunks);

        // Set headers for streaming
        res.setHeader('Content-Type', file.mimeType);
        res.setHeader('Content-Disposition', `attachment; filename="${file.originalName}"`);
        res.setHeader('Content-Length', file.size);

        // Handle client disconnect
        req.on('close', () => {
            console.log('[Download] Client disconnected during download');
            if (fileHandle) {
                fileHandle.close().catch(err => console.error('[Download] Error closing file handle:', err));
            }
        });

        // Process each chunk
        for (let i = 0; i < file.chunks.length; i++) {
            const chunkPath = file.chunks[i];
            console.log(`[Download] Processing chunk ${i + 1}/${file.chunks.length}: ${chunkPath}`);
            
            try {
                // Verify chunk exists and get its size
                const chunkStats = await fs.stat(chunkPath);
                console.log(`[Download] Chunk ${i + 1} size: ${chunkStats.size} bytes`);
                
                if (chunkStats.size === 0) {
                    throw new Error(`Chunk ${i + 1} is empty`);
                }

                if (!fsSync.existsSync(chunkPath)) {
                    throw new Error(`Chunk file does not exist: ${chunkPath}`);
                }

                // Read the entire chunk file
                const encryptedChunk = await fs.readFile(chunkPath);
                console.log(`[Download] Read chunk ${i + 1}, size: ${encryptedChunk.length} bytes`);

                // Decrypt the entire chunk at once
                const decryptedChunk = decryptChunk(encryptedChunk, process.env.ENCRYPTION_KEY || 'default-key');
                console.log(`[Download] Decrypted chunk ${i + 1}, size: ${decryptedChunk.length} bytes`);

                // Write the decrypted chunk to the response
                res.write(decryptedChunk);
                console.log(`[Download] Wrote chunk ${i + 1} to response`);

            } catch (error) {
                console.error(`[Download] Failed to process chunk ${i + 1}:`, {
                    error: error.message,
                    stack: error.stack,
                    chunkPath,
                    chunkNumber: i + 1
                });
                throw error;
            }
        }

        console.log('[Download] All chunks processed successfully');
        res.end();
    } catch (error) {
        console.error('[Download] Download failed:', {
            error: error.message,
            stack: error.stack,
            fileId: req.params.fileId
        });
        if (!res.headersSent) {
            res.status(500).json({ 
                error: 'Download failed',
                message: process.env.NODE_ENV === 'development' ? error.message : 'Failed to download file'
            });
        }
    } finally {
        if (fileHandle) {
            try {
                await fileHandle.close();
            } catch (err) {
                console.error('[Download] Error closing file handle in finally block:', err);
            }
        }
    }
});

// List all files
router.get('/list', async (req, res) => {
    try {
        const fileData = JSON.parse(await fs.readFile(DB_PATH, 'utf8'));
        const files = fileData.files.map(({ id, originalName, size, mimeType, uploadedAt }) => ({
            id,
            originalName,
            size,
            mimeType,
            uploadedAt
        }));
        
        res.json(files);
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