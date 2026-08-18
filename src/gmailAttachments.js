// src/gmailAttachments.js
//
// Fetches one Gmail attachment's bytes and hashes them. Auth is shared with
// Gmail/Sheets/Drive via gmail.getOAuthClient so one token has one cache; see
// src/drive.js for the same pattern. This module does not write anything: no
// filing record, no STORAGE_ROOT, no src/transactions/* import. It fetches
// and hashes, nothing else.
//
// users.messages.attachments.get is a GET, and gaxios already retries GET
// (see src/googleRetry.js's header comment). This module does not import
// googleRetry and must not be wrapped in it: googleRetry exists for POSTs
// that gaxios does not retry on its own, and stacking it on a GET would
// compound attempts.

const crypto = require('node:crypto');
const { google } = require('googleapis');
const { getOAuthClient } = require('./gmail');

async function fetchAttachmentBytes(agentConfig, messageId, attachmentId) {
  const auth = getOAuthClient(agentConfig);
  const gmail = google.gmail({ version: 'v1', auth });

  const res = await gmail.users.messages.attachments.get({
    userId: 'me',
    messageId,
    id: attachmentId,
  });

  const data = res.data?.data;
  if (!data) {
    throw new Error(
      `fetchAttachmentBytes: no data for messageId ${messageId}, attachmentId ${attachmentId}`
    );
  }

  const buffer = Buffer.from(data, 'base64url');
  const contentHash = `sha256:${crypto.createHash('sha256').update(buffer).digest('hex')}`;

  return { buffer, contentHash };
}

module.exports = {
  fetchAttachmentBytes,
};
