const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const {
  sendEmail,
  sendTestEmail,
  replyToEmail,
  forwardEmail,
  listMessages,
  searchEmails,
  searchMessagesByName,
  getEmailById,
  markAsRead,
  markAsUnread,
  moveToTrash,
  untrashMessage,
  getAttachment,
  batchModifyMessages,
  batchDeleteMessages,
  listLabels,
  getLabel,
  createLabel,
  updateLabel,
  deleteLabel,
  listThreads,
  getThread,
  getThreadMessagesForClient,
  getThreadLatestMessageForClient,
  getMessageBodyForClient,
  getThreadFullForClient,
  getThreadClassifyPayload,
  modifyThread,
  trashThread,
  untrashThread,
  deleteThread,
  listDrafts,
  getDraft,
  createDraft,
  updateDraft,
  sendDraft,
  deleteDraft,
} = require('../services/gmailService');
const { suggestReplyForThread, suggestReplyForMessage } = require('../services/suggestReplyService');
const { llmOrderForThread } = require('../services/llmOrderService');
const {
  createReplyLog,
  listReplyLogs,
  listThreadReplyLogs,
  getReplyStats,
} = require('../services/emailReplyLogService');
const { pollNewMessagesWithClassification } = require('../services/gmailInboxSync');
const {
  attachStoredAiCategories,
  attachThreadAiCategorySlug,
  listMessagesByAiCategory,
  classifyAndStoreThread,
  listGmailCategories,
} = require('../services/emailClassifierService');
const {
  listAllContacts,
  searchAllContacts,
} = require('../services/peopleService');
const { startWatch, stopWatch } = require('../services/gmailWatchService');
const { renderEmailPdf } = require('../services/mailPdfService');
const {
  createMailSignature: createMailSignatureForAdmin,
  listMailSignatures: listMailSignaturesForAdmin,
} = require('../services/mailSignatureService');
const Admin = require('../models/Admin');
const ScheduledEmail = require('../models/ScheduledEmail');
const { emitToUser } = require('../socket');

const SCHEDULED_ATTACHMENTS_DIR = path.join(__dirname, '../temp/scheduled-attachments');

function moveAttachmentsToScheduledDir(files = [], scheduledEmailId) {
  if (!files.length) return [];

  const targetDir = path.join(SCHEDULED_ATTACHMENTS_DIR, String(scheduledEmailId));
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  return files.map((file) => {
    const destPath = path.join(targetDir, path.basename(file.path));
    try {
      fs.renameSync(file.path, destPath);
    } catch (err) {
      // Fallback to copy + unlink for cross-device moves
      fs.copyFileSync(file.path, destPath);
      try { fs.unlinkSync(file.path); } catch (_) {}
    }
    return {
      path: destPath,
      originalname: file.originalname,
      mimetype: file.mimetype,
      size: file.size,
    };
  });
}

