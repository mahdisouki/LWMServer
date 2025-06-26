const fs = require('fs');
const FormData = require('form-data');
const axios = require('axios');

// Test configuration
const BASE_URL = 'http://localhost:3000/api/gmail';
const ADMIN_ID = 'your-admin-id-here'; // Replace with actual admin ID
const AUTH_TOKEN = 'your-auth-token-here'; // Replace with actual auth token

// Create a test file for attachment
function createTestFile() {
  const testContent = 'This is a test file for email attachment.\nCreated at: ' + new Date().toISOString();
  const testFilePath = './test-attachment.txt';
  fs.writeFileSync(testFilePath, testContent);
  return testFilePath;
}

// Test sending email with attachment
async function testSendWithAttachment() {
  try {
    console.log('Testing send email with attachment...');
    
    const form = new FormData();
    form.append('adminId', ADMIN_ID);
    form.append('to', 'test@example.com');
    form.append('subject', 'Test Email with Attachment');
    form.append('text', 'This is a test email with an attachment.');
    
    // Add test file as attachment
    const testFilePath = createTestFile();
    form.append('attachments', fs.createReadStream(testFilePath));
    
    const response = await axios.post(`${BASE_URL}/send-with-attachments`, form, {
      headers: {
        ...form.getHeaders(),
        'Authorization': `Bearer ${AUTH_TOKEN}`
      }
    });
    
    console.log('Send with attachment response:', response.data);
    
    // Clean up test file
    fs.unlinkSync(testFilePath);
    
  } catch (error) {
    console.error('Error testing send with attachment:', error.response?.data || error.message);
  }
}

// Test replying to email with attachment
async function testReplyWithAttachment() {
  try {
    console.log('Testing reply email with attachment...');
    
    const form = new FormData();
    form.append('adminId', ADMIN_ID);
    form.append('messageId', 'test-message-id'); // Replace with actual message ID
    form.append('replyText', 'This is a test reply with an attachment.');
    
    // Add test file as attachment
    const testFilePath = createTestFile();
    form.append('attachments', fs.createReadStream(testFilePath));
    
    const response = await axios.post(`${BASE_URL}/reply-with-attachments/test-message-id`, form, {
      headers: {
        ...form.getHeaders(),
        'Authorization': `Bearer ${AUTH_TOKEN}`
      }
    });
    
    console.log('Reply with attachment response:', response.data);
    
    // Clean up test file
    fs.unlinkSync(testFilePath);
    
  } catch (error) {
    console.error('Error testing reply with attachment:', error.response?.data || error.message);
  }
}

// Test forwarding email with attachment
async function testForwardWithAttachment() {
  try {
    console.log('Testing forward email with attachment...');
    
    const form = new FormData();
    form.append('adminId', ADMIN_ID);
    form.append('messageId', 'test-message-id'); // Replace with actual message ID
    form.append('forwardTo', 'forward@example.com');
    form.append('forwardText', 'This is a test forward with an attachment.');
    
    // Add test file as attachment
    const testFilePath = createTestFile();
    form.append('attachments', fs.createReadStream(testFilePath));
    
    const response = await axios.post(`${BASE_URL}/forward-with-attachments/test-message-id`, form, {
      headers: {
        ...form.getHeaders(),
        'Authorization': `Bearer ${AUTH_TOKEN}`
      }
    });
    
    console.log('Forward with attachment response:', response.data);
    
    // Clean up test file
    fs.unlinkSync(testFilePath);
    
  } catch (error) {
    console.error('Error testing forward with attachment:', error.response?.data || error.message);
  }
}

// Run tests
async function runTests() {
  console.log('=== EMAIL ATTACHMENT TESTS ===\n');
  
  await testSendWithAttachment();
  console.log('\n---\n');
  
  await testReplyWithAttachment();
  console.log('\n---\n');
  
  await testForwardWithAttachment();
  console.log('\n=== TESTS COMPLETED ===');
}

// Usage instructions
console.log(`
=== EMAIL ATTACHMENT TEST SCRIPT ===

Before running this script:

1. Update the configuration variables:
   - ADMIN_ID: Your actual admin ID
   - AUTH_TOKEN: Your authentication token
   - BASE_URL: Your server URL (if different)

2. Install required dependencies:
   npm install form-data axios

3. Make sure your server is running on the specified port

4. Run the script:
   node test-attachments.js

The script will:
- Create a test file for attachment
- Test sending email with attachment
- Test replying to email with attachment  
- Test forwarding email with attachment
- Clean up test files after each test

API Endpoints being tested:
- POST /api/gmail/send-with-attachments
- POST /api/gmail/reply-with-attachments/:emailId
- POST /api/gmail/forward-with-attachments/:emailId

Form data fields:
- adminId: Admin ID
- to/forwardTo: Recipient email
- subject: Email subject
- text/replyText/forwardText: Email content
- attachments: File uploads (up to 10 files, 25MB each)

Supported file types:
- Images: JPEG, PNG, GIF, WebP
- Documents: PDF, DOC, DOCX, XLS, XLSX
- Text: TXT, HTML, CSV
- Archives: ZIP

`);

// Uncomment the line below to run tests
// runTests(); 