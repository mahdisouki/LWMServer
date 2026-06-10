const fs = require('fs');
const MailSignature = require('../models/MailSignature');
const cloudinary = require('../helper/cloudinaryConfig');

const DEFAULT_PROFILE_IMAGE_URL =
  'https://res.cloudinary.com/dehzhd6xs/image/upload/v1766061958/Profile_Picture_1_pucnnp.png';

const DEFAULT_TITLE = 'Customer Service Representative';

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function normalizeSignatureNameKey(name) {
  const key = String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  return key || '';
}

function isAllowedProfileImageUrl(url) {
  return typeof url === 'string' && /^https:\/\//i.test(url.trim());
}

/** Staff email signature HTML — name, title, and profile photo are customizable. */
function buildSignatureHtml({ name, title, profileImageUrl }) {
  const safeName = escapeHtml(String(name || '').trim());
  const safeTitle = escapeHtml(String(title || '').trim());
  const safeImageUrl = escapeHtml(
    isAllowedProfileImageUrl(profileImageUrl)
      ? profileImageUrl.trim()
      : DEFAULT_PROFILE_IMAGE_URL
  );

  return `<table cellpadding="0" cellspacing="0" border="0" width="600"
       style="font-family: Arial, Helvetica, sans-serif; background:#ffffff; border-radius:16px;">

  <tr>
    <td valign="top" style="padding:20px 30px 15px 30px;">

      <p style="margin:0; font-size:32px; font-weight:700; color:#000000;">
        ${safeName}
      </p>

      <p style="margin:6px 0 20px 0; font-size:20px; font-weight:600; color:#2ecc71;">
        ${safeTitle}
      </p>

      <table cellpadding="10" cellspacing="0" border="0" width="100%"
             style="background:#f4f7fb; ">
        <tr>
          <td width="36">
            <img src="https://res.cloudinary.com/dehzhd6xs/image/upload/v1766066231/Icon_3_qdfwa9.png"
                 width="32" style="display:block;">
          </td>
          <td style="font-size:16px; font-weight:600; color:#737F94;">
            020 30971517
          </td>
        </tr>
      </table>
        <table cellpadding="10" cellspacing="0" border="0" width="100%"
             style="margin-top:10px; background:#f4f7fb; ">
        <tr>
          <td width="36">
            <img src="https://res.cloudinary.com/dehzhd6xs/image/upload/v1766066225/Icon_4_bsggvv.png"
                 width="32" style="display:block;">
          </td>
          <td style="font-size:16px; font-weight:600; color:#737F94;">
            Hello@londonwastemanagement.com
          </td>
        </tr>
      </table>

    </td>

    <td width="240" valign="top" align="center" style="padding:20px 30px 15px 0;">

      <img src="${safeImageUrl}"
           width="160"
           style="display:block; border-radius:80px;"
           alt="Profile">

      <table cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td>
            <a href="#"><img src="https://res.cloudinary.com/dehzhd6xs/image/upload/v1766062196/Facebook_kmzb3i.png" width="28"></a>
          </td>
          <td width="12"></td>
          <td>
            <a href="#"><img src="https://res.cloudinary.com/dehzhd6xs/image/upload/v1766062214/Instagram_chgefx.png" width="28"></a>
          </td>
          <td width="12"></td>
          <td>
            <a href="#"><img src="https://res.cloudinary.com/dehzhd6xs/image/upload/v1766062240/LinkedIn_pk0t1n.png" width="28"></a>
          </td>
        </tr>
      </table>

    </td>
  </tr>

  <tr>
    <td colspan="2" style="padding:0 30px 10px 30px;">

      <table cellpadding="10" cellspacing="0" border="0" width="100%"
             style="margin-top:0px; background:#f4f7fb; ">
        <tr>
          <td width="36">
            <img src="https://res.cloudinary.com/dehzhd6xs/image/upload/v1766066180/Icon_6_rcnbdl.png"
                 width="28" style="display:block;">
          </td>
          <td style="font-size:14px; font-weight:600; color:#737F94;">
            Head Office 6–9 The Square Stockley Park UB11 1FW
          </td>
        </tr>
      </table>

    </td>
  </tr>

  <tr>
    <td colspan="2" style="padding:0;">
      <img src="https://res.cloudinary.com/dehzhd6xs/image/upload/v1766061786/Design_sans_titre_2_1_1_oyxkhe.gif"
           style="display:block; width:100%; max-width:660px; height:auto;">
    </td>
  </tr>

</table>`;
}