function cleanupScheduledAttachments(scheduledEmail) {
  if (!scheduledEmail) return;
  const dir = path.join(SCHEDULED_ATTACHMENTS_DIR, String(scheduledEmail._id));
  try {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  } catch (err) {
    console.error('Error cleaning scheduled attachments dir:', dir, err.message);
  }
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, '../temp/attachments');
    // Create directory if it doesn't exist
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    // Generate unique filename to avoid conflicts
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 25 * 1024 * 1024, // 25MB limit
    files: 10 // Maximum 10 files
  },
  fileFilter: function (req, file, cb) {
    // Allow common file types
    const allowedTypes = [
      'image/jpeg', 'image/png', 'image/gif', 'image/webp',
      'application/pdf', 'application/msword', 
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/plain', 'text/html', 'text/csv',
      'application/zip', 'application/x-zip-compressed'
    ];
    
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${file.mimetype} not allowed`), false);
    }
  }
});

const signatureStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, '../temp/signature-photos');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, 'profile-' + uniqueSuffix + path.extname(file.originalname));
  },
});

const signatureUpload = multer({
  storage: signatureStorage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: function (req, file, cb) {
    const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('profileImage must be JPEG, PNG, GIF, or WebP'), false);
    }
  },
});

function cleanupUploadedFiles(files = []) {
  files.forEach((file) => {
    try {
      if (fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
      }
    } catch (cleanupError) {
      console.error('Error cleaning up temp file:', file.path, cleanupError);
    }
  });
}

function parseCsvParam(value) {
  if (!value) return undefined;
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

const gmailCtrl = {
  // ✅ Send email with optional attachments
  sendEmail: async (req, res) => {
    try {
      console.log('=== SEND EMAIL WITH GMAIL API ===');
      console.log('Request body:', req.body);
      console.log('Files:', req.files);

      const { to, subject, text } = req.body;
      const adminId = req.user._id;
      const attachments = req.files || [];

      if (!to || !subject || !text) {
        return res.status(400).json({
          success: false,
          message: 'Missing required fields: to, subject, text'
        });
      }

      console.log('Processing email with:', {
        adminId,
        to,
        subject,
        textLength: text.length,
        attachmentCount: attachments.length
      });

      const result = await sendEmail(adminId, to, subject, text, attachments);

      res.json({ 
        success: true,
        message: 'Email sent successfully', 
        result 
      });
    } catch (err) {
      console.error('Error sending email:', err);

      res.status(500).json({ 
        success: false,
        message: 'Send failed', 
        error: err.message 
      });
    } finally {
      cleanupUploadedFiles(req.files || []);
    }
  },

  listEmails: async (req, res) => {
    try {
      const adminId = req.user._id;
      const {
        labelIds,
        q,
        maxResults,
        pageToken,
        includeSpamTrash,
        aiCategory,
        ai_category,
      } = req.query;
      const categorySlug = aiCategory || ai_category;

      if (categorySlug) {
        const result = await listMessagesByAiCategory(adminId, {
          aiCategory: categorySlug,
          labelIds: parseCsvParam(labelIds),
          maxResults,
          pageToken,
          includeSpamTrash: includeSpamTrash === 'true',
        });
        return res.json({ success: true, ...result });
      }

      const result = await listMessages(adminId, {
        labelIds: parseCsvParam(labelIds),
        q,
        maxResults,
        pageToken,
        includeSpamTrash: includeSpamTrash === 'true',
      });

      res.json({
        success: true,
        ...result,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to list emails',
        error: error.message,
      });
    }
  },

  searchEmails: async (req, res) => {
    try {
      const adminId = req.user._id;
      const { q = '' } = req.query;
      const results = await searchEmails(adminId, q);
      res.json({ success: true, messages: results });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to search emails',
        error: error.message,
      });
    }
  },

  /** Fast search by name/email in From, To, or Subject (metadata only, all mail). */
  searchEmailsByName: async (req, res) => {
    try {
      const name = String(req.query.name || req.query.q || '').trim();
      if (!name) {
        return res.status(400).json({
          success: false,
          message: 'Query param "name" or "q" is required',
        });
      }

      const result = await searchMessagesByName(req.user._id, {
        name,
        maxResults: req.query.maxResults,
        pageToken: req.query.pageToken,
        includeSpamTrash: req.query.includeSpamTrash !== 'false',
      });

      res.json({
        success: true,
        count: result.messages.length,
        ...result,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to search emails by name',
        error: error.message,
      });
    }
  },

  getEmail: async (req, res) => {
    try {
      const adminId = req.user._id;
      const email = await getEmailById(adminId, req.params.id);
      res.json({ success: true, email });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to fetch email',
        error: error.message,
      });
    }
  },

  /** Lightweight body + attachments for one message (expand in thread view). */
  getMessageBody: async (req, res) => {
    try {
      const message = await getMessageBodyForClient(req.user._id, req.params.id);
      res.json({ success: true, message });
    } catch (error) {
      const status =
        error.status === 404 || error.response?.status === 404 ? 404 : 500;
      res.status(status).json({
        success: false,
        message:
          status === 404
            ? error.message || 'Message not found'
            : 'Failed to fetch message body',
        error: error.message,
      });
    }
  },

  // Render an email as PDF. Uses the same auth as mail read (isAuth on the route).
  downloadEmailPdf: async (req, res) => {
    try {
      const adminId = req.user._id;
      const messageId = req.params.id;
      if (!messageId) {
        return res.status(400).json({ success: false, message: 'message id is required' });
      }

      const email = await getEmailById(adminId, messageId);
      const pdf = await renderEmailPdf(email);

      const safeName = (email.subject || `email-${messageId}`)
        .replace(/[\\/:*?"<>|\r\n]+/g, '_')
        .trim()
        .slice(0, 80) || `email-${messageId}`;

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${safeName}.pdf"`);
      res.setHeader('Content-Length', pdf.length);
      res.setHeader('Cache-Control', 'no-store');
      return res.end(pdf);
    } catch (error) {
      console.error('Error generating email PDF:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to generate email PDF',
        error: error.message,
      });
    }
  },

  // ✅ Reply to an email with optional attachments
  replyToEmail: async (req, res) => {
    try {
      console.log('=== REPLY EMAIL WITH GMAIL API ===');
      console.log('Request body:', req.body);
      console.log('Files:', req.files);

      const {
        originalMessageId,
        content,
        contentMain,
        subject,
        to,
        threadId,
        replySource,
        suggestedReplies,
        suggestReplyContext,
      } = req.body;
      const adminId = req.user._id;
      const attachments = req.files || [];

      const hasBody =
        (contentMain && String(contentMain).trim()) ||
        (content && String(content).trim());

      if (!originalMessageId || !hasBody) {
        return res.status(400).json({
          success: false,
          message:
            'Missing required fields: originalMessageId and at least one of contentMain or content',
        });
      }

      console.log('Processing reply with:', {
        adminId,
        originalMessageId,
        attachmentCount: attachments.length,
        replySource,
      });

      const result = await replyToEmail(adminId, originalMessageId, attachments, {
        subject,
        to,
        content,
        contentMain,
      });

      const resolvedThreadId = threadId || result?.threadId;
      let replyLog = null;

      if (result?.id && resolvedThreadId) {
        try {
          replyLog = await createReplyLog({
            adminId,
            threadId: resolvedThreadId,
            messageId: result.id,
            inReplyToMessageId: originalMessageId,
            replySource,
            suggestedReplies,
            suggestReplyContext,
            subject,
            to,
            sentAt: new Date(),
          });
        } catch (logError) {
          console.error('Failed to log email reply:', logError.message);
        }
      }

      res.json({
        success: true,
        message: 'Reply sent successfully',
        subject: subject ?? '',
        to: to ?? '',
        content: content ?? '',
        contentMain: contentMain ?? '',
        data: result,
        replyLog,
      });
    } catch (error) {
      console.error('Error replying to email:', error);

      res.status(500).json({
        success: false,
        message: error.message || 'Failed to reply to email',
        error: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    } finally {
      cleanupUploadedFiles(req.files || []);
    }
  },

  // ✅ Forward email with optional attachments
  forwardEmail: async (req, res) => {
    try {
      console.log('=== FORWARD EMAIL WITH GMAIL API ===');
      console.log('Request body:', req.body);
      console.log('Files:', req.files);

      const { originalMessageId, forwardTo, forwardText } = req.body;
      const adminId = req.user._id;
      const attachments = req.files || [];
      
      if (!originalMessageId || !forwardTo || !forwardText) {
        return res.status(400).json({
          success: false,
          message: 'Missing required fields: originalMessageId, forwardTo, forwardText'
        });
      }

      console.log('Processing forward with:', {
        adminId,
        originalMessageId,
        forwardTo,
        forwardTextLength: forwardText.length,
        attachmentCount: attachments.length
      });

      const result = await forwardEmail(adminId, originalMessageId, forwardTo, forwardText, attachments);

      res.json({
        success: true,
        message: 'Email forwarded successfully',
        data: result
      });
    } catch (error) {
      console.error('Error forwarding email:', error);

      res.status(500).json({
        success: false,
        message: error.message || 'Failed to forward email',
        error: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    } finally {
      cleanupUploadedFiles(req.files || []);
    }
  },

  markAsRead: async (req, res) => {
    try {
      await markAsRead(req.user._id, req.params.id);
      res.json({ success: true, message: 'Email marked as read' });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Failed to mark as read', error: error.message });
    }
  },

  markAsUnread: async (req, res) => {
    try {
      await markAsUnread(req.user._id, req.params.id);
      res.json({ success: true, message: 'Email marked as unread' });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Failed to mark as unread', error: error.message });
    }
  },

  trashEmail: async (req, res) => {
    try {
      await moveToTrash(req.user._id, req.params.id);
      res.json({ success: true, message: 'Email moved to trash' });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Failed to move email to trash', error: error.message });
    }
  },

  untrashEmail: async (req, res) => {
    try {
      await untrashMessage(req.user._id, req.params.id);
      res.json({ success: true, message: 'Email restored from trash' });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Failed to restore email', error: error.message });
    }
  },

  getAttachment: async (req, res) => {
    try {
      const { id, attachmentId } = req.params;
      const attachment = await getAttachment(req.user._id, id, attachmentId);
      res.json({ success: true, attachment });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Failed to fetch attachment', error: error.message });
    }
  },

  batchModify: async (req, res) => {
    try {
      const { ids, addLabelIds = [], removeLabelIds = [] } = req.body;
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ success: false, message: 'ids array is required' });
      }
      await batchModifyMessages(req.user._id, ids, addLabelIds, removeLabelIds);
      return res.json({ success: true, message: 'Messages modified successfully' });
    } catch (error) {
      return res.status(500).json({ success: false, message: 'Failed to batch modify messages', error: error.message });
    }
  },

  batchDelete: async (req, res) => {
    try {
      const { ids } = req.body;
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ success: false, message: 'ids array is required' });
      }
      await batchDeleteMessages(req.user._id, ids);
      return res.json({ success: true, message: 'Messages deleted successfully' });
    } catch (error) {
      return res.status(500).json({ success: false, message: 'Failed to batch delete messages', error: error.message });
    }
  },

  listLabels: async (req, res) => {
    try {
      const labels = await listLabels(req.user._id);
      const normalized = labels.map((label) => ({
        id: label.id,
        name: label.name,
        threadsTotal: typeof label.threadsTotal === 'number' ? label.threadsTotal : 0,
        threadsUnread: typeof label.threadsUnread === 'number' ? label.threadsUnread : 0,
      }));
      res.json({ success: true, labels: normalized });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Failed to list labels', error: error.message });
    }
  },

  getLabel: async (req, res) => {
    try {
      const label = await getLabel(req.user._id, req.params.id);
      res.json({ success: true, label });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Failed to get label', error: error.message });
    }
  },

  createLabel: async (req, res) => {
    try {
      const label = await createLabel(req.user._id, req.body);
      res.json({ success: true, label });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Failed to create label', error: error.message });
    }
  },

  updateLabel: async (req, res) => {
    try {
      const label = await updateLabel(req.user._id, req.params.id, req.body);
      res.json({ success: true, label });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Failed to update label', error: error.message });
    }
  },

  deleteLabel: async (req, res) => {
    try {
      await deleteLabel(req.user._id, req.params.id);
      res.json({ success: true, message: 'Label deleted successfully' });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Failed to delete label', error: error.message });
    }
  },

  listThreads: async (req, res) => {
    try {
      const data = await listThreads(req.user._id, {
        q: req.query.q,
        labelIds: parseCsvParam(req.query.labelIds),
        maxResults: req.query.maxResults,
        pageToken: req.query.pageToken,
      });
      res.json({ success: true, ...data });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Failed to list threads', error: error.message });
    }
  },

  getThread: async (req, res) => {
    try {
      const thread = await getThread(req.user._id, req.params.id);
      res.json({ success: true, thread });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Failed to get thread', error: error.message });
    }
  },

  listGmailCategories: async (req, res) => {
    try {
      const { categories, totalClassified, totalUnreadClassified } =
        await listGmailCategories(req.user._id);
      res.json({
        success: true,
        categories,
        totalClassified,
        totalUnreadClassified,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to list categories',
        error: error.message,
      });
    }
  },

  reclassifyThread: async (req, res) => {
    try {
      const classification = await classifyAndStoreThread(
        req.user._id,
        req.params.id,
        { force: true }
      );
      res.json({ success: true, classification });
    } catch (error) {
      const status =
        error.status === 404 || error.response?.status === 404 ? 404 : 500;
      res.status(status).json({
        success: false,
        message:
          status === 404
            ? error.message || 'Thread not found'
            : 'Failed to reclassify thread',
        error: error.message,
      });
    }
  },

  /** Oldest message in thread as plain text for Python classifier (subject + contentMain). */
  getThreadClassifyPayload: async (req, res) => {
    try {
      const payload = await getThreadClassifyPayload(
        req.user._id,
        req.params.id
      );
      return res.json({ success: true, ...payload });
    } catch (error) {
      const status =
        error.status === 404 || error.response?.status === 404 ? 404 : 500;
      return res.status(status).json({
        success: false,
        message:
          status === 404
            ? error.message || 'Thread not found'
            : 'Failed to build classify payload',
        error: error.message,
      });
    }
  },

  /** Latest message in thread: from, to, subject, contentMain + aiCategory. */
  getThreadLatestMessage: async (req, res) => {
    try {
      const adminId = req.user._id;
      const message = await getThreadLatestMessageForClient(
        adminId,
        req.params.id
      );
      const [withAi] = await attachThreadAiCategorySlug(adminId, [message]);
      res.json({ success: true, message: withAi });
    } catch (error) {
      const status =
        error.status === 404 || error.response?.status === 404 ? 404 : 500;
      res.status(status).json({
        success: false,
        message:
          status === 404
            ? error.message || 'Thread not found'
            : 'Failed to get latest thread message',
        error: error.message,
      });
    }
  },

  /**
   * AI suggested reply for a thread message.
   * Pass body/query messageId for the clicked row; omit for latest in thread.
   */
  suggestReply: async (req, res) => {
    try {
      const messageId =
        req.body?.messageId ||
        req.query?.messageId ||
        req.body?.id ||
        req.body?.selectedMessageId;
      const suggestion = await suggestReplyForThread(
        req.user._id,
        req.params.id,
        messageId
      );
      res.json({
        success: true,
        suggestion,
        suggestReplyContext: suggestion.suggestReplyContext || null,
        inReplyToMessageId: suggestion.inReplyToMessageId || null,
      });
    } catch (error) {
      const status =
        error.status === 404 || error.response?.status === 404
          ? 404
          : error.response?.status && error.response.status < 500
            ? error.response.status
            : 500;
      res.status(status).json({
        success: false,
        message:
          status === 404
            ? error.message || 'Thread not found'
            : 'Failed to generate suggested reply',
        error: error.message,
        details: error.response?.data || undefined,
      });
    }
  },

  /**
   * Test: suggest reply for a chosen message in the thread (body.messageId).
   */
  suggestReplyTest: async (req, res) => {
    try {
      const messageId = req.body?.messageId || req.query?.messageId;
      if (!messageId) {
        return res.status(400).json({
          success: false,
          message: 'messageId is required in body or query',
        });
      }

      const suggestion = await suggestReplyForMessage(
        req.user._id,
        req.params.id,
        messageId
      );
      res.json({
        success: true,
        suggestion,
        suggestReplyContext: suggestion.suggestReplyContext || null,
        inReplyToMessageId: suggestion.inReplyToMessageId || null,
      });
    } catch (error) {
      const status =
        error.status === 400
          ? 400
          : error.status === 404 || error.response?.status === 404
            ? 404
            : error.response?.status && error.response.status < 500
              ? error.response.status
              : 500;
      res.status(status).json({
        success: false,
        message: error.message || 'Failed to generate suggested reply',
        error: error.message,
        details: error.response?.data || undefined,
      });
    }
  },

  /**
   * Extract order details from thread via Python /order_llm.
   * Pass body/query messageId for the clicked row; omit for latest in thread.
   */
  llmOrder: async (req, res) => {
    try {
      const messageId =
        req.body?.messageId ||
        req.query?.messageId ||
        req.body?.id ||
        req.body?.selectedMessageId;
      const order = await llmOrderForThread(
        req.user._id,
        req.params.id,
        messageId
      );
      res.json({
        success: true,
        order,
      });
    } catch (error) {
      const status =
        error.status === 404 || error.response?.status === 404
          ? 404
          : error.response?.status && error.response.status < 500
            ? error.response.status
            : 500;
      res.status(status).json({
        success: false,
        message:
          status === 404
            ? error.message || 'Thread not found'
            : 'Failed to extract order from thread',
        error: error.message,
        details: error.response?.data || undefined,
      });
    }
  },

  listEmailReplies: async (req, res) => {
    try {
      const result = await listReplyLogs(req.user._id, req.query);
      res.json({ success: true, ...result });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to list email replies',
        error: error.message,
      });
    }
  },

  getEmailReplyStats: async (req, res) => {
    try {
      const stats = await getReplyStats(req.user._id, req.query);
      res.json({ success: true, stats });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to get email reply stats',
        error: error.message,
      });
    }
  },

  listThreadEmailReplies: async (req, res) => {
    try {
      const result = await listThreadReplyLogs(
        req.user._id,
        req.params.id,
        req.query
      );
      res.json({ success: true, threadId: req.params.id, ...result });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to list thread email replies',
        error: error.message,
      });
    }
  },

  /** All messages in thread — headers/snippet only (fast). Bodies via GET /messages/:id/body. */
  getThreadMessages: async (req, res) => {
    try {
      const adminId = req.user._id;
      const thread = await getThreadMessagesForClient(adminId, req.params.id);
      thread.messages = await attachThreadAiCategorySlug(
        adminId,
        thread.messages || []
      );
      res.json({ success: true, thread });
    } catch (error) {
      const status =
        error.status === 404 || error.response?.status === 404 ? 404 : 500;
      res.status(status).json({
        success: false,
        message:
          status === 404
            ? error.message || 'Thread not found'
            : 'Failed to get thread messages',
        error: error.message,
      });
    }
  },

  /** Thread with decoded MIME bodies + attachments for conversation UI (does not replace GET /threads/:id). */
  getThreadFull: async (req, res) => {
    try {
      const { limit, before } = req.query;
      const thread = await getThreadFullForClient(req.user._id, req.params.id, {
        limit,
        before,
      });
      res.json({ success: true, thread });
    } catch (error) {
      const status =
        error.status === 404 || error.response?.status === 404 ? 404 : 500;
      res.status(status).json({
        success: false,
        message:
          status === 404
            ? error.message || 'Thread not found'
            : 'Failed to get thread (full)',
        error: error.message,
      });
    }
  },

  modifyThread: async (req, res) => {
    try {
      const { addLabelIds = [], removeLabelIds = [] } = req.body;
      const thread = await modifyThread(req.user._id, req.params.id, addLabelIds, removeLabelIds);
      res.json({ success: true, thread });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Failed to modify thread', error: error.message });
    }
  },

  trashThread: async (req, res) => {
    try {
      const thread = await trashThread(req.user._id, req.params.id);
      res.json({ success: true, thread });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Failed to trash thread', error: error.message });
    }
  },

  untrashThread: async (req, res) => {
    try {
      const thread = await untrashThread(req.user._id, req.params.id);
      res.json({ success: true, thread });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Failed to untrash thread', error: error.message });
    }
  },

  deleteThread: async (req, res) => {
    try {
      await deleteThread(req.user._id, req.params.id);
      res.json({ success: true, message: 'Thread deleted successfully' });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Failed to delete thread', error: error.message });
    }
  },

  listDrafts: async (req, res) => {
    try {
      const drafts = await listDrafts(req.user._id, {
        maxResults: req.query.maxResults,
        pageToken: req.query.pageToken,
      });
      res.json({ success: true, ...drafts });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Failed to list drafts', error: error.message });
    }
  },

  getDraft: async (req, res) => {
    try {
      const draft = await getDraft(req.user._id, req.params.id);
      res.json({ success: true, draft });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Failed to get draft', error: error.message });
    }
  },

  createDraft: async (req, res) => {
    try {
      const { to, subject, text } = req.body;
      if (!to || !subject || !text) {
        return res.status(400).json({ success: false, message: 'to, subject and text are required' });
      }
      const draft = await createDraft(req.user._id, { to, subject, text });
      return res.json({ success: true, draft });
    } catch (error) {
      return res.status(500).json({ success: false, message: 'Failed to create draft', error: error.message });
    }
  },

  updateDraft: async (req, res) => {
    try {
      const { to, subject, text } = req.body;
      if (!to || !subject || !text) {
        return res.status(400).json({ success: false, message: 'to, subject and text are required' });
      }
      const draft = await updateDraft(req.user._id, req.params.id, { to, subject, text });
      return res.json({ success: true, draft });
    } catch (error) {
      return res.status(500).json({ success: false, message: 'Failed to update draft', error: error.message });
    }
  },

  sendDraft: async (req, res) => {
    try {
      const result = await sendDraft(req.user._id, req.params.id);
      res.json({ success: true, result });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Failed to send draft', error: error.message });
    }
  },

  deleteDraft: async (req, res) => {
    try {
      await deleteDraft(req.user._id, req.params.id);
      res.json({ success: true, message: 'Draft deleted successfully' });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Failed to delete draft', error: error.message });
    }
  },

  /** List saved compose signatures (name + generated HTML). */
  listMailSignatures: async (req, res) => {
    try {
      const signatures = await listMailSignaturesForAdmin(req.user._id);
      return res.json({
        success: true,
        signatures: [
          {
            id: 'none',
            name: 'No signature',
            title: null,
            profileImageUrl: null,
            signatureHtml: '',
            isDefault: false,
          },
          ...signatures,
        ],
        count: signatures.length + 1,
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: 'Failed to list signatures',
        error: error.message,
      });
    }
  },

  /** Create/update signature: name + title required; profileImage optional (PC → Cloudinary). */
  createMailSignature: async (req, res) => {
    try {
      const { name, title, isDefault, profileImageUrl } = req.body;
      const signature = await createMailSignatureForAdmin(req.user._id, {
        name,
        title,
        isDefault: isDefault === true || isDefault === 'true',
        profileImagePath: req.file?.path,
        profileImageUrl,
      });
      return res.status(201).json({
        success: true,
        message: 'Signature created',
        signature,
      });
    } catch (error) {
      if (req.file?.path && fs.existsSync(req.file.path)) {
        try {
          fs.unlinkSync(req.file.path);
        } catch {
          /* ignore */
        }
      }
      const status = error.status || 500;
      return res.status(status).json({
        success: false,
        message: error.message || 'Failed to create signature',
        error: error.message,
      });
    }
  },

  // Test email endpoint using Gmail API
  testEmail: async (req, res) => {
    const adminId = req.user._id;
    const { to } = req.body;
    
    try {
      console.log('Testing email delivery with Gmail API to:', to);
      
      if (!to) {
        return res.status(400).json({ 
          success: false,
          message: 'Recipient email address is required' 
        });
      }
      
      const result = await sendTestEmail(adminId, to);
      res.json({ 
        success: true,
        message: 'Test email sent successfully', 
        result,
        note: 'Check the recipient inbox and spam folder for the test email'
      });
    } catch (err) {
      console.error('Test email failed:', err);
      res.status(500).json({ 
        success: false,
        message: 'Test email failed', 
        error: err.message,
        details: {
          adminId,
          to,
          errorType: err.constructor.name
        }
      });
    }
  },

  startWatch: async (req, res) => {
    try {
      const adminId = req.user._id;
      const result = await startWatch(adminId);
      res.json({ success: true, ...result });
    } catch (error) {
      console.error('Failed to start Gmail watch:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to start Gmail watch',
        error: error.message,
      });
    }
  },

  stopWatch: async (req, res) => {
    try {
      const ok = await stopWatch(req.user._id);
      res.json({ success: ok });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to stop Gmail watch',
        error: error.message,
      });
    }
  },

  // Pub/Sub push webhook. Must respond 2xx quickly.
  handleWebhook: async (req, res) => {
    // Acknowledge immediately to avoid Pub/Sub retries while we process.
    res.status(200).send();

    try {
      const message = req.body?.message;
      if (!message || !message.data) {
        console.warn('[Gmail Webhook] Missing message.data in payload');
        return;
      }

      const decoded = Buffer.from(message.data, 'base64').toString('utf-8');
      let payload;
      try {
        payload = JSON.parse(decoded);
      } catch (parseError) {
        console.warn('[Gmail Webhook] Failed to parse payload:', parseError.message);
        return;
      }

      const { emailAddress, historyId } = payload;
      if (!emailAddress) {
        console.warn('[Gmail Webhook] Payload missing emailAddress');
        return;
      }

      const admin = await Admin.findOne({ gmailEmailAddress: emailAddress });
      if (!admin) {
        console.warn(
          `[Gmail Webhook] No admin matched for emailAddress ${emailAddress}`
        );
        return;
      }

      const adminId = admin._id.toString();
      console.log(
        `[Gmail Webhook] Notification for ${emailAddress} (admin ${adminId}, historyId ${historyId})`
      );

      const { newMessages } = await pollNewMessagesWithClassification(adminId);

      if (newMessages.length > 0) {
        for (const newMessage of newMessages) {
          emitToUser(adminId, 'gmail:new', newMessage);
        }
        emitToUser(adminId, 'gmail:inbox-updated', {
          count: newMessages.length,
          messageIds: newMessages.map((m) => m.id),
        });
      }
    } catch (error) {
      console.error('[Gmail Webhook] Processing error:', error);
    }
  },

  listContacts: async (req, res) => {
    try {
      const adminId = req.user._id;
      const { q } = req.query;

      const contacts = q
        ? await searchAllContacts(adminId, q)
        : await listAllContacts(adminId);

      res.json({ success: true, contacts });
    } catch (error) {
      console.error('Failed to list contacts:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to list contacts',
        error: error.message,
      });
    }
  },

  // Schedule an email to be sent at scheduledAt (UTC ISO string).
  // Multipart body: to, subject, text, scheduledAt, optional attachments[]
  scheduleSend: async (req, res) => {
    let scheduledEmail = null;
    try {
      const { to, subject, text, scheduledAt } = req.body;
      const adminId = req.user._id;
      const files = req.files || [];

      if (!to || !subject || !text || !scheduledAt) {
        cleanupUploadedFiles(files);
        return res.status(400).json({
          success: false,
          message: 'Missing required fields: to, subject, text, scheduledAt',
        });
      }

      const scheduledDate = new Date(scheduledAt);
      if (Number.isNaN(scheduledDate.getTime())) {
        cleanupUploadedFiles(files);
        return res.status(400).json({
          success: false,
          message: 'Invalid scheduledAt. Use an ISO 8601 date string (UTC recommended).',
        });
      }

      if (scheduledDate.getTime() <= Date.now()) {
        cleanupUploadedFiles(files);
        return res.status(400).json({
          success: false,
          message: 'scheduledAt must be in the future.',
        });
      }

      scheduledEmail = await ScheduledEmail.create({
        adminId,
        to,
        subject,
        text,
        scheduledAt: scheduledDate,
        attachments: [],
        status: 'pending',
      });

      const persistedAttachments = moveAttachmentsToScheduledDir(files, scheduledEmail._id);
      if (persistedAttachments.length) {
        scheduledEmail.attachments = persistedAttachments;
        await scheduledEmail.save();
      }

      return res.json({
        success: true,
        message: 'Email scheduled successfully',
        id: scheduledEmail._id,
        scheduledEmail,
      });
    } catch (error) {
      console.error('Error scheduling email:', error);
      // If document was created but attachment-move failed, clean it up
      if (scheduledEmail) {
        cleanupScheduledAttachments(scheduledEmail);
        try { await ScheduledEmail.deleteOne({ _id: scheduledEmail._id }); } catch (_) {}
      } else {
        cleanupUploadedFiles(req.files || []);
      }
      return res.status(500).json({
        success: false,
        message: 'Failed to schedule email',
        error: error.message,
      });
    }
  },

  // List the current admin's scheduled emails (optional status filter via query).
  listScheduledEmails: async (req, res) => {
    try {
      const adminId = req.user._id;
      const { status } = req.query;

      const filter = { adminId };
      if (status) filter.status = status;

      const items = await ScheduledEmail.find(filter)
        .sort({ scheduledAt: 1 })
        .lean();

      res.json({ success: true, count: items.length, items });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to list scheduled emails',
        error: error.message,
      });
    }
  },

  // Get a single scheduled email by id (owner only).
  getScheduledEmail: async (req, res) => {
    try {
      const adminId = req.user._id;
      const item = await ScheduledEmail.findOne({
        _id: req.params.id,
        adminId,
      }).lean();

      if (!item) {
        return res.status(404).json({ success: false, message: 'Scheduled email not found' });
      }
      res.json({ success: true, scheduledEmail: item });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to fetch scheduled email',
        error: error.message,
      });
    }
  },

  // Reschedule a pending email (changes scheduledAt only).
  rescheduleEmail: async (req, res) => {
    try {
      const adminId = req.user._id;
      const { scheduledAt } = req.body;

      if (!scheduledAt) {
        return res.status(400).json({ success: false, message: 'scheduledAt is required' });
      }
      const scheduledDate = new Date(scheduledAt);
      if (Number.isNaN(scheduledDate.getTime())) {
        return res.status(400).json({ success: false, message: 'Invalid scheduledAt' });
      }
      if (scheduledDate.getTime() <= Date.now()) {
        return res.status(400).json({ success: false, message: 'scheduledAt must be in the future' });
      }

      const updated = await ScheduledEmail.findOneAndUpdate(
        { _id: req.params.id, adminId, status: 'pending' },
        { scheduledAt: scheduledDate },
        { new: true }
      );

      if (!updated) {
        return res.status(404).json({
          success: false,
          message: 'Scheduled email not found or not in pending status',
        });
      }
      res.json({ success: true, scheduledEmail: updated });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to reschedule email',
        error: error.message,
      });
    }
  },

  // Cancel a pending scheduled email (removes attachments + marks cancelled).
  cancelScheduledEmail: async (req, res) => {
    try {
      const adminId = req.user._id;
      const item = await ScheduledEmail.findOneAndUpdate(
        { _id: req.params.id, adminId, status: 'pending' },
        { status: 'cancelled' },
        { new: true }
      );

      if (!item) {
        return res.status(404).json({
          success: false,
          message: 'Scheduled email not found or already processed',
        });
      }

      cleanupScheduledAttachments(item);
      res.json({ success: true, message: 'Scheduled email cancelled', scheduledEmail: item });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to cancel scheduled email',
        error: error.message,
      });
    }
  },
};

module.exports = { gmailCtrl, upload, signatureUpload };