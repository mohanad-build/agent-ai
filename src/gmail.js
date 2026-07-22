// src/gmail.js
//
// Gmail (and Google Sheets) provider implementation.
// Called by src/email.js. All Gmail and Sheets API logic lives here.

const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const { getNowIso } = require('./time');
const { getStorageRoot } = require('./storagePaths');

// Module state
const oauthClientCache = new Map();
const signatureCache = new Map();
const SIGNATURE_TTL_MS = 15 * 60 * 1000;
// Map<agentId, Map<labelName, labelId>>. Accumulates across ensureLabels calls
// so different callers (leadIntake, followUp, outboundTracking) share one
// list-once-then-cache path instead of each re-listing Gmail's label set.
const labelCache = new Map();

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

class AuthFailureError extends Error {
  constructor(agentId, originalError) {
    super(
      `OAuth refresh failed permanently for agent "${agentId}". ` +
      `Agent has been marked inactive. Re-run scripts/authorize.js to recover.`
    );
    this.name = 'AuthFailureError';
    this.agentId = agentId;
    this.originalError = originalError;
  }
}

// ---------------------------------------------------------------------------
// Auth + retry
// ---------------------------------------------------------------------------

function getOAuthClient(agentConfig) {
  if (oauthClientCache.has(agentConfig.agentId)) {
    return oauthClientCache.get(agentConfig.agentId);
  }
  const client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  client.setCredentials({ refresh_token: agentConfig.googleRefreshToken });
  oauthClientCache.set(agentConfig.agentId, client);
  return client;
}

function isAuthFailure(err) {
  const code = err?.response?.data?.error || err?.message || '';
  return String(code).includes('invalid_grant');
}

function handleAuthFailure(agentConfig, originalError) {
  const configPath = path.join(getStorageRoot(), `${agentConfig.agentId}.json`);
  try {
    const current = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    current.isActive = false;
    fs.writeFileSync(configPath, JSON.stringify(current, null, 2));
  } catch (writeErr) {
    console.error(`Failed to flip isActive=false for ${agentConfig.agentId}:`, writeErr.message);
  }
  oauthClientCache.delete(agentConfig.agentId);
  throw new AuthFailureError(agentConfig.agentId, originalError);
}

async function withRetry(agentConfig, fn) {
  try {
    return await fn();
  } catch (err) {
    if (isAuthFailure(err)) {
      handleAuthFailure(agentConfig, err);
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
    try {
      return await fn();
    } catch (err2) {
      if (isAuthFailure(err2)) {
        handleAuthFailure(agentConfig, err2);
      }
      throw err2;
    }
  }
}

// ---------------------------------------------------------------------------
// From header formatting
// ---------------------------------------------------------------------------

// Returns `"Display Name" <address>` when config.displayName is a usable
// non-empty string, otherwise returns config.gmailAddress unchanged. A
// displayName containing a double quote or newline would break the header,
// so those fall back to the bare address instead of being escaped.
function formatFromHeader(config) {
  const address = config && config.gmailAddress;
  const displayName = config && config.displayName;

  if (typeof displayName !== 'string' || displayName.trim().length === 0) {
    return address;
  }
  if (displayName.includes('"') || displayName.includes('\n') || displayName.includes('\r')) {
    return address;
  }
  return `"${displayName}" <${address}>`;
}

// ---------------------------------------------------------------------------
// Subject normalization
// ---------------------------------------------------------------------------

function normalizeSubject(raw) {
  let subject = String(raw || '').trim();
  while (/^(re|fwd?|fw)\s*:\s*/i.test(subject)) {
    subject = subject.replace(/^(re|fwd?|fw)\s*:\s*/i, '').trim();
  }
  return `Re: ${subject}`;
}

// ---------------------------------------------------------------------------
// MIME / RFC 5322
// ---------------------------------------------------------------------------

// Encodes a header value per RFC 2047 encoded-word format when non-ASCII
// characters are present. Pure ASCII values are returned as-is.
// Used for Subject today; apply to display-name fields later as needed.
function encodeHeaderValue(value) {
  if (value == null) return '';
  const str = String(value);
  // Pure ASCII (codes 0-127): no encoding needed.
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(str)) return str;
  // Non-ASCII present: wrap in RFC 2047 encoded-word format using base64.
  const base64 = Buffer.from(str, 'utf8').toString('base64');
  return '=?UTF-8?B?' + base64 + '?=';
}

