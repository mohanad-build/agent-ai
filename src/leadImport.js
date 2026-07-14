// src/leadImport.js
//
// Pure transformation from raw delimited (CSV/TSV) paste text to an
// annotated, schema-mapped lead list. No Sheet access, no Gmail, no dedup,
// no landing -- normalizeLeads() only. Callers (e.g. an import route) are
// responsible for taking the 'ok' rows and writing them via gmail.appendSheetRow
// / gmail.findRowByEmail themselves.
//
// Pipeline:
//   Stage 1 (code):   parseDelimited -- sniff comma/tab, split into fields
//   Stage 2 (Haiku):  one call -- infer which column is email/name/phone/source
//   Stage 3 (code):   apply the mapping to every data row, normalize, annotate

// ---------------------------------------------------------------------------
// Stage 1: delimited-text parsing
// ---------------------------------------------------------------------------

// MVP limitation: fields are parsed line-by-line, so a quoted field containing
// an embedded newline is NOT supported -- it will be split across two "rows".

function parseDelimitedLine(line, delimiter) {
  const fields = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"' && current === '') {
      inQuotes = true;
    } else if (ch === delimiter) {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

function parseDelimited(rawText) {
  const lines = String(rawText || '')
    .split(/\r\n|\r|\n/)
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    throw new Error(
      'input does not look like delimited CSV/TSV; freeform paste is not supported in the MVP'
    );
  }

  const commaCount = (lines[0].match(/,/g) || []).length;
  const tabCount = (lines[0].match(/\t/g) || []).length;

  let delimiter;
  if (tabCount > commaCount && tabCount > 0) {
    delimiter = '\t';
  } else if (commaCount > 0) {
    delimiter = ',';
  } else {
    throw new Error(
      'input does not look like delimited CSV/TSV; freeform paste is not supported in the MVP'
    );
  }

  return lines.map((line) => parseDelimitedLine(line, delimiter));
}

// ---------------------------------------------------------------------------
// Stage 2: column-mapping inference (one Haiku call)
// ---------------------------------------------------------------------------

function stripCodeFences(text) {
  return text.replace(/^```[a-z]*\s*/i, '').replace(/\s*```$/i, '').trim();
}

function buildMappingPrompt(headerRow, sampleRows) {
  const system = `You map raw spreadsheet columns from a real estate lead-import CSV/TSV paste to a fixed schema: email, name, phone, source.

Return ONLY a raw JSON object with this exact shape (no markdown fences, no preamble, no explanation outside the JSON):

{
  "headerPresent": <true if the first row is a header row of column labels rather than data, false otherwise>,
  "columns": {
    "email": <0-based column index of the email address column, or null if none>,
    "name": <0-based column index of a single full-name column, OR an array of 0-based indices to join with a single space when first/last name are split across columns, or null if none>,
    "phone": <0-based column index of the phone number column, or null if none>,
    "source": <0-based column index of a lead-source column, or null if none>
  }
}`;

  const formatRow = (fields) => JSON.stringify(fields);
  const sampleLines = sampleRows.map((row, i) => `Data sample row ${i}: ${formatRow(row)}`).join('\n');

  const user = `First row: ${formatRow(headerRow)}\n\n${sampleLines || '(no further sample rows)'}`;

  return { system, user };
}

function parseMappingResponse(text) {
  const cleaned = stripCodeFences(String(text || ''));
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error('mapping response was not valid JSON: ' + cleaned.slice(0, 200));
  }

  if (typeof parsed.headerPresent !== 'boolean') {
    throw new Error('mapping response missing boolean headerPresent');
  }

  const columns = parsed.columns;
  if (!columns || typeof columns !== 'object') {
    throw new Error('mapping response missing columns object');
  }

  const isIndex = (v) => v === null || typeof v === 'number';
  const isNameValue = (v) => isIndex(v) || (Array.isArray(v) && v.every((x) => typeof x === 'number'));

  if (!isIndex(columns.email)) throw new Error('mapping response has invalid columns.email');
  if (!isNameValue(columns.name)) throw new Error('mapping response has invalid columns.name');
  if (!isIndex(columns.phone)) throw new Error('mapping response has invalid columns.phone');
  if (!isIndex(columns.source)) throw new Error('mapping response has invalid columns.source');

  return {
    headerPresent: parsed.headerPresent,
    columns: {
      email: columns.email,
      name: columns.name,
      phone: columns.phone,
      source: columns.source,
    },
  };
}