/** @deprecated Use buildSignatureHtml */
function buildSignatureHtmlFromName(displayName) {
  return buildSignatureHtml({
    name: displayName,
    title: DEFAULT_TITLE,
    profileImageUrl: DEFAULT_PROFILE_IMAGE_URL,
  });
}

function formatSignatureDoc(doc) {
  return {
    id: String(doc._id),
    name: doc.name,
    nameKey: doc.nameKey,
    title: doc.title || DEFAULT_TITLE,
    profileImageUrl: doc.profileImageUrl || DEFAULT_PROFILE_IMAGE_URL,
    signatureHtml: doc.signatureHtml,
    isDefault: Boolean(doc.isDefault),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

let legacyIndexesReady = null;

function ensureMailSignatureIndexes() {
  if (!legacyIndexesReady) {
    legacyIndexesReady = MailSignature.dropLegacyIndexes().catch((err) => {
      console.warn('[mailSignatureService] dropLegacyIndexes:', err.message);
      legacyIndexesReady = null;
    });
  }
  return legacyIndexesReady;
}

async function uploadProfileImageToCloudinary(filePath) {
  try {
    const result = await cloudinary.uploader.upload(filePath, {
      folder: 'mail-signatures',
      resource_type: 'image',
    });
    return result.secure_url;
  } finally {
    if (filePath && fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch {
        /* ignore cleanup errors */
      }
    }
  }
}

async function resolveProfileImageUrl({
  profileImagePath,
  profileImageUrl,
  existing,
}) {
  if (profileImagePath) {
    return uploadProfileImageToCloudinary(profileImagePath);
  }

  const bodyUrl = String(profileImageUrl || '').trim();
  if (bodyUrl && isAllowedProfileImageUrl(bodyUrl)) {
    return bodyUrl;
  }

  if (
    existing?.profileImageUrl &&
    isAllowedProfileImageUrl(existing.profileImageUrl)
  ) {
    return existing.profileImageUrl;
  }

  return DEFAULT_PROFILE_IMAGE_URL;
}

async function createMailSignature(
  adminId,
  { name, title, isDefault = false, profileImagePath, profileImageUrl }
) {
  await ensureMailSignatureIndexes();

  const displayName = String(name || '').trim();
  if (displayName.length < 2) {
    const err = new Error('Signature name is required (min 2 characters)');
    err.status = 400;
    throw err;
  }

  const displayTitle = String(title || '').trim();
  if (displayTitle.length < 2) {
    const err = new Error('Signature title is required (min 2 characters)');
    err.status = 400;
    throw err;
  }

  const nameKey = normalizeSignatureNameKey(displayName);
  const existing = await MailSignature.findOne({ adminId, nameKey });

  const resolvedProfileImageUrl = await resolveProfileImageUrl({
    profileImagePath,
    profileImageUrl,
    existing,
  });

  const signatureHtml = buildSignatureHtml({
    name: displayName,
    title: displayTitle,
    profileImageUrl: resolvedProfileImageUrl,
  });

  if (isDefault) {
    await MailSignature.updateMany({ adminId }, { $set: { isDefault: false } });
  }

  let doc;
  if (existing) {
    existing.name = displayName;
    existing.title = displayTitle;
    existing.profileImageUrl = resolvedProfileImageUrl;
    existing.signatureHtml = signatureHtml;
    existing.isDefault = Boolean(isDefault);
    doc = await existing.save();
  } else {
    doc = await MailSignature.create({
      adminId,
      nameKey,
      name: displayName,
      title: displayTitle,
      profileImageUrl: resolvedProfileImageUrl,
      signatureHtml,
      isDefault: Boolean(isDefault),
    });
  }

  return formatSignatureDoc(doc);
}

async function listMailSignatures(adminId) {
  await ensureMailSignatureIndexes();
  const docs = await MailSignature.find({ adminId }).sort({ name: 1 }).lean();
  return docs.map((doc) => {
    const formatted = formatSignatureDoc(doc);
    if (!doc.title || !doc.profileImageUrl) {
      formatted.signatureHtml = buildSignatureHtml({
        name: doc.name,
        title: formatted.title,
        profileImageUrl: formatted.profileImageUrl,
      });
    }
    return formatted;
  });
}

module.exports = {
  DEFAULT_PROFILE_IMAGE_URL,
  DEFAULT_TITLE,
  buildSignatureHtml,
  buildSignatureHtmlFromName,
  createMailSignature,
  listMailSignatures,
};