function encodeQuotedPrintable(str) {
  let out = '';
  const buf = Buffer.from(str, 'utf8');
  let lineLen = 0;
  for (const byte of buf) {
    let encoded;
    if (
      (byte >= 33 && byte <= 126 && byte !== 61) ||
      byte === 9 || byte === 32
    ) {
      encoded = String.fromCharCode(byte);
    } else {
      encoded = '=' + byte.toString(16).toUpperCase().padStart(2, '0');
    }
    if (lineLen + encoded.length > 75) {
      out += '=\r\n';
      lineLen = 0;
    }
    out += encoded;
    lineLen += encoded.length;
  }
  return out;
}

function buildRfc5322Message({ from, to, cc, bcc, subject, body, html, attachments }) {
  const hasAttachments = Array.isArray(attachments) && attachments.length > 0;
  const headers = [];
  headers.push(`From: ${from}`);
  headers.push(`To: ${to}`);
  if (cc && cc.length) headers.push(`Cc: ${cc.join(', ')}`);
  if (bcc && bcc.length) headers.push(`Bcc: ${bcc.join(', ')}`);
  headers.push(`Subject: ${encodeHeaderValue(subject)}`);
  headers.push('MIME-Version: 1.0');

  let raw;
  if (!html && !hasAttachments) {
    headers.push('Content-Type: text/plain; charset="UTF-8"');
    headers.push('Content-Transfer-Encoding: 7bit');
    raw = headers.join('\r\n') + '\r\n\r\n' + body;
  } else if (html && !hasAttachments) {
    const boundary = `----=_Alt_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    const parts = [];
    parts.push(
      `--${boundary}\r\n` +
      `Content-Type: text/plain; charset="UTF-8"\r\n` +
      `Content-Transfer-Encoding: quoted-printable\r\n\r\n` +
      `${encodeQuotedPrintable(body)}\r\n`
    );
    parts.push(
      `--${boundary}\r\n` +
      `Content-Type: text/html; charset="UTF-8"\r\n` +
      `Content-Transfer-Encoding: quoted-printable\r\n\r\n` +
      `${encodeQuotedPrintable(html)}\r\n`
    );
    parts.push(`--${boundary}--`);
    raw = headers.join('\r\n') + '\r\n\r\n' + parts.join('');
  } else {
    const boundary = `----=_Part_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
    const parts = [];
    parts.push(
      `--${boundary}\r\n` +
      `Content-Type: text/plain; charset="UTF-8"\r\n` +
      `Content-Transfer-Encoding: 7bit\r\n\r\n` +
      `${body}\r\n`
    );
    for (const att of attachments) {
      const content = Buffer.isBuffer(att.content)
        ? att.content.toString('base64')
        : String(att.content);
      parts.push(
        `--${boundary}\r\n` +
        `Content-Type: ${att.mimeType}; name="${att.filename}"\r\n` +
        `Content-Disposition: attachment; filename="${att.filename}"\r\n` +
        `Content-Transfer-Encoding: base64\r\n\r\n` +
        `${content}\r\n`
      );
    }
    parts.push(`--${boundary}--`);
    raw = headers.join('\r\n') + '\r\n\r\n' + parts.join('');
  }

  return Buffer.from(raw)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// ---------------------------------------------------------------------------
// Gmail message parsing
// ---------------------------------------------------------------------------

function getHeader(headers, name) {
  const h = headers.find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h ? h.value : '';
}

function parseGmailMessage(message) {
  const headers = message.payload?.headers || [];
  const attachmentInfo = [];

  function walkParts(part) {
    if (!part) return;
    if (part.filename && part.body?.attachmentId) {
      attachmentInfo.push({
        filename: part.filename,
        mimeType: part.mimeType,
        size: part.body.size,
        attachmentId: part.body.attachmentId,
      });
    }
    if (Array.isArray(part.parts)) {
      part.parts.forEach(walkParts);
    }
  }
  walkParts(message.payload);

  return {
    messageId: message.id,
    threadId: message.threadId,
    from: getHeader(headers, 'From'),
    subject: getHeader(headers, 'Subject'),
    snippet: message.snippet || '',
    receivedAt: message.internalDate
      ? new Date(parseInt(message.internalDate, 10)).toISOString()
      : null,
    hasAttachments: attachmentInfo.length > 0,
    attachmentInfo,
  };
}

// ---------------------------------------------------------------------------
// Email read
// ---------------------------------------------------------------------------

async function fetchUnreadReplies(agentConfig) {
  const auth = getOAuthClient(agentConfig);
  const gmail = google.gmail({ version: 'v1', auth });

  return withRetry(agentConfig, async () => {
    const list = await gmail.users.messages.list({
      userId: 'me',
      q: 'is:unread newer_than:1d',
      maxResults: 50,
    });
    const messages = list.data.messages || [];
    if (messages.length === 0) return [];

    const fetched = await Promise.all(
      messages.map((m) =>
        gmail.users.messages.get({
          userId: 'me',
          id: m.id,
          format: 'full',
        })
      )
    );
    return fetched.map((res) => parseGmailMessage(res.data));
  });
}

async function getMessage(agentConfig, messageId) {
  const auth = getOAuthClient(agentConfig);
  const gmail = google.gmail({ version: 'v1', auth });
  return withRetry(agentConfig, async () => {
    const res = await gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'full',
    });
    return parseGmailMessage(res.data);
  });
}

