# Secure File Storage System

A secure file storage system built with Express.js that implements file chunking, encryption, and streaming capabilities.

## Features

- Secure file upload with chunking (1MB chunks by default)
- File encryption using AES-256-CBC with unique IV per chunk
- Streaming file downloads with chunk-by-chunk decryption
- JSON-based file metadata storage
- File listing and management
- Secure file deletion with chunk cleanup

## Prerequisites

- Node.js (v14 or higher)
- npm (v6 or higher)

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd expressjs-secure-file-storage
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file in the root directory with the following variables:
```
PORT=3000
CHUNK_SIZE=1048576 # 1MB chunks
UPLOAD_DIR=uploads
ENCRYPTION_KEY=your-encryption-key-change-this-in-production
```

## Usage

1. Start the server:
```bash
npm start
```

For development with auto-reload:
```bash
npm run dev
```

## API Endpoints

### Files

- `POST /api/files/upload` - Upload a file
  - Body: Form data with `file` field
  - Returns: `{ message: string, fileId: string }`
  - Process:
    1. File is received and temporarily stored
    2. File is split into chunks (1MB by default)
    3. Each chunk is encrypted with AES-256-CBC and unique IV
    4. Chunks are stored in a dedicated directory
    5. File metadata is saved to JSON database

- `GET /api/files/download/:fileId` - Download a file
  - Returns: File stream with proper headers
  - Process:
    1. Retrieves file metadata
    2. Streams each chunk
    3. Decrypts chunks on-the-fly
    4. Sends decrypted data to client

- `GET /api/files/list` - List all files
  - Returns: Array of file metadata objects
  - Each file object contains:
    - id: string
    - originalName: string
    - size: number
    - mimeType: string
    - uploadedAt: string (ISO date)

- `DELETE /api/files/:fileId` - Delete a file
  - Returns: Success message
  - Process:
    1. Removes all encrypted chunks
    2. Deletes chunk directory
    3. Removes file metadata

## Security Features

- File Encryption:
  - AES-256-CBC encryption for each file chunk
  - Unique Initialization Vector (IV) per chunk
  - Secure key derivation using SHA-256
  - Legacy encryption support for backward compatibility

- File Storage:
  - Files are split into manageable chunks (1MB by default)
  - Original files are immediately deleted after chunking
  - Each file's chunks are stored in a dedicated directory
  - Secure file deletion with complete chunk cleanup

- Data Management:
  - JSON-based metadata storage
  - Atomic file operations
  - Proper error handling and logging
  - File existence verification

## Project Structure

```
expressjs-secure-file-storage/
├── src/
│   ├── app.js              # Main application file
│   ├── routes/
│   │   └── files.js        # File handling routes
│   └── data/
│       └── files.json      # File metadata storage
├── uploads/                # File storage directory
│   └── [file-id]/         # Individual file chunk directories
│       ├── chunk-0        # Encrypted file chunks
│       ├── chunk-1
│       └── ...
├── .env                   # Environment variables
├── package.json
└── README.md
```

## Security Considerations

1. Change the default encryption key in production
2. Implement proper error handling and logging
3. Consider using a proper database for production use
4. Implement file type validation
5. Add file size limits
6. Implement proper backup strategies
7. Consider implementing user authentication for production use
8. Monitor disk space usage
9. Implement rate limiting for API endpoints
10. Add request validation

## License

MIT 