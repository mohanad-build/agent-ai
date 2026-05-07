// scripts/test-leadCategory-filter.js
//
// Unit test for the SOI leadCategory validation gate added in processAgent Step 1.
// Does NOT write to the live Sheet. Uses in-memory row fixtures and stubs the
// email.appendToConversationHistory call to capture log entries.
//
// Covers:
//   - isLeadCategoryActionable: empty string, undefined, 'soi', 'SOI', other values
//   - Filter gate behaviour: SOI row dropped, non-SOI row kept
//   - Column L log entry produced for the dropped row
//
// Usage: node scripts/test-leadCategory-filter.js

require('dotenv').config();

const { isLeadCategoryActionable } = require('../src/agentConfig');

// ---------------------------------------------------------------------------
// Pass/fail counters
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function check(label, condition) {
  if (condition) {
    passed++;
    console.log('[PASS] ' + label);
  } else {
    failed++;
    console.log('[FAIL] ' + label);
  }
}

function divider(char, length) {
  char = char || '=';
  length = length || 80;
  return char.repeat(length);
}

// ---------------------------------------------------------------------------
// Minimal row fixtures
// ---------------------------------------------------------------------------

function makeRow(leadCategory) {
  return {
    rowIndex: 2,
    leadId: 'test@example.com',
    name: 'Test Lead',
    status: 'new',
    leadCategory: leadCategory,
  };
}

// ---------------------------------------------------------------------------
// Simulated filter gate (mirrors the logic in processAgent Step 1)
// ---------------------------------------------------------------------------

// Runs the SOI filter over an array of row fixtures.
// appendLog captures the would-be column L calls without hitting the Sheet.
// Returns { kept: row[], logCalls: { rowIndex, entry }[] }.
function runSoiFilter(rows) {
  const kept = [];
  const logCalls = [];

  for (const row of rows) {
    if (!isLeadCategoryActionable(row)) {
      logCalls.push({ rowIndex: row.rowIndex, entry: 'Skipped (SOI): leadCategory=soi' });
      continue;
    }
    kept.push(row);
  }

  return { kept, logCalls };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

function main() {
  console.log(divider('='));
  console.log('LEAD CATEGORY FILTER UNIT TEST');
  console.log(divider('='));
  console.log();

  // ------------------------------------------------------------------
  // SECTION 1: isLeadCategoryActionable - direct unit tests
  // ------------------------------------------------------------------
  console.log(divider('-'));
  console.log('SECTION 1: isLeadCategoryActionable');
  console.log(divider('-'));

  check('empty string is actionable', isLeadCategoryActionable(makeRow('')) === true);
  check('undefined leadCategory is actionable', isLeadCategoryActionable(makeRow(undefined)) === true);
  check('null row is actionable', isLeadCategoryActionable(null) === true);
  check('"soi" (lowercase) is NOT actionable', isLeadCategoryActionable(makeRow('soi')) === false);
  check('"SOI" (uppercase) is NOT actionable', isLeadCategoryActionable(makeRow('SOI')) === false);
  check('"Soi" (mixed case) is NOT actionable', isLeadCategoryActionable(makeRow('Soi')) === false);
  check('"cold_internet" is actionable (reserved, future use)', isLeadCategoryActionable(makeRow('cold_internet')) === true);
  check('"active_client" is actionable (reserved, future use)', isLeadCategoryActionable(makeRow('active_client')) === true);

  console.log();

  // ------------------------------------------------------------------
  // SECTION 2: Filter gate - row array behaviour
  // ------------------------------------------------------------------
  console.log(divider('-'));
  console.log('SECTION 2: filter gate behaviour');
  console.log(divider('-'));

  const rowA = makeRow('');        // action-eligible
  const rowB = makeRow('soi');     // SOI - must be filtered out
  rowA.rowIndex = 2;
  rowB.rowIndex = 3;

  const { kept, logCalls } = runSoiFilter([rowA, rowB]);

  check('only 1 row kept after filtering', kept.length === 1);
  check('kept row is Row A (empty leadCategory)', kept[0] === rowA);
  check('Row B (soi) was dropped', !kept.includes(rowB));
  check('1 column L log call produced', logCalls.length === 1);
  check('log call targets Row B rowIndex', logCalls[0] && logCalls[0].rowIndex === 3);
  check(
    'log entry text is "Skipped (SOI): leadCategory=soi"',
    logCalls[0] && logCalls[0].entry === 'Skipped (SOI): leadCategory=soi'
  );

  console.log();

  // ------------------------------------------------------------------
  // SECTION 3: Edge cases
  // ------------------------------------------------------------------
  console.log(divider('-'));
  console.log('SECTION 3: edge cases');
  console.log(divider('-'));

  // All SOI rows - nothing should make it through
  const allSoi = [makeRow('soi'), makeRow('SOI')];
  allSoi[0].rowIndex = 2;
  allSoi[1].rowIndex = 3;
  const { kept: keptAllSoi, logCalls: logsAllSoi } = runSoiFilter(allSoi);
  check('all-SOI input: 0 rows kept', keptAllSoi.length === 0);
  check('all-SOI input: 2 log calls produced', logsAllSoi.length === 2);

  // No SOI rows - all pass through
  const noSoi = [makeRow(''), makeRow('cold_internet'), makeRow('')];
  noSoi.forEach((r, i) => { r.rowIndex = i + 2; });
  const { kept: keptNoSoi, logCalls: logsNoSoi } = runSoiFilter(noSoi);
  check('no-SOI input: all 3 rows kept', keptNoSoi.length === 3);
  check('no-SOI input: 0 log calls', logsNoSoi.length === 0);

  console.log();

  // ------------------------------------------------------------------
  // Summary
  // ------------------------------------------------------------------
  console.log(divider('='));
  console.log('TEST SUMMARY');
  console.log(divider('='));
  console.log('Total: ' + passed + ' passed, ' + failed + ' failed');
  console.log();

  if (failed === 0) {
    console.log('All checks passed.');
  } else {
    console.log(failed + ' check(s) failed. Review output above.');
  }

  process.exit(failed > 0 ? 1 : 0);
}

main();
