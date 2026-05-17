// scripts/calibration-7-11-8.js
// Parked 7.11.8: surpriseScore calibration check.
// Runs three synthetic data slices through generateWeeklyAngles and prints
// per-scenario score distributions for human review.
//
// Output is informational only. There are no assertions.

'use strict';

const fs   = require('node:fs/promises');
const os   = require('node:os');
const path = require('node:path');

const { generateWeeklyAngles, _internal } = require('../src/content/angles.js');
const { gatherDataSlice } = _internal;

const DRY_RUN = process.argv.includes('--dry-run');

const NOW      = new Date('2026-05-17T12:00:00.000Z');
const WEEK_ISO = '2026-W20';

const BOC_RATE_URL  = 'https://www.bankofcanada.ca/core-functions/monetary-policy/key-interest-rates/';
const GOC_YIELD_URL = 'https://www.bankofcanada.ca/rates/interest-rates/canadian-bonds/';
const SOURCE        = 'Bank of Canada';

// ── data point builders ───────────────────────────────────────────────────────

function bocRatePoint(value, asOf) {
  return {
    metric:     'boc_overnight_rate',
    value,
    unit:       'percent',
    asOf,
    source:     SOURCE,
    sourceUrl:  BOC_RATE_URL,
    confidence: 'high',
  };
}

function yieldPoint(value, asOf) {
  return {
    metric:     'goc_5yr_yield',
    value,
    unit:       'percent',
    asOf,
    source:     SOURCE,
    sourceUrl:  GOC_YIELD_URL,
    confidence: 'high',
  };
}

// ── scenario filesystem builder ───────────────────────────────────────────────

async function buildScenarioDir(scenarioName, canadaFiles) {
  const tmpBase   = path.join(os.tmpdir(), `calibration-7-11-8-${scenarioName}`);
  const canadaDir = path.join(tmpBase, 'data', 'market', 'canada');

  await fs.rm(tmpBase, { recursive: true, force: true });
  await fs.mkdir(canadaDir, { recursive: true });

  for (const [filename, points] of Object.entries(canadaFiles)) {
    await fs.writeFile(
      path.join(canadaDir, filename),
      JSON.stringify(points, null, 2),
      'utf8'
    );
  }

  return tmpBase;
}

// ── output helpers ────────────────────────────────────────────────────────────

const LINE_WIDTH = 79;
const HEAVY_SEP  = '='.repeat(LINE_WIDTH);

function scenarioSep(label) {
  const prefix = `--- ${label} `;
  const pad    = Math.max(0, LINE_WIDTH - prefix.length);
  return prefix + '-'.repeat(pad);
}

function computeDistribution(angles) {
  const scores = angles.map(a => a.surpriseScore).sort((a, b) => a - b);
  const min    = scores[0];
  const max    = scores[scores.length - 1];
  const mean   = scores.reduce((s, v) => s + v, 0) / scores.length;
  return {
    min,
    max,
    mean,
    above70: scores.filter(s => s > 0.7).length,
    above85: scores.filter(s => s > 0.85).length,
    scores,
  };
}

function printScenarioResult(label, dataSummary, angles, expected, dumpPath) {
  console.log('');
  console.log(scenarioSep(label));
  console.log(`Data summary: ${dataSummary}`);
  console.log(`Full menu JSON: ${dumpPath}`);
  console.log('');
  console.log(`Angles generated: ${angles.length}`);
  angles.forEach((a, i) => {
    console.log(`  ${i + 1}. [${a.surpriseScore.toFixed(2)}] ${a.headline}`);
  });
  console.log('');
  const d = computeDistribution(angles);
  console.log('Distribution:');
  console.log(`  min:           ${d.min.toFixed(2)}`);
  console.log(`  max:           ${d.max.toFixed(2)}`);
  console.log(`  mean:          ${d.mean.toFixed(2)}`);
  console.log(`  above 0.7:     ${d.above70}`);
  console.log(`  above 0.85:    ${d.above85}`);
  console.log(`  full list:     [${d.scores.map(s => s.toFixed(2)).join(', ')}]`);
  console.log('');
  console.log(`Expected if calibrated: ${expected}`);
  console.log('Verdict (human-read):');
}

// ── scenario definitions ──────────────────────────────────────────────────────

const SCENARIOS = [
  {
    name:    'boring',
    label:   'BORING WEEK',
    summary: 'BoC rate held 2.25% for 199 days; 5yr yield +4bps over two weeks (3.18 -> 3.22%)',
    expected: 'all below 0.6',
    files: {
      // boc_overnight_rate: event_driven, asOf outside 14d window -- surfaces via event_driven fallback
      // goc_5yr_yield: monotonic +4bps drift; May 3 at window edge for delta14d
      '2026-W18.json': [
        bocRatePoint(2.25, '2025-10-30T00:00:00.000Z'),
        yieldPoint(3.18, '2026-05-03T12:00:00.000Z'),
      ],
      '2026-W19.json': [
        yieldPoint(3.20, '2026-05-10T12:00:00.000Z'),
      ],
      '2026-W20.json': [
        yieldPoint(3.22, '2026-05-17T12:00:00.000Z'),
      ],
    },
  },
  {
    name:    'surprising',
    label:   'SURPRISING WEEK',
    summary: 'BoC cut 25bps on May 14 after 200-day hold; 5yr yield fell 30bps (3.22 -> 2.92%) in 4 days',
    expected: '1-2 angles in 0.7-0.85 range',
    files: {
      // Both boc_overnight_rate observations are seeded:
      //   2.25% on 2025-10-30 (pre-window, carries "changed from" context)
      //   2.00% on 2026-05-14 (in-window, the cut event)
      // gatherDataSlice includes the last pre-window entry + all in-window entries,
      // so the slice observations array has 2 entries.
      '2026-W18.json': [
        bocRatePoint(2.25, '2025-10-30T00:00:00.000Z'),
        yieldPoint(3.22, '2026-05-03T12:00:00.000Z'),
      ],
      '2026-W19.json': [
        yieldPoint(3.18, '2026-05-10T12:00:00.000Z'),
      ],
      '2026-W20.json': [
        bocRatePoint(2.00, '2026-05-14T00:00:00.000Z'),
        yieldPoint(2.95, '2026-05-14T00:00:00.000Z'),
        yieldPoint(2.92, '2026-05-17T12:00:00.000Z'),
      ],
    },
  },
  {
    name:    'milestone',
    label:   'MILESTONE WEEK',
    summary: 'BoC held at 2.25% (199 days); 5yr yield fell 37bps (3.22 -> 2.85%) with no rate change',
    expected: 'at least one angle above 0.85',
    files: {
      // Cross-source contradiction: rate held, yield cratered anyway.
      // This is the specific pattern the spec calls out for 0.85+ scoring.
      '2026-W18.json': [
        bocRatePoint(2.25, '2025-10-30T00:00:00.000Z'),
        yieldPoint(3.22, '2026-05-03T12:00:00.000Z'),
      ],
      '2026-W19.json': [
        yieldPoint(3.20, '2026-05-10T12:00:00.000Z'),
      ],
      '2026-W20.json': [
        yieldPoint(2.95, '2026-05-14T00:00:00.000Z'),
        yieldPoint(2.85, '2026-05-17T12:00:00.000Z'),
      ],
    },
  },
];

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(HEAVY_SEP);
  console.log('PARKED 7.11.8 -- surpriseScore calibration check');
  console.log(`Run timestamp: ${new Date().toISOString()}`);
  if (DRY_RUN) console.log('Mode: DRY RUN (no Claude calls)');
  console.log(HEAVY_SEP);

  const collectedResults = [];
  const tmpDirs = [];

  for (const [i, scenario] of SCENARIOS.entries()) {
    console.log(`\n[seeding] ${scenario.label} ...`);

    const baseDir = await buildScenarioDir(scenario.name, scenario.files);
    tmpDirs.push(baseDir);

    // Print the data slice for every run (helps interpret angles in live mode too)
    const slice = await gatherDataSlice({ weekIso: WEEK_ISO, now: NOW, baseDir });
    console.log('');
    console.log(scenarioSep(`Scenario ${i + 1} data slice (DRY RUN)`));
    console.log(JSON.stringify(slice, null, 2));

    if (DRY_RUN) continue;

    console.log(`\n[running] ${scenario.label} ...`);

    const result = await generateWeeklyAngles({
      now:     NOW,
      weekIso: WEEK_ISO,
      baseDir,
    });

    const dumpPath = path.join(os.tmpdir(), `calibration-7-11-8-${scenario.name}-menu.json`);
    await fs.writeFile(
      dumpPath,
      JSON.stringify(
        { weekIso: result.weekIso, generatedAt: result.generatedAt, angles: result.angles },
        null,
        2
      ),
      'utf8'
    );

    collectedResults.push({ scenario, angles: result.angles, dumpPath });
    console.log(`[done]    ${scenario.label} -- ${result.angles.length} angles`);
  }

  if (DRY_RUN) {
    console.log('');
    console.log(HEAVY_SEP);
    console.log('DRY RUN COMPLETE -- no Claude calls were made');
    console.log(HEAVY_SEP);
    console.log('');
    console.log('Seeded tmpdirs (preserved for inspection):');
    for (const tmpDir of tmpDirs) {
      console.log(`  ${tmpDir}`);
    }
    process.exit(0);
  }

  // Per-scenario detail
  console.log('');
  console.log(HEAVY_SEP);
  for (const { scenario, angles, dumpPath } of collectedResults) {
    printScenarioResult(
      scenario.label,
      scenario.summary,
      angles,
      scenario.expected,
      dumpPath
    );
  }

  // Summary
  console.log('');
  console.log(HEAVY_SEP);
  console.log('SUMMARY ACROSS SCENARIOS');
  console.log(HEAVY_SEP);
  console.log('');
  console.log('Max surpriseScore by scenario:');
  for (const { scenario, angles } of collectedResults) {
    const max = Math.max(...angles.map(a => a.surpriseScore));
    console.log(`  ${scenario.label.padEnd(12)} ${max.toFixed(2)}`);
  }
  console.log('');
  console.log('If the prompt is calibrated: Boring max < Surprising max < Milestone max.');
  console.log('If the prompt is broken:     all three near 0.85+.');
  console.log('');
  console.log(HEAVY_SEP);

  // Cleanup scenario base dirs (dump files stay for inspection)
  for (const tmpDir of tmpDirs) {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
