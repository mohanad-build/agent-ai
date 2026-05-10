// scripts/test-leadIntake.js
//
// Unit tests for src/leadIntake.js.
// No live API calls. gmail and email modules are mocked via require-cache patching
// after they are loaded, since leadIntake.js calls gmail.method() and email.method()
// (not destructured imports), which allows per-test mock injection.
//
// Covers:
//   - getSenderEmail / getSenderDomain helpers
//   - parseClassifierResponse: valid JSON, code-fence stripping, unknown category, bad JSON
//   - applyPreFilter: all 10 fixtures + idempotency label check
//   - processClassification branching: lead (new row), lead (low confidence), noise, biz
//   - Dedup: existing Sheet row triggers re-engagement log instead of new row
//   - LEAD_INTAKE_MAX_PER_CYCLE constant and CALENDAR_DOMAINS set
//
// Usage: node scripts/test-leadIntake.js

require('dotenv').config();

const gmail = require('../src/gmail');
const email = require('../src/email');
const claude = require('../src/claude');

const leadIntake = require('../src/leadIntake');
const {
  _internal: {
    applyPreFilter,
    parseClassifierResponse,
    getSenderEmail,
    getSenderDomain,
    processClassification,
    LABEL_PROCESSING,
    LABEL_INTAKEN,
    LABEL_NOISE,
    LABEL_FIRST_TOUCH_PENDING,
    CALENDAR_DOMAINS,
    labelIdCache,
    transitionToIntaken,
  },
  LEAD_INTAKE_MAX_PER_CYCLE,
} = leadIntake;

const fixtures = require('./test-leadIntake-fixtures.json');

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
// Mock helpers
// ---------------------------------------------------------------------------

const MOCK_LABEL_MAP = new Map([
  [LABEL_PROCESSING, 'Label_PROCESSING'],
  [LABEL_INTAKEN, 'Label_INTAKEN'],
  [LABEL_NOISE, 'Label_NOISE'],
  [LABEL_FIRST_TOUCH_PENDING, 'Label_FIRST_TOUCH_PENDING'],
]);

const MOCK_AGENT = { agentId: 'test-agent', googleSheetId: 'sheet-id', googleRefreshToken: 'token' };

// Pre-populate the label cache so processClassification does not call listLabels.
function setupLabelMocks() {
  labelIdCache.clear();
  labelIdCache.set(MOCK_AGENT.agentId, MOCK_LABEL_MAP);
}

// Side-effect tracking
let appendSheetRowCalled = false;
let appendToHistoryCalled = false;
let applyLabelsCalled = false;
let markReadCalled = false;
let capturedAddLabelIds = null;
let capturedRemoveLabelIds = null;
let capturedSheetRow = null;
let capturedHistoryEntry = null;

function resetTracking() {
  appendSheetRowCalled = false;
  appendToHistoryCalled = false;
  applyLabelsCalled = false;
  markReadCalled = false;
  capturedAddLabelIds = null;
  capturedRemoveLabelIds = null;
  capturedSheetRow = null;
  capturedHistoryEntry = null;
}

