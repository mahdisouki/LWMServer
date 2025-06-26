# Email Attachment Support

This document describes the new email attachment functionality added to the Gmail integration.

## Overview

The system now supports sending, replying to, and forwarding emails with file attachments. All attachment functionality includes:

- **File upload handling** with multer middleware
- **Automatic file cleanup** after sending
- **Error handling** for file processing
- **Detailed logging** for debugging
- **Admin email signature** integration

## New API Endpoints

### 1. Send Email with Attachments
```
POST /api/gmail/send-with-attachments
```

**Form Data:**
- `adminId` (required): Admin ID
- `to` (required): Recipient email address
- `subject` (required): Email subject
- `text` (required): Email content (HTML)
- `attachments` (optional): File uploads (up to 10 files)

### 2. Reply to Email with Attachments
```
POST /api/gmail/reply-with-attachments/:emailId
```

**Form Data:**
- `adminId` (required): Admin ID
- `messageId` (required): Original email message ID
- `replyText` (required): Reply content (HTML)
- `attachments` (optional): File uploads (up to 10 files)

### 3. Forward Email with Attachments
```
POST /api/gmail/forward-with-attachments/:emailId
```

**Form Data:**
- `adminId` (required): Admin ID
- `messageId` (required): Original email message ID
- `forwardTo` (required): Forward recipient email
- `forwardText` (required): Forward message content (HTML)
- `attachments` (optional): File uploads (up to 10 files)

## File Upload Configuration

### Supported File Types
- **Images**: JPEG, PNG, GIF, WebP
- **Documents**: PDF, DOC, DOCX, XLS, XLSX
- **Text**: TXT, HTML, CSV
- **Archives**: ZIP

### File Limits
- **Maximum file size**: 25MB per file
- **Maximum files**: 10 files per email
- **Total size limit**: 250MB per email

### File Storage
- Files are temporarily stored in `temp/attachments/`
- Automatic cleanup after sending or on error
- Unique filenames to prevent conflicts

## Implementation Details

### Backend Changes

#### 1. Gmail Service (`services/gmailService.js`)
- Updated `sendEmail()` function to handle attachments
- Updated `replyToEmail()` function to handle attachments
- Updated `forwardEmail()` function to handle attachments
- Added multipart email formatting for attachments
- Enhanced error handling and logging

#### 2. Gmail Controller (`controllers/gmailCtrl.js`)
- Added multer configuration for file uploads
- New controller methods for attachment handling
- Automatic file cleanup functionality
- Enhanced error handling

#### 3. Gmail Routes (`routes/gmail.js`)
- New routes with multer middleware
- File upload validation
- Authentication integration

### Frontend Integration

To use these endpoints from a frontend application:

```javascript
// Example: Send email with attachment
const formData = new FormData();
formData.append('adminId', adminId);
formData.append('to', 'recipient@example.com');
formData.append('subject', 'Email with Attachment');
formData.append('text', '<p>This email has an attachment.</p>');
formData.append('attachments', fileInput.files[0]);

const response = await fetch('/api/gmail/send-with-attachments', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`
  },
  body: formData
});
```

## Error Handling

The system includes comprehensive error handling:

1. **File Validation Errors**
   - Invalid file types
   - File size exceeded
   - Too many files

2. **Gmail API Errors**
   - Authentication failures
   - Quota exceeded
   - Network issues

3. **File Processing Errors**
   - File read failures
   - Encoding issues
   - Cleanup failures

## Logging

Detailed logging is implemented for debugging:

```javascript
// Example log output
=== SEND EMAIL WITH ATTACHMENTS ===
Request body: { adminId: '...', to: '...', subject: '...', text: '...' }
Files: [{ originalname: 'document.pdf', mimetype: 'application/pdf', size: 1024000 }]
Processing attachment: { filename: 'document.pdf', mimetype: 'application/pdf', size: 1024000 }
Attachment processed successfully: document.pdf
Email sent successfully
Cleaned up file: /path/to/temp/file
```

## Testing

Use the provided test script (`test-attachments.js`) to test the functionality:

1. Update configuration variables
2. Install dependencies: `npm install form-data axios`
3. Run: `node test-attachments.js`

## Security Considerations

1. **File Type Validation**: Only allowed file types are accepted
2. **File Size Limits**: Prevents abuse and server overload
3. **Authentication**: All endpoints require valid authentication
4. **Temporary Storage**: Files are not permanently stored
5. **Automatic Cleanup**: Files are removed after processing

## Troubleshooting

### Common Issues

1. **"File type not allowed"**
   - Check if file type is in the allowed list
   - Verify file extension matches MIME type

2. **"File size exceeded"**
   - Reduce file size or split into multiple files
   - Check server upload limits

3. **"Failed to process attachment"**
   - Check file permissions
   - Verify disk space
   - Check file corruption

4. **"Gmail API error"**
   - Verify Gmail authentication
   - Check API quotas
   - Review Gmail API logs

### Debug Mode

Enable detailed logging by setting `NODE_ENV=development`:

```bash
NODE_ENV=development npm start
```

## Migration Notes

- Existing email endpoints remain unchanged
- New endpoints are additive (no breaking changes)
- Backward compatibility maintained
- Optional attachment support

## Performance Considerations

- Large files may take longer to process
- Multiple attachments increase processing time
- Consider implementing progress indicators for large uploads
- Monitor server disk space usage

## Future Enhancements

Potential improvements:
- Cloud storage integration (AWS S3, Google Cloud Storage)
- File compression for large attachments
- Attachment preview generation
- Drag-and-drop file upload interface
- Progress tracking for file uploads 