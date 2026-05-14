'use strict';

const { _internal } = require('../src/gmail');
const { buildRfc5322Message } = _internal;

// ── Hand-rolled MIME parser ───────────────────────────────────────────────────

function decodeBase64url(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(b64, 'base64').toString('utf8');
}

function decodeQuotedPrintable(s) {
  const unwrapped = s.replace(/=\r\n/g, '');
  const bytes = [];
  let i = 0;
  while (i < unwrapped.length) {
    if (unwrapped[i] === '=' && i + 2 < unwrapped.length) {
      const hex = unwrapped.slice(i + 1, i + 3);
      if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
        bytes.push(parseInt(hex, 16));
        i += 3;
        continue;
      }
    }
    bytes.push(unwrapped.charCodeAt(i));
    i++;
  }
  return Buffer.from(bytes).toString('utf8');
}

function extractBoundary(contentType) {
  const m = contentType.match(/boundary="?([^";\r\n]+)"?/i);
  return m ? m[1] : null;
}

function parseRawMessage(raw) {
  const decoded = decodeBase64url(raw);
  const [headerBlock, ...bodyParts] = decoded.split('\r\n\r\n');
  const bodyText = bodyParts.join('\r\n\r\n');

  const headers = {};
  for (const line of headerBlock.split('\r\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const name = line.slice(0, idx).toLowerCase().trim();
    const val  = line.slice(idx + 1).trim();
    headers[name] = val;
  }

  const boundary = extractBoundary(headers['content-type'] || '');

  let parts = null;
  if (boundary) {
    const delimiter = '--' + boundary;
    const rawParts = bodyText.split(delimiter).slice(1); // skip preamble
    parts = rawParts
      .filter(p => p.trim() !== '--' && p.trim() !== '')
      .map(p => {
        const trimmed = p.startsWith('\r\n') ? p.slice(2) : p;
        const splitIdx = trimmed.indexOf('\r\n\r\n');
        const partHeaderBlock = trimmed.slice(0, splitIdx);
        const partBody = trimmed.slice(splitIdx + 4).replace(/\r\n$/, '');
        const partHeaders = {};
        for (const line of partHeaderBlock.split('\r\n')) {
          const colon = line.indexOf(':');
          if (colon === -1) continue;
          partHeaders[line.slice(0, colon).toLowerCase().trim()] = line.slice(colon + 1).trim();
        }
        const encoding = (partHeaders['content-transfer-encoding'] || '').toLowerCase();
        const content = encoding === 'quoted-printable'
          ? decodeQuotedPrintable(partBody)
          : partBody;
        return { headers: partHeaders, content };
      });
  }

  return { headers, boundary, parts };
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const BASE = {
  from:    'agent@example.com',
  to:      'operator@example.com',
  cc:      [],
  bcc:     [],
  subject: 'Test subject',
};

const PLAIN_BODY = 'Hello, this is the plaintext body.\nSecond line.';
const HTML_BODY  = '<html><body><p>Hello, this is the <strong>HTML</strong> body.</p></body></html>';

// ── Plaintext-only path (backward compat guard) ───────────────────────────────

test('plaintext-only: Content-Type is text/plain, no boundary', () => {
  const raw = buildRfc5322Message({ ...BASE, body: PLAIN_BODY });
  const { headers, boundary } = parseRawMessage(raw);
  expect(headers['content-type']).toMatch(/text\/plain/i);
  expect(boundary).toBeNull();
});

test('plaintext-only: decoded body is byte-identical to input', () => {
  const raw = buildRfc5322Message({ ...BASE, body: PLAIN_BODY });
  const decoded = decodeBase64url(raw);
  const bodyStart = decoded.indexOf('\r\n\r\n') + 4;
  expect(decoded.slice(bodyStart)).toBe(PLAIN_BODY);
});

// ── Multipart/alternative path ────────────────────────────────────────────────

test('multipart: top-level Content-Type is multipart/alternative', () => {
  const raw = buildRfc5322Message({ ...BASE, body: PLAIN_BODY, html: HTML_BODY });
  const { headers } = parseRawMessage(raw);
  expect(headers['content-type']).toMatch(/multipart\/alternative/i);
});

test('multipart: boundary present in Content-Type header', () => {
  const raw = buildRfc5322Message({ ...BASE, body: PLAIN_BODY, html: HTML_BODY });
  const { boundary } = parseRawMessage(raw);
  expect(boundary).toBeTruthy();
  expect(typeof boundary).toBe('string');
  expect(boundary.length).toBeGreaterThan(0);
});

test('multipart: exactly two parts parsed', () => {
  const raw = buildRfc5322Message({ ...BASE, body: PLAIN_BODY, html: HTML_BODY });
  const { parts } = parseRawMessage(raw);
  expect(parts).toHaveLength(2);
});

test('multipart: first part is text/plain', () => {
  const raw = buildRfc5322Message({ ...BASE, body: PLAIN_BODY, html: HTML_BODY });
  const { parts } = parseRawMessage(raw);
  expect(parts[0].headers['content-type']).toMatch(/text\/plain/i);
});

test('multipart: second part is text/html', () => {
  const raw = buildRfc5322Message({ ...BASE, body: PLAIN_BODY, html: HTML_BODY });
  const { parts } = parseRawMessage(raw);
  expect(parts[1].headers['content-type']).toMatch(/text\/html/i);
});

test('multipart: plaintext content round-trips correctly', () => {
  const raw = buildRfc5322Message({ ...BASE, body: PLAIN_BODY, html: HTML_BODY });
  const { parts } = parseRawMessage(raw);
  expect(parts[0].content).toBe(PLAIN_BODY);
});

test('multipart: html content round-trips correctly', () => {
  const raw = buildRfc5322Message({ ...BASE, body: PLAIN_BODY, html: HTML_BODY });
  const { parts } = parseRawMessage(raw);
  expect(parts[1].content).toBe(HTML_BODY);
});

test('multipart: both parts use quoted-printable transfer encoding', () => {
  const raw = buildRfc5322Message({ ...BASE, body: PLAIN_BODY, html: HTML_BODY });
  const { parts } = parseRawMessage(raw);
  expect(parts[0].headers['content-transfer-encoding']).toMatch(/quoted-printable/i);
  expect(parts[1].headers['content-transfer-encoding']).toMatch(/quoted-printable/i);
});

// ── Non-ASCII round-trip (em-dash, arrow, fire emoji) ────────────────────────

test('non-ASCII chars in plaintext part survive round-trip (em-dash, arrow)', () => {
  const body = 'Weekly digest — May 10 to May 17\n→ Open row: https://example.com';
  const raw = buildRfc5322Message({ ...BASE, body, html: '<p>placeholder</p>' });
  const { parts } = parseRawMessage(raw);
  expect(parts[0].content).toBe(body);
});

test('non-ASCII chars in HTML part survive round-trip (fire emoji)', () => {
  const htmlWithEmoji = '<p>🔥 Hot leads</p>';
  const raw = buildRfc5322Message({ ...BASE, body: 'plain', html: htmlWithEmoji });
  const { parts } = parseRawMessage(raw);
  expect(parts[1].content).toBe(htmlWithEmoji);
});

// ── Subject header ────────────────────────────────────────────────────────────

test('subject header present in decoded message', () => {
  const raw = buildRfc5322Message({ ...BASE, body: PLAIN_BODY, html: HTML_BODY });
  const { headers } = parseRawMessage(raw);
  expect(headers['subject']).toBe('Test subject');
});