function installMocks() {
  email.appendSheetRow = async (agentConfig, rowData) => {
    appendSheetRowCalled = true;
    capturedSheetRow = rowData;
  };
  email.appendToConversationHistory = async (agentConfig, rowIndex, entry) => {
    appendToHistoryCalled = true;
    capturedHistoryEntry = entry;
  };
  email.readSheetRows = async () => [];

  gmail.applyMessageLabels = async (_agent, _msgId, addLabelIds, removeLabelIds) => {
    applyLabelsCalled = true;
    capturedAddLabelIds = Array.isArray(addLabelIds) ? addLabelIds.slice() : [];
    capturedRemoveLabelIds = Array.isArray(removeLabelIds) ? removeLabelIds.slice() : [];
  };
  gmail.markRead = async () => { markReadCalled = true; };
  gmail.listLabels = async () => [
    { name: LABEL_PROCESSING, id: 'Label_PROCESSING' },
    { name: LABEL_INTAKEN, id: 'Label_INTAKEN' },
    { name: LABEL_NOISE, id: 'Label_NOISE' },
    { name: LABEL_FIRST_TOUCH_PENDING, id: 'Label_FIRST_TOUCH_PENDING' },
  ];
  gmail.createLabel = async (agentConfig, name) => ({ id: 'Label_NEW_' + name });

  // Safety net: if any test accidentally triggers callClassifier -> claude.callRaw,
  // return a benign business_correspondence response instead of hitting the real API.
  claude.callRaw = async () => '{"category":"business_correspondence","confidence":0.5,"name":"","email":"","phone":"","inquiryMessage":"","propertyReference":"","reasoning":"mock"}';
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  installMocks();

  console.log(divider('='));
  console.log('LEAD INTAKE UNIT TEST');
  console.log(divider('='));
  console.log();

  // -------------------------------------------------------------------------
  // SECTION 1: getSenderEmail / getSenderDomain
  // -------------------------------------------------------------------------
  console.log(divider('-'));
  console.log('SECTION 1: getSenderEmail / getSenderDomain');
  console.log(divider('-'));

  check('getSenderEmail: angle bracket format', getSenderEmail('John Smith <john@example.com>') === 'john@example.com');
  check('getSenderEmail: bare address format', getSenderEmail('john@example.com') === 'john@example.com');
  check('getSenderEmail: empty string returns empty', getSenderEmail('') === '');
  check('getSenderDomain: extracts domain correctly', getSenderDomain('john@example.com') === 'example.com');
  check('getSenderDomain: empty input returns empty', getSenderDomain('') === '');

  console.log();

  // -------------------------------------------------------------------------
  // SECTION 2: parseClassifierResponse
  // -------------------------------------------------------------------------
  console.log(divider('-'));
  console.log('SECTION 2: parseClassifierResponse');
  console.log(divider('-'));

  const validJson = '{"category":"lead","confidence":0.9,"name":"John","email":"john@example.com","phone":"","inquiryMessage":"buying","propertyReference":"","reasoning":"clear lead"}';
  const parsedValid = parseClassifierResponse(validJson);
  check('parseClassifierResponse: valid JSON returns object', parsedValid && typeof parsedValid === 'object');
  check('parseClassifierResponse: category extracted correctly', parsedValid.category === 'lead');
  check('parseClassifierResponse: confidence extracted correctly', parsedValid.confidence === 0.9);

  const fencedJson = '```json\n' + validJson + '\n```';
  const parsedFenced = parseClassifierResponse(fencedJson);
  check('parseClassifierResponse: strips markdown code fences', parsedFenced.category === 'lead');

  let threwOnUnknownCategory = false;
  try {
    parseClassifierResponse('{"category":"unknown_xyz","confidence":0.5,"name":"","email":"","phone":"","inquiryMessage":"","propertyReference":"","reasoning":""}');
  } catch (e) {
    threwOnUnknownCategory = true;
  }
  check('parseClassifierResponse: throws on unknown category', threwOnUnknownCategory);

  let threwOnBadJson = false;
  try {
    parseClassifierResponse('not valid json at all');
  } catch (e) {
    threwOnBadJson = true;
  }
  check('parseClassifierResponse: throws on invalid JSON', threwOnBadJson);

  let threwOnMissingCategory = false;
  try {
    parseClassifierResponse('{"confidence":0.5,"name":"","email":"","phone":"","inquiryMessage":"","propertyReference":"","reasoning":"no category field"}');
  } catch (e) {
    threwOnMissingCategory = true;
  }
  check('parseClassifierResponse: throws when category field is missing', threwOnMissingCategory);

  let parsedNoise;
  try {
    parsedNoise = parseClassifierResponse('{"category":"noise","confidence":0.92,"name":"","email":"","phone":"","inquiryMessage":"","propertyReference":"","reasoning":"automated"}');
  } catch (e) {
    parsedNoise = null;
  }
  check('parseClassifierResponse: noise is a valid category', parsedNoise !== null && parsedNoise.category === 'noise');

  console.log();

  // -------------------------------------------------------------------------
  // SECTION 3: applyPreFilter (10 fixtures + idempotency)
  // -------------------------------------------------------------------------
  console.log(divider('-'));
  console.log('SECTION 3: applyPreFilter (10 fixtures + idempotency)');
  console.log(divider('-'));

  for (const fixture of fixtures) {
    const result = applyPreFilter(fixture.msg, MOCK_LABEL_MAP);
    const expected = fixture.expected_prefilter_result;
    if (expected.pass) {
      check(
        'Fixture ' + fixture.id + ' passes pre-filter (' + fixture.description + ')',
        result.pass === true
      );
    } else {
      check(
        'Fixture ' + fixture.id + ' blocked by pre-filter (' + fixture.description + ')',
        result.pass === false
      );
      if (expected.reason) {
        check(
          'Fixture ' + fixture.id + ' reason: "' + expected.reason + '"',
          result.reason === expected.reason
        );
      }
    }
  }

  // Idempotency: message already labeled agent-ai/processing is blocked
  const alreadyProcessedMsg = {
    messageId: 'msg_idem',
    from: 'test@example.com',
    subject: 'Hello there I want to buy a home',
    body: 'Looking to buy a home in the spring',
    inReplyTo: '',
    labelIds: ['Label_PROCESSING'],
    threadId: 'thread_idem',
  };
  const idempotencyResult = applyPreFilter(alreadyProcessedMsg, MOCK_LABEL_MAP);
  check('Idempotency: message with processing label is blocked', idempotencyResult.pass === false);

  // Idempotency: message already labeled agent-ai/intaken is blocked
  const alreadyIntakenMsg = Object.assign({}, alreadyProcessedMsg, {
    messageId: 'msg_idem2',
    labelIds: ['Label_INTAKEN'],
  });
  const idempotencyResult2 = applyPreFilter(alreadyIntakenMsg, MOCK_LABEL_MAP);
  check('Idempotency: message with intaken label is blocked', idempotencyResult2.pass === false);

  // Idempotency: message already labeled agent-ai/first-touch-pending is blocked
  const alreadyFirstTouchMsg = Object.assign({}, alreadyProcessedMsg, {
    messageId: 'msg_idem3',
    labelIds: ['Label_FIRST_TOUCH_PENDING'],
  });
  const idempotencyResult3 = applyPreFilter(alreadyFirstTouchMsg, MOCK_LABEL_MAP);
  check('Idempotency: message with first-touch-pending label is blocked', idempotencyResult3.pass === false);

  console.log();

  // -------------------------------------------------------------------------
  // SECTION 4: processClassification branching
  // -------------------------------------------------------------------------
  console.log(divider('-'));
  console.log('SECTION 4: processClassification branching');
  console.log(divider('-'));

  const leadMsg = fixtures[0].msg;
  const leadClassification = fixtures[0].expected_classification;
  const noiseMsg = fixtures[6].msg;
  const noiseClassification = fixtures[6].expected_classification;
  const bizMsg = fixtures[3].msg;
  const bizClassification = fixtures[3].expected_classification;

  // Test A: lead with confidence >= 0.6, sender not in Sheet -> new row + first-touch-pending label, NO markRead
  resetTracking();
  setupLabelMocks();
  const statsA = { leads: 0, noise: 0, businessCorrespondence: 0, errors: 0 };
  await processClassification(MOCK_AGENT, leadMsg, leadClassification, [], statsA);
  check('Lead (new): appendSheetRow called', appendSheetRowCalled === true);
  check('Lead (new, high confidence): aiEnabled set to TRUE', capturedSheetRow !== null && capturedSheetRow.aiEnabled === 'TRUE');
  check('Lead (new): source set to inbox', capturedSheetRow !== null && capturedSheetRow.source === 'inbox');
  check('Lead (new): stats.leads incremented to 1', statsA.leads === 1);
  check('Lead (new): markRead NOT called (left unread for Reply Detection)', markReadCalled === false);
  check('Lead (new): applyMessageLabels called with first-touch-pending label', capturedAddLabelIds !== null && capturedAddLabelIds.includes('Label_FIRST_TOUCH_PENDING'));
  check('Lead (new): lastActionTimestamp NOT written (intake is not a path action)', capturedSheetRow !== null && (!capturedSheetRow.lastActionTimestamp || capturedSheetRow.lastActionTimestamp === ''));

  // Test A2: lead with 0.6 <= confidence < 0.85 -> new row, but aiEnabled stays FALSE
  resetTracking();
  setupLabelMocks();
  const midConfClassification = Object.assign({}, leadClassification, { confidence: 0.75 });
  const statsA2 = { leads: 0, noise: 0, businessCorrespondence: 0, errors: 0 };
  await processClassification(MOCK_AGENT, leadMsg, midConfClassification, [], statsA2);
  check('Lead (new, mid confidence): appendSheetRow called', appendSheetRowCalled === true);
  check('Lead (new, mid confidence): aiEnabled set to FALSE', capturedSheetRow !== null && capturedSheetRow.aiEnabled === 'FALSE');
  check('Lead (new, mid confidence): stats.leads incremented to 1', statsA2.leads === 1);

  // Test B: lead with confidence < 0.6 -> treated as business_correspondence
  resetTracking();
  setupLabelMocks();
  const lowConfClassification = Object.assign({}, leadClassification, { confidence: 0.55 });
  const statsB = { leads: 0, noise: 0, businessCorrespondence: 0, errors: 0 };
  await processClassification(MOCK_AGENT, leadMsg, lowConfClassification, [], statsB);
  check('Lead (low confidence): appendSheetRow NOT called', appendSheetRowCalled === false);
  check('Lead (low confidence): stats.businessCorrespondence incremented', statsB.businessCorrespondence === 1);
  check('Lead (low confidence): markRead NOT called', markReadCalled === false);

  // Test C: noise with confidence >= 0.85 -> noise label + mark read, no sheet row
  resetTracking();
  setupLabelMocks();
  const statsC = { leads: 0, noise: 0, businessCorrespondence: 0, errors: 0 };
  await processClassification(MOCK_AGENT, noiseMsg, noiseClassification, [], statsC);
  check('Noise: appendSheetRow NOT called', appendSheetRowCalled === false);
  check('Noise: applyMessageLabels called', applyLabelsCalled === true);
  check('Noise: markRead called', markReadCalled === true);
  check('Noise: stats.noise incremented to 1', statsC.noise === 1);

  // Test D: noise with confidence < 0.85 -> treated as business_correspondence
  resetTracking();
  setupLabelMocks();
  const lowConfNoise = Object.assign({}, noiseClassification, { confidence: 0.7 });
  const statsD = { leads: 0, noise: 0, businessCorrespondence: 0, errors: 0 };
  await processClassification(MOCK_AGENT, noiseMsg, lowConfNoise, [], statsD);
  check('Noise (low confidence): markRead NOT called', markReadCalled === false);
  check('Noise (low confidence): stats.businessCorrespondence incremented', statsD.businessCorrespondence === 1);

  // Test E: business_correspondence -> no sheet row, no mark read, BUT removes processing label
  resetTracking();
  setupLabelMocks();
  const statsE = { leads: 0, noise: 0, businessCorrespondence: 0, errors: 0 };
  await processClassification(MOCK_AGENT, bizMsg, bizClassification, [], statsE);
  check('Biz correspondence: appendSheetRow NOT called', appendSheetRowCalled === false);
  check('Biz correspondence: markRead NOT called', markReadCalled === false);
  check('Biz correspondence: applyMessageLabels called to remove processing label', applyLabelsCalled === true);
  check('Biz correspondence: stats.businessCorrespondence incremented', statsE.businessCorrespondence === 1);

  console.log();

  // -------------------------------------------------------------------------
  // SECTION 5: dedup
  // -------------------------------------------------------------------------
  console.log(divider('-'));
  console.log('SECTION 5: dedup - existing sender in Sheet');
  console.log(divider('-'));

  resetTracking();
  setupLabelMocks();
  const existingRows = [
    {
      rowIndex: 5,
      leadId: 'john.smith@gmail.com',
      lastActionTimestamp: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
    },
  ];
  const statsF = { leads: 0, noise: 0, businessCorrespondence: 0, errors: 0 };
  await processClassification(MOCK_AGENT, leadMsg, leadClassification, existingRows, statsF);
  check('Dedup: appendToConversationHistory called instead of appendSheetRow', appendToHistoryCalled === true);
  check('Dedup: appendSheetRow NOT called', appendSheetRowCalled === false);
  check('Dedup: re-engagement log entry starts with "Re-engagement"', capturedHistoryEntry !== null && capturedHistoryEntry.startsWith('Re-engagement'));
  check('Dedup: stats.leads still incremented (re-engagement counts as lead intake)', statsF.leads === 1);

  console.log();

  // -------------------------------------------------------------------------
  // SECTION 6: constants
  // -------------------------------------------------------------------------
  console.log(divider('-'));
  console.log('SECTION 6: constants and CALENDAR_DOMAINS');
  console.log(divider('-'));

  check('LEAD_INTAKE_MAX_PER_CYCLE is 20', LEAD_INTAKE_MAX_PER_CYCLE === 20);
  check('CALENDAR_DOMAINS contains google.com', CALENDAR_DOMAINS.has('google.com'));
  check('CALENDAR_DOMAINS contains calendly.com', CALENDAR_DOMAINS.has('calendly.com'));
  check('CALENDAR_DOMAINS contains googleusercontent.com', CALENDAR_DOMAINS.has('googleusercontent.com'));
  check('CALENDAR_DOMAINS does not contain realtor.ca', !CALENDAR_DOMAINS.has('realtor.ca'));

  console.log();

  // -------------------------------------------------------------------------
  // SECTION 7: transitionToIntaken
  // -------------------------------------------------------------------------
  console.log(divider('-'));
  console.log('SECTION 7: transitionToIntaken (label swap on path success)');
  console.log(divider('-'));

  // Test: transitionToIntaken applies intaken label and removes first-touch-pending
  resetTracking();
  setupLabelMocks();
  await transitionToIntaken(MOCK_AGENT, 'msg_swap_test');
  check('transitionToIntaken: applyMessageLabels was called', applyLabelsCalled === true);
  check('transitionToIntaken: addLabelIds includes intaken', capturedAddLabelIds !== null && capturedAddLabelIds.includes('Label_INTAKEN'));
  check('transitionToIntaken: addLabelIds does NOT include first-touch-pending', capturedAddLabelIds !== null && !capturedAddLabelIds.includes('Label_FIRST_TOUCH_PENDING'));
  check('transitionToIntaken: removeLabelIds includes first-touch-pending', capturedRemoveLabelIds !== null && capturedRemoveLabelIds.includes('Label_FIRST_TOUCH_PENDING'));
  check('transitionToIntaken: removeLabelIds does NOT include intaken', capturedRemoveLabelIds !== null && !capturedRemoveLabelIds.includes('Label_INTAKEN'));

  // Test: transitionToIntaken swallows errors gracefully (best-effort)
  resetTracking();
  setupLabelMocks();
  gmail.applyMessageLabels = async () => {
    throw new Error('simulated Gmail API failure');
  };
  let threwError = false;
  try {
    await transitionToIntaken(MOCK_AGENT, 'msg_error_test');
  } catch (err) {
    threwError = true;
  }
  check('transitionToIntaken: does not throw on Gmail API failure (best-effort)', threwError === false);

  console.log();

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------
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

main().catch((err) => {
  console.error('Test runner error: ' + err.message);
  console.error(err.stack);
  process.exit(1);
});