async function getThreadHistory(agentConfig, threadId) {
  const auth = getOAuthClient(agentConfig);
  const gmail = google.gmail({ version: 'v1', auth });
  return withRetry(agentConfig, async () => {
    const res = await gmail.users.threads.get({
      userId: 'me',
      id: threadId,
      format: 'full',
    });
    return (res.data.messages || []).map(parseGmailMessage);
  });
}

async function searchEmails(agentConfig, query) {
  const auth = getOAuthClient(agentConfig);
  const gmail = google.gmail({ version: 'v1', auth });
  return withRetry(agentConfig, async () => {
    const list = await gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults: 50,
    });
    const messages = list.data.messages || [];
    if (messages.length === 0) return [];
    const fetched = await Promise.all(
      messages.map((m) =>
        gmail.users.messages.get({ userId: 'me', id: m.id, format: 'full' })
      )
    );
    return fetched.map((res) => parseGmailMessage(res.data));
  });
}

async function searchMessages(agentConfig, gmailQuery, maxResults = 100) {
  const auth = getOAuthClient(agentConfig);
  const gmail = google.gmail({ version: 'v1', auth });
  return withRetry(agentConfig, async () => {
    const ids = [];
    let pageToken;
    do {
      const batch = Math.min(maxResults - ids.length, 100);
      const res = await gmail.users.messages.list({
        userId: 'me',
        q: gmailQuery,
        maxResults: batch,
        ...(pageToken && { pageToken }),
      });
      const messages = res.data.messages || [];
      for (const m of messages) {
        ids.push(m.id);
        if (ids.length >= maxResults) break;
      }
      pageToken = res.data.nextPageToken;
    } while (pageToken && ids.length < maxResults);
    return ids;
  });
}

async function fetchMessage(agentConfig, messageId) {
  const auth = getOAuthClient(agentConfig);
  const gmail = google.gmail({ version: 'v1', auth });
  return withRetry(agentConfig, async () => {
    const res = await gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'full',
    });
    const msg = res.data;
    const headers = msg.payload?.headers || [];
    return {
      id: msg.id,
      threadId: msg.threadId,
      from: getHeader(headers, 'From'),
      to: getHeader(headers, 'To'),
      subject: getHeader(headers, 'Subject'),
      body: extractTextBody(msg.payload),
      internalDate: msg.internalDate ? parseInt(msg.internalDate, 10) : 0,
      labelIds: msg.labelIds || [],
    };
  });
}

// ---------------------------------------------------------------------------
// Email write
// ---------------------------------------------------------------------------

async function sendReply(agentConfig, { to, subject, body, threadId, attachments }) {
  const auth = getOAuthClient(agentConfig);
  const gmail = google.gmail({ version: 'v1', auth });

  const raw = buildRfc5322Message({
    from: formatFromHeader(agentConfig),
    to,
    cc: agentConfig.ccEmails || [],
    bcc: agentConfig.bccEmails || [],
    subject: normalizeSubject(subject),
    body,
    attachments,
  });

  return withRetry(agentConfig, async () => {
    const res = await gmail.users.messages.send({
      userId: 'me',
      requestBody: threadId ? { raw, threadId } : { raw },
    });
    return res.data;
  });
}

async function sendNewEmail(agentConfig, { to, subject, body, html, attachments }) {
  const auth = getOAuthClient(agentConfig);
  const gmail = google.gmail({ version: 'v1', auth });

  const raw = buildRfc5322Message({
    from: formatFromHeader(agentConfig),
    to,
    cc: agentConfig.ccEmails || [],
    bcc: agentConfig.bccEmails || [],
    subject,
    body,
    html,
    attachments,
  });

  return withRetry(agentConfig, async () => {
    const res = await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw },
    });
    return res.data;
  });
}

async function markRead(agentConfig, messageId) {
  const auth = getOAuthClient(agentConfig);
  const gmail = google.gmail({ version: 'v1', auth });
  return withRetry(agentConfig, async () => {
    await gmail.users.messages.modify({
      userId: 'me',
      id: messageId,
      requestBody: { removeLabelIds: ['UNREAD'] },
    });
  });
}

// ---------------------------------------------------------------------------
// Signature detection
// ---------------------------------------------------------------------------

async function getSignaturePresence(agentConfig) {
  const cached = signatureCache.get(agentConfig.agentId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.hasSignature;
  }

  const auth = getOAuthClient(agentConfig);
  const gmail = google.gmail({ version: 'v1', auth });

  const hasSignature = await withRetry(agentConfig, async () => {
    const res = await gmail.users.settings.sendAs.list({ userId: 'me' });
    const sendAs = res.data.sendAs || [];
    const primary = sendAs.find((s) => s.isPrimary) || sendAs[0];
    return !!(primary && primary.signature && primary.signature.trim().length > 0);
  });

  signatureCache.set(agentConfig.agentId, {
    hasSignature,
    expiresAt: Date.now() + SIGNATURE_TTL_MS,
  });
  return hasSignature;
}

// ---------------------------------------------------------------------------
// Sheet column map
// ---------------------------------------------------------------------------

const COLUMN_MAP = {
  leadId: 'A',
  name: 'B',
  phone: 'C',
  source: 'D',
  dateAdded: 'E',
  originalMessage: 'F',
  status: 'G',
  followUpCount: 'H',
  nextFollowUpDay: 'I',
  lastFollowUpDate: 'J',
  reserved: 'K',
  conversationHistory: 'L',
  pendingQuestion: 'M',
  gmailThreadId: 'N',
  aiEnabled: 'O',
  lastActionTimestamp: 'P',
  reminderSent: 'Q',
  validationStatus: 'R',
  operatorEscalated: 'S',
  leadCategory: 'T',
};

function colLetterToIndex(letter) {
  return letter.toUpperCase().charCodeAt(0) - 'A'.charCodeAt(0);
}

function indexToColLetter(index) {
  return String.fromCharCode('A'.charCodeAt(0) + index);
}

const COLUMN_NAMES_BY_INDEX = Object.entries(COLUMN_MAP).reduce((acc, [name, letter]) => {
  acc[colLetterToIndex(letter)] = name;
  return acc;
}, {});

// ---------------------------------------------------------------------------
// Sheet read / write
// ---------------------------------------------------------------------------

function getSheetsClient(agentConfig) {
  const auth = getOAuthClient(agentConfig);
  return google.sheets({ version: 'v4', auth });
}

async function readSheetRows(agentConfig) {
  const sheets = getSheetsClient(agentConfig);
  return withRetry(agentConfig, async () => {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: agentConfig.googleSheetId,
      range: 'A2:T',
    });
    const rows = res.data.values || [];
    return rows.map((row, i) => {
      const obj = { rowIndex: i + 2 };
      for (let col = 0; col < row.length; col++) {
        const name = COLUMN_NAMES_BY_INDEX[col];
        if (name) obj[name] = row[col];
      }
      for (const name of Object.keys(COLUMN_MAP)) {
        if (!(name in obj)) obj[name] = '';
      }
      return obj;
    });
  });
}

// Column-A (leadId/email) lookup against rows returned by readSheetRows.
// Matches Array.find semantics: returns the row object or undefined.
function findRowByEmail(rows, email) {
  const target = String(email || '').trim().toLowerCase();
  if (!target) return undefined;
  return rows.find((r) => String(r.leadId || '').trim().toLowerCase() === target);
}

async function updateSheetRow(agentConfig, rowIndex, updates) {
  const sheets = getSheetsClient(agentConfig);
  const data = [];
  for (const [field, value] of Object.entries(updates)) {
    const letter = COLUMN_MAP[field];
    if (!letter) {
      throw new Error(`Unknown column name "${field}" passed to updateSheetRow`);
    }
    data.push({
      range: `${letter}${rowIndex}`,
      values: [[value]],
    });
  }
  return withRetry(agentConfig, async () => {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: agentConfig.googleSheetId,
      requestBody: {
        valueInputOption: 'RAW',
        data,
      },
    });
  });
}

// Maps a rowData object to a positional array in COLUMN_MAP order, defaulting
// missing fields to ''. Single source of truth shared by appendSheetRow and
// appendSheetRows.
function buildSheetRowArray(rowData) {
  const orderedNames = Object.keys(COLUMN_MAP);
  return orderedNames.map((name) => (rowData[name] !== undefined ? rowData[name] : ''));
}

async function appendSheetRow(agentConfig, rowData) {
  const sheets = getSheetsClient(agentConfig);
  const row = buildSheetRowArray(rowData);
  return withRetry(agentConfig, async () => {
    await sheets.spreadsheets.values.append({
      spreadsheetId: agentConfig.googleSheetId,
      range: 'A:T',
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [row] },
    });
  });
}

async function appendSheetRows(agentConfig, rowDataArray) {
  if (!rowDataArray || rowDataArray.length === 0) {
    return undefined;
  }
  const sheets = getSheetsClient(agentConfig);
  const rows = rowDataArray.map((rowData) => buildSheetRowArray(rowData));
  return withRetry(agentConfig, async () => {
    await sheets.spreadsheets.values.append({
      spreadsheetId: agentConfig.googleSheetId,
      range: 'A:T',
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: rows },
    });
  });
}

async function appendToConversationHistory(agentConfig, rowIndex, entry) {
  const sheets = getSheetsClient(agentConfig);
  const timestamp = getNowIso();
  const newLine = `[${timestamp}] ${entry}`;

  return withRetry(agentConfig, async () => {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: agentConfig.googleSheetId,
      range: `L${rowIndex}`,
    });
    const current = (res.data.values && res.data.values[0] && res.data.values[0][0]) || '';
    const updated = current ? `${current}\n${newLine}` : newLine;

    await sheets.spreadsheets.values.update({
      spreadsheetId: agentConfig.googleSheetId,
      range: `L${rowIndex}`,
      valueInputOption: 'RAW',
      requestBody: { values: [[updated]] },
    });
  });
}

// ---------------------------------------------------------------------------
// Inbox email helpers (Lead Intake Tier 2)
// ---------------------------------------------------------------------------

function extractTextBody(payload) {
  if (!payload) return '';
  if (payload.mimeType === 'text/plain' && payload.body && payload.body.data) {
    return Buffer.from(payload.body.data, 'base64').toString('utf8');
  }
  if (Array.isArray(payload.parts)) {
    for (const part of payload.parts) {
      const text = extractTextBody(part);
      if (text) return text;
    }
  }
  return '';
}

