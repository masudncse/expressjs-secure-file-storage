# Secure File Storage System

A secure file storage system built with Express.js that implements file chunking, encryption, and streaming capabilities.

## Features

- Secure file upload with chunking (1MB chunks by default)
- File encryption using AES-256-CBC
- Streaming file downloads
- User authentication with JWT
- JSON-based file metadata storage
- Rate limiting and security headers
- File listing and management

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
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
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

### Authentication

- `POST /api/auth/register` - Register a new user
  - Body: `{ "username": "string", "password": "string" }`
  - Returns: JWT token

- `POST /api/auth/login` - Login user
  - Body: `{ "username": "string", "password": "string" }`
  - Returns: JWT token

### Files

- `POST /api/files/upload` - Upload a file
  - Headers: `Authorization: Bearer <token>`
  - Body: Form data with `file` field
  - Returns: File ID

- `GET /api/files/download/:fileId` - Download a file
  - Headers: `Authorization: Bearer <token>`
  - Returns: File stream

- `GET /api/files/list` - List user's files
  - Headers: `Authorization: Bearer <token>`
  - Returns: Array of file metadata

- `DELETE /api/files/:fileId` - Delete a file
  - Headers: `Authorization: Bearer <token>`
  - Returns: Success message

## Security Features

- File encryption using AES-256-CBC
- JWT-based authentication
- Rate limiting
- Security headers (Helmet)
- File chunking for large files
- Secure file deletion

## Project Structure

```
expressjs-secure-file-storage/
├── src/
│   ├── app.js              # Main application file
│   ├── middleware/
│   │   └── auth.js         # Authentication middleware
│   └── routes/
│       ├── auth.js         # Authentication routes
│       └── files.js        # File handling routes
├── uploads/                # File storage directory
├── data/                   # JSON database files
├── .env                    # Environment variables
├── package.json
└── README.md
```

## Security Considerations

1. Change the default JWT secret and encryption key in production
2. Implement proper error handling and logging
3. Consider using a proper database for production use
4. Implement file type validation
5. Add file size limits
6. Implement proper backup strategies

## License

MIT 