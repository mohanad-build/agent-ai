// scripts/test-agent-state.js
//
// Tests for all three functions in src/agentState.js.
// Writes real files under agents/__test_agent_state__.state.json.
// Run: node scripts/test-agent-state.js

const fs = require('fs');
const path = require('path');
const { getState, setState, issueToken } = require('../src/agentState');

const TEST_AGENT_ID = '__test_agent_state__';
const STATE_FILE_PATH = path.join(__dirname, '..', 'agents', `${TEST_AGENT_ID}.state.json`);

function cleanup() {
  if (fs.existsSync(STATE_FILE_PATH)) fs.unlinkSync(STATE_FILE_PATH);
  if (fs.existsSync(STATE_FILE_PATH + '.tmp')) fs.unlinkSync(STATE_FILE_PATH + '.tmp');
}

function divider(char = '=', length = 80) {
  return char.repeat(length);
}

let checksPassed = 0;
let checksFailed = 0;

function check(description, condition) {
  if (condition) {
    checksPassed++;
    console.log(`  ✓ ${description}`);
  } else {
    checksFailed++;
    console.log(`  ✗ ${description}`);
  }
}

cleanup();

try {

  // -------------------------------------------------------------------------
  // getState
  // -------------------------------------------------------------------------

  console.log(divider());
  console.log('getState');
  console.log(divider());

  // 1. File missing -> returns default state
  cleanup();
  let state = getState(TEST_AGENT_ID);
  check('file missing: returns { lastTokenIssued: 0 }', state.lastTokenIssued === 0);

  // 2. File missing -> does NOT create the file
  cleanup();
  getState(TEST_AGENT_ID);
  check('file missing: file not created on disk', !fs.existsSync(STATE_FILE_PATH));

  // 3. After setState then getState -> returns written value
  cleanup();
  setState(TEST_AGENT_ID, { lastTokenIssued: 5 });
  state = getState(TEST_AGENT_ID);
  check('after setState({lastTokenIssued:5}): getState returns 5', state.lastTokenIssued === 5);

  // 4. Malformed JSON -> throws error containing "Malformed state file"
  cleanup();
  fs.writeFileSync(STATE_FILE_PATH, 'not valid json {{', 'utf8');
  let caughtError = null;
  try {
    getState(TEST_AGENT_ID);
  } catch (err) {
    caughtError = err;
  }
  check('malformed JSON: throws an Error', caughtError instanceof Error);
  check(
    'malformed JSON: error message contains "Malformed state file"',
    caughtError !== null && caughtError.message.includes('Malformed state file')
  );

  // -------------------------------------------------------------------------
  // setState
  // -------------------------------------------------------------------------

  console.log();
  console.log(divider());
  console.log('setState');
  console.log(divider());

  // 5. Writes file with correct content
  cleanup();
  setState(TEST_AGENT_ID, { lastTokenIssued: 7 });
  const raw = fs.readFileSync(STATE_FILE_PATH, 'utf8');
  const parsed = JSON.parse(raw);
  check('writes file: JSON.parse of file returns { lastTokenIssued: 7 }', parsed.lastTokenIssued === 7);

  // 6. Overwrites existing file
  cleanup();
  setState(TEST_AGENT_ID, { lastTokenIssued: 1 });
  setState(TEST_AGENT_ID, { lastTokenIssued: 99 });
  const overwritten = JSON.parse(fs.readFileSync(STATE_FILE_PATH, 'utf8'));
  check('overwrites existing file: lastTokenIssued === 99', overwritten.lastTokenIssued === 99);

  // 7. Atomic write: .tmp file must not exist after setState
  cleanup();
  setState(TEST_AGENT_ID, { lastTokenIssued: 3 });
  check('atomic write: .tmp file absent after setState', !fs.existsSync(STATE_FILE_PATH + '.tmp'));

  // 8. Parent directory creation -- skipped (agents/ always exists in this repo)
  // Skipped: agents/ directory always exists in this repo. mkdirSync recursive:true is a no-op when present.

  // -------------------------------------------------------------------------
  // issueToken
  // -------------------------------------------------------------------------

  console.log();
  console.log(divider());
  console.log('issueToken');
  console.log(divider());

  // 9. First call (no file) -> "Q1"
  cleanup();
  let token = issueToken(TEST_AGENT_ID);
  check('first call (no file): returns "Q1"', token === 'Q1');

  // 10. Second call -> "Q2"
  token = issueToken(TEST_AGENT_ID);
  check('second call: returns "Q2"', token === 'Q2');

  // 11. After 5 sequential calls: last token is "Q5", persisted state is 5
  cleanup();
  let last;
  for (let i = 0; i < 5; i++) {
    last = issueToken(TEST_AGENT_ID);
  }
  const finalState = getState(TEST_AGENT_ID);
  check('5 sequential calls: last returned token is "Q5"', last === 'Q5');
  check('5 sequential calls: getState().lastTokenIssued === 5', finalState.lastTokenIssued === 5);

  // 12. Token string format matches /^Q\d+$/
  cleanup();
  const formatToken = issueToken(TEST_AGENT_ID);
  check('token format matches /^Q\\d+$/', /^Q\d+$/.test(formatToken));

  // 13. Persistence: issueToken increments and persists before returning
  cleanup();
  issueToken(TEST_AGENT_ID);
  const stateAfter = getState(TEST_AGENT_ID);
  check('persistence: getState().lastTokenIssued === 1 after one issueToken call', stateAfter.lastTokenIssued === 1);

} finally {
  cleanup();
}

// -------------------------------------------------------------------------
// Summary
// -------------------------------------------------------------------------

console.log();
console.log(divider());
const total = checksPassed + checksFailed;
console.log(`Total: ${total} | Passed: ${checksPassed} | Failed: ${checksFailed}`);
console.log(divider());

process.exit(checksFailed > 0 ? 1 : 0);