async function fetchUnreadInboxEmails(agentConfig) {
  const auth = getOAuthClient(agentConfig);
  const gmail = google.gmail({ version: 'v1', auth });

  return withRetry(agentConfig, async () => {
    const list = await gmail.users.messages.list({
      userId: 'me',
      q: 'is:unread in:inbox',
      maxResults: 100,
    });
    const messages = list.data.messages || [];
    if (messages.length === 0) return [];

    const fetched = await Promise.all(
      messages.map((m) =>
        gmail.users.messages.get({
          userId: 'me',
          id: m.id,
          format: 'full',
        })
      )
    );

    return fetched.map((res) => {
      const msg = res.data;
      const parsed = parseGmailMessage(msg);
      const headers = msg.payload?.headers || [];
      parsed.inReplyTo = getHeader(headers, 'In-Reply-To') || '';
      parsed.body = extractTextBody(msg.payload);
      parsed.labelIds = msg.labelIds || [];
      parsed.internalDate = msg.internalDate ? parseInt(msg.internalDate, 10) : 0;
      return parsed;
    });
  });
}

async function listLabels(agentConfig) {
  const auth = getOAuthClient(agentConfig);
  const gmail = google.gmail({ version: 'v1', auth });
  return withRetry(agentConfig, async () => {
    const res = await gmail.users.labels.list({ userId: 'me' });
    return res.data.labels || [];
  });
}

async function createLabel(agentConfig, name) {
  const auth = getOAuthClient(agentConfig);
  const gmail = google.gmail({ version: 'v1', auth });
  return withRetry(agentConfig, async () => {
    const res = await gmail.users.labels.create({
      userId: 'me',
      requestBody: { name },
    });
    return res.data;
  });
}

// Resolves label ids for `names`, creating any that do not exist yet.
// Backed by the module-level labelCache, keyed per agentId, which accumulates
// across calls so a second call with a different name set reuses whatever it
// already knows and only lists/creates the names it has not resolved before.
// Returns a Map containing exactly the requested names, never the full
// accumulated per-agent cache.
async function ensureLabels(agentConfig, names) {
  const agentId = agentConfig.agentId;
  const cached = labelCache.get(agentId);
  if (cached && names.every((name) => cached.has(name))) {
    return new Map(names.map((name) => [name, cached.get(name)]));
  }

  let perAgent = labelCache.get(agentId);
  if (!perAgent) {
    perAgent = new Map();
    labelCache.set(agentId, perAgent);
  }

  const existingLabels = await listLabels(agentConfig);
  const existingMap = new Map(existingLabels.map((l) => [l.name, l.id]));

  for (const name of names) {
    if (perAgent.has(name)) continue;
    if (existingMap.has(name)) {
      perAgent.set(name, existingMap.get(name));
    } else {
      const created = await createLabel(agentConfig, name);
      perAgent.set(name, created.id);
    }
  }

  return new Map(names.map((name) => [name, perAgent.get(name)]));
}

async function applyMessageLabels(agentConfig, messageId, addLabelIds, removeLabelIds) {
  const auth = getOAuthClient(agentConfig);
  const gmail = google.gmail({ version: 'v1', auth });
  return withRetry(agentConfig, async () => {
    await gmail.users.messages.modify({
      userId: 'me',
      id: messageId,
      requestBody: {
        addLabelIds: addLabelIds || [],
        removeLabelIds: removeLabelIds || [],
      },
    });
  });
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  fetchUnreadReplies,
  getMessage,
  getThreadHistory,
  searchEmails,
  sendReply,
  sendNewEmail,
  markRead,
  getSignaturePresence,
  readSheetRows,
  findRowByEmail,
  updateSheetRow,
  appendSheetRow,
  appendSheetRows,
  appendToConversationHistory,
  extractTextBody,
  searchMessages,
  fetchMessage,
  fetchUnreadInboxEmails,
  listLabels,
  createLabel,
  ensureLabels,
  applyMessageLabels,
  AuthFailureError,
  _internal: {
    normalizeSubject,
    encodeHeaderValue,
    buildRfc5322Message,
    parseGmailMessage,
    COLUMN_MAP,
    formatFromHeader,
    labelCache,
    _clearLabelCache: () => labelCache.clear(),
  },
};