// ---------------------------------------------------------------------------
// Stage 3: per-row normalization
// ---------------------------------------------------------------------------

function collectMappedIndices(columns) {
  const indices = [];
  if (typeof columns.email === 'number') indices.push(columns.email);
  if (typeof columns.phone === 'number') indices.push(columns.phone);
  if (typeof columns.source === 'number') indices.push(columns.source);
  if (typeof columns.name === 'number') {
    indices.push(columns.name);
  } else if (Array.isArray(columns.name)) {
    indices.push(...columns.name);
  }
  return indices;
}

function normalizePhone(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return '';
  const hasLeadingPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return '';
  return hasLeadingPlus ? '+' + digits : digits;
}

// Light validity check: a single @, a dot in the domain, no whitespace.
function isValidEmail(email) {
  if (!email || /\s/.test(email)) return false;
  const parts = email.split('@');
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  if (!local || !domain || !domain.includes('.')) return false;
  return true;
}

function normalizeRow(fields, columns, rawIndex) {
  const requiredIndices = collectMappedIndices(columns);
  const maxIndex = requiredIndices.length ? Math.max(...requiredIndices) : -1;

  if (maxIndex >= 0 && fields.length <= maxIndex) {
    return {
      name: '',
      email: '',
      phone: '',
      source: '',
      status: 'skip:unparseable',
      statusReason: 'row has fewer columns than the inferred mapping requires',
      rawIndex,
    };
  }

  const email = (typeof columns.email === 'number' ? fields[columns.email] || '' : '')
    .trim()
    .toLowerCase();
  const phone = normalizePhone(typeof columns.phone === 'number' ? fields[columns.phone] : '');
  const source = (typeof columns.source === 'number' ? fields[columns.source] || '' : '').trim();

  let name = '';
  if (typeof columns.name === 'number') {
    name = (fields[columns.name] || '').trim();
  } else if (Array.isArray(columns.name)) {
    name = columns.name
      .map((i) => (fields[i] || '').trim())
      .filter(Boolean)
      .join(' ');
  }

  if (!isValidEmail(email)) {
    return {
      name,
      email,
      phone,
      source,
      status: 'skip:no-email',
      statusReason: 'missing or invalid email',
      rawIndex,
    };
  }

  return { name, email, phone, source, status: 'ok', statusReason: '', rawIndex };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

async function normalizeLeads(rawText, opts = {}) {
  const claudeClient = opts.claude || require('./claude');

  const allRows = parseDelimited(rawText);

  const headerCandidate = allRows[0];
  const sampleRows = allRows.slice(1, 6);
  const { system, user } = buildMappingPrompt(headerCandidate, sampleRows);

  const rawResponse = await claudeClient.callRaw({ system, user });
  const mapping = parseMappingResponse(rawResponse);

  const dataRows = mapping.headerPresent ? allRows.slice(1) : allRows;

  const rows = dataRows.map((fields, idx) => normalizeRow(fields, mapping.columns, idx));

  const okCount = rows.filter((r) => r.status === 'ok').length;
  const skippedCount = rows.length - okCount;

  return {
    rows,
    meta: {
      inputRowCount: dataRows.length,
      okCount,
      skippedCount,
      mapping: mapping.columns,
    },
  };
}

module.exports = {
  normalizeLeads,
  _internal: {
    parseDelimited,
    parseDelimitedLine,
    buildMappingPrompt,
    parseMappingResponse,
    normalizeRow,
    normalizePhone,
    isValidEmail,
    collectMappedIndices,
  },
};
