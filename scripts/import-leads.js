'use strict';

// CLI wrapper over normalizeLeads + landLeads. Thin: no normalization, dedup,
// or Sheet logic lives here. Mirrors scripts/enable-content-engine.js's shape
// (testable core + require.main CLI block using loadAgent to validate/load).

const fs = require('fs');
const { loadAgent } = require('../src/agentConfig');
const { normalizeLeads, landLeads } = require('../src/leadImport');

async function runImport(agentId, csvPath, opts = {}) {
  const loadAgentFn = opts.loadAgent || loadAgent;
  const readFileSyncFn = opts.readFileSync || fs.readFileSync;
  const normalize = opts.normalizeLeads || normalizeLeads;
  const land = opts.landLeads || landLeads;

  // Validates + loads in one call. Throws (agentId in the message) if missing.
  // Do not create anything on a miss.
  const agentConfig = loadAgentFn(agentId);

  let rawText;
  try {
    rawText = readFileSyncFn(csvPath, 'utf8');
  } catch (err) {
    throw new Error(`Could not read file '${csvPath}': ${err.message}`);
  }

  const normalized = await normalize(rawText);
  const result = await land(agentConfig, normalized);

  return { agentConfig, normalized, result };
}

function formatReport(normalized, result) {
  const lines = [];

  lines.push('Inferred column mapping:');
  lines.push(JSON.stringify(normalized.meta.mapping, null, 2));
  lines.push('');

  lines.push(`Landed: ${result.landed}`);
  lines.push('');

  lines.push('Status breakdown:');
  for (const [key, value] of Object.entries(result.counts)) {
    lines.push(`  ${key}: ${value}`);
  }
  lines.push('');

  const nonLanded = result.rows.filter((row) => row.status !== 'landed');
  if (nonLanded.length > 0) {
    lines.push('Rows needing manual attention:');
    for (const row of nonLanded) {
      const emailDisplay = row.email || '(none)';
      const reasonPart = row.statusReason ? ` (${row.statusReason})` : '';
      lines.push(`  [row ${row.rawIndex}] ${emailDisplay}: ${row.status}${reasonPart}`);
    }
  } else {
    lines.push('No rows require manual attention.');
  }
  lines.push('');

  lines.push('Reminder: landed rows are inert (aiEnabled FALSE) until you bulk-enable them.');

  return lines.join('\n');
}

module.exports = { runImport, formatReport };

if (require.main === module) {
  const [, , agentId, csvPath] = process.argv;

  if (!agentId || !csvPath || process.argv.length > 4) {
    console.error('Usage: node scripts/import-leads.js <agentId> <path-to-csv>');
    process.exit(1);
  }

  (async () => {
    try {
      const { normalized, result } = await runImport(agentId, csvPath);
      console.log(formatReport(normalized, result));
      process.exit(0);
    } catch (err) {
      console.error(err.message);
      process.exit(1);
    }
  })();
}
