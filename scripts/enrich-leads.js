'use strict';

require('dotenv').config();

// CLI wrapper over enrichLeads. Thin: no scan/summarize/Sheet logic lives
// here. Mirrors scripts/import-leads.js's shape exactly (testable core +
// require.main CLI block using loadAgent to validate/load, dotenv at the top
// before any other require).

const { loadAgent } = require('../src/agentConfig');
const { enrichLeads } = require('../src/leadEnrich');

async function runEnrich(agentId, opts = {}) {
  const loadAgentFn = opts.loadAgent || loadAgent;
  const enrich = opts.enrichLeads || enrichLeads;

  // Validates + loads in one call. Throws (agentId in the message) if missing.
  const agentConfig = loadAgentFn(agentId);
  const result = await enrich(agentConfig, { limit: opts.limit });

  return { agentConfig, result };
}

function formatReport(result) {
  const lines = [];

  lines.push(`Processed: ${result.processed}`);
  lines.push(`Enriched: ${result.enriched}`);
  lines.push(`No-history: ${result.counts.noHistory}`);
  lines.push(`Failed: ${result.failed}`);
  lines.push('');

  const nonEnriched = result.rows.filter((row) => row.status !== 'enriched');
  if (nonEnriched.length > 0) {
    lines.push('Leads needing manual attention:');
    for (const row of nonEnriched) {
      const notePart = row.note ? ` (${row.note})` : '';
      lines.push(`  ${row.email}: ${row.status}${notePart}`);
    }
  } else {
    lines.push('No leads require manual attention.');
  }
  lines.push('');

  const soiLeads = result.rows.filter((row) => row.note && row.note.startsWith('PROPOSED SOI:'));
  if (soiLeads.length > 0) {
    lines.push('PROPOSED SOI (operator decision required):');
    for (const row of soiLeads) {
      lines.push(`  ${row.email}: ${row.note}`);
    }
  } else {
    lines.push('No leads were proposed for SOI.');
  }
  lines.push('');

  lines.push(
    'Reminder: rows remain inert until bulk-enabled. Column T (leadCategory) was NOT written; any SOI proposal above requires a manual decision.'
  );

  return lines.join('\n');
}

module.exports = { runEnrich, formatReport };

if (require.main === module) {
  const args = process.argv.slice(2);
  const agentId = args[0];

  let limit;
  const limitFlagIndex = args.indexOf('--limit');
  if (limitFlagIndex !== -1) {
    limit = parseInt(args[limitFlagIndex + 1], 10);
  }

  if (!agentId || (limitFlagIndex !== -1 && Number.isNaN(limit))) {
    console.error('Usage: node scripts/enrich-leads.js <agentId> [--limit N]');
    process.exit(1);
  }

  (async () => {
    try {
      const { result } = await runEnrich(agentId, { limit });
      console.log(formatReport(result));
      process.exit(0);
    } catch (err) {
      console.error(err.message);
      process.exit(1);
    }
  })();
}
