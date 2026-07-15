'use strict';

require('dotenv').config();

// CLI wrapper over enableLeads. Thin: no selection/blocking/Sheet logic lives
// here. Mirrors scripts/enrich-leads.js's shape (testable core + require.main
// CLI block using loadAgent to validate/load, dotenv at the top before any
// other require).

const fs = require('fs');
const { loadAgent } = require('../src/agentConfig');
const { enableLeads } = require('../src/leadEnrich');

async function runEnable(agentId, opts = {}) {
  const loadAgentFn = opts.loadAgent || loadAgent;
  const readFileSyncFn = opts.readFileSync || fs.readFileSync;
  const enable = opts.enableLeads || enableLeads;

  const agentConfig = loadAgentFn(agentId);
  const enableOpts = { dryRun: !!opts.dryRun };

  if (opts.filePath !== undefined) {
    let raw;
    try {
      raw = readFileSyncFn(opts.filePath, 'utf8');
    } catch (err) {
      throw new Error(`Could not read file '${opts.filePath}': ${err.message}`);
    }
    enableOpts.emails = raw
      .split(/\r\n|\r|\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } else {
    enableOpts.status = opts.status;
  }

  const result = await enable(agentConfig, enableOpts);
  return { agentConfig, result };
}

function formatReport(result) {
  const lines = [];

  lines.push(`Enabled: ${result.enabled}`);
  lines.push('');

  const blockedRows = result.rows.filter((row) => row.action === 'blocked');
  if (blockedRows.length > 0) {
    lines.push('Blocked leads:');
    for (const row of blockedRows) {
      lines.push(`  ${row.email}: ${row.reason}`);
    }
  } else {
    lines.push('No leads were blocked.');
  }
  lines.push('');

  const notFoundRows = result.rows.filter((row) => row.action === 'not-found');
  if (notFoundRows.length > 0) {
    lines.push('Not found:');
    for (const row of notFoundRows) {
      lines.push(`  ${row.email}: ${row.reason}`);
    }
  } else {
    lines.push('All requested addresses were found.');
  }
  lines.push('');

  lines.push('Enabled leads are now LIVE. The AI will act on them starting with the next cycle.');

  return lines.join('\n');
}

module.exports = { runEnable, formatReport };

if (require.main === module) {
  const args = process.argv.slice(2);
  const agentId = args[0];

  const fileFlagIndex = args.indexOf('--file');
  const statusFlagIndex = args.indexOf('--status');
  const dryRun = args.includes('--dry-run');
  const yes = args.includes('--yes');

  const hasFile = fileFlagIndex !== -1;
  const hasStatus = statusFlagIndex !== -1;
  const filePath = hasFile ? args[fileFlagIndex + 1] : undefined;
  const status = hasStatus ? args[statusFlagIndex + 1] : undefined;

  const usage =
    'Usage:\n' +
    '  node scripts/enable-leads.js <agentId> --file <path>\n' +
    '  node scripts/enable-leads.js <agentId> --status <value> --yes\n' +
    '  (both accept --dry-run)';

  if (!agentId || hasFile === hasStatus) {
    console.error(usage);
    process.exit(1);
  }

  (async () => {
    try {
      if (hasStatus && !yes) {
        const { result } = await runEnable(agentId, { status, dryRun: true });
        console.log(formatReport(result));
        console.log('');
        console.log('--status enables leads based on an AI-inferred status. Re-run with --yes to proceed.');
        process.exit(1);
        return;
      }

      const { result } = await runEnable(agentId, hasFile ? { filePath, dryRun } : { status, dryRun });
      console.log(formatReport(result));
      process.exit(0);
    } catch (err) {
      console.error(err.message);
      process.exit(1);
    }
  })();
}
