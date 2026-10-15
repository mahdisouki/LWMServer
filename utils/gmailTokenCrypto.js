const crypto = require('crypto');

const PREFIX = 'enc:v1:';
const ALGO = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function getEncryptionKey() {
  const raw = process.env.GMAIL_TOKEN_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      'GMAIL_TOKEN_ENCRYPTION_KEY is required to store Gmail tokens securely'
    );
  }

  // Accept 64-char hex or base64 that decodes to 32 bytes
  let key;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    key = Buffer.from(raw, 'hex');
  } else {
    key = Buffer.from(raw, 'base64');
  }

  if (key.length !== 32) {
    throw new Error(
      'GMAIL_TOKEN_ENCRYPTION_KEY must be 32 bytes (64 hex chars or base64)'
    );
  }
  return key;
}

function isEncrypted(value) {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

function encryptValue(plaintext) {
  if (plaintext == null || plaintext === '') return plaintext;
  if (isEncrypted(plaintext)) return plaintext;

  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGO, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  const encrypted = Buffer.concat([
    cipher.update(String(plaintext), 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return (
    PREFIX +
    Buffer.concat([iv, tag, encrypted]).toString('base64')
  );
}

function decryptValue(value) {
  if (value == null || value === '') return value;
  // Legacy plaintext tokens (pre-encryption) — still usable until re-saved
  if (!isEncrypted(value)) return value;

  const key = getEncryptionKey();
  const raw = Buffer.from(value.slice(PREFIX.length), 'base64');
  if (raw.length < IV_LENGTH + AUTH_TAG_LENGTH + 1) {
    throw new Error('Invalid encrypted Gmail token payload');
  }

  const iv = raw.subarray(0, IV_LENGTH);
  const tag = raw.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = raw.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = crypto.createDecipheriv(ALGO, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString(
    'utf8'
  );
}

/** Encrypt secret fields before writing Admin.gmailTokens */
function encryptGmailTokens(tokens) {
  if (!tokens || typeof tokens !== 'object') return tokens;
  return {
    ...tokens,
    access_token: tokens.access_token
      ? encryptValue(tokens.access_token)
      : tokens.access_token,
    refresh_token: tokens.refresh_token
      ? encryptValue(tokens.refresh_token)
      : tokens.refresh_token,
  };
}

/** Decrypt secret fields after reading Admin.gmailTokens (for Google API use) */
function decryptGmailTokens(tokens) {
  if (!tokens || typeof tokens !== 'object') return tokens;
  return {
    ...tokens,
    access_token: tokens.access_token
      ? decryptValue(tokens.access_token)
      : tokens.access_token,
    refresh_token: tokens.refresh_token
      ? decryptValue(tokens.refresh_token)
      : tokens.refresh_token,
  };
}

module.exports = {
  encryptGmailTokens,
  decryptGmailTokens,
  isEncrypted,
};
