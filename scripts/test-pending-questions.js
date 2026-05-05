// scripts/test-pending-questions.js
//
// Unit tests for all four functions in src/pendingQuestions.js.
// Run: node scripts/test-pending-questions.js

const {
  parsePendingQuestions,
  serializePendingQuestions,
  findEntryByToken,
  removeEntryByToken,
} = require('../src/pendingQuestions');

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

// ---------------------------------------------------------------------------
// parsePendingQuestions
// ---------------------------------------------------------------------------

console.log(divider());
console.log('parsePendingQuestions');
console.log(divider());

// 1. Empty string
let result = parsePendingQuestions('');
check('empty string returns []', Array.isArray(result) && result.length === 0);

// 2. null
result = parsePendingQuestions(null);
check('null returns []', Array.isArray(result) && result.length === 0);

// 3. undefined
result = parsePendingQuestions(undefined);
check('undefined returns []', Array.isArray(result) && result.length === 0);

// 4. Whitespace-only
result = parsePendingQuestions('   ');
check('whitespace-only string returns []', Array.isArray(result) && result.length === 0);

// 5. Single entry
result = parsePendingQuestions("[Q47] What's the square footage?");
check(
  'single entry: length is 1',
  result.length === 1
);
check(
  "single entry: token is 'Q47'",
  result.length === 1 && result[0].token === 'Q47'
);
check(
  "single entry: question is \"What's the square footage?\"",
  result.length === 1 && result[0].question === "What's the square footage?"
);

// 6. Two entries
result = parsePendingQuestions("[Q47] What's the square footage? || [Q48] Is there parking?");
check('two entries: length is 2', result.length === 2);
check("two entries: first token is 'Q47'", result[0].token === 'Q47');
check("two entries: first question correct", result[0].question === "What's the square footage?");
check("two entries: second token is 'Q48'", result[1].token === 'Q48');
check("two entries: second question correct", result[1].question === 'Is there parking?');

// 7. Three entries with tokens Q1, Q47, Q1234
result = parsePendingQuestions('[Q1] Short question || [Q47] Medium length question here || [Q1234] What about a very long token number?');
check('three entries: length is 3', result.length === 3);
check("three entries: token Q1 preserved exactly", result[0].token === 'Q1');
check("three entries: token Q47 preserved exactly", result[1].token === 'Q47');
check("three entries: token Q1234 preserved exactly", result[2].token === 'Q1234');

// 8. Malformed entry mixed with valid entries
result = parsePendingQuestions('[Q47] valid one || not a valid entry || [Q48] another valid');
check('malformed mixed: length is 2', result.length === 2);
check("malformed mixed: first token is 'Q47'", result[0].token === 'Q47');
check("malformed mixed: second token is 'Q48'", result[1].token === 'Q48');

// 9. Question containing brackets -- greedy match should capture full question
result = parsePendingQuestions('[Q47] What about [Q99] (no idea)?');
check('brackets in question: length is 1', result.length === 1);
check("brackets in question: token is 'Q47'", result.length === 1 && result[0].token === 'Q47');
check(
  "brackets in question: full question captured including inner brackets",
  result.length === 1 && result[0].question === 'What about [Q99] (no idea)?'
);

// 10. Question containing separator literal -- known limitation
// "[Q47] den || office combo" splits into two parts on ' || '.
// First part "[Q47] den" parses as token Q47, question "den".
// Second part "office combo" does not match regex, silently dropped.
result = parsePendingQuestions('[Q47] den || office combo');
check(
  'separator in question (known limitation): length is 1',
  result.length === 1
);
check(
  'separator in question (known limitation): token is Q47',
  result.length === 1 && result[0].token === 'Q47'
);
check(
  'separator in question (known limitation): question is "den" (truncated at separator)',
  result.length === 1 && result[0].question === 'den'
);

// 11. Lowercase q should NOT match (regex requires uppercase Q)
result = parsePendingQuestions('[q47] foo');
check('lowercase [q47] does not match, returns []', Array.isArray(result) && result.length === 0);

// ---------------------------------------------------------------------------
// serializePendingQuestions
// ---------------------------------------------------------------------------

console.log();
console.log(divider());
console.log('serializePendingQuestions');
console.log(divider());

// 12. Empty array
let str = serializePendingQuestions([]);
check('empty array returns ""', str === '');

// 13. Non-array input: null
str = serializePendingQuestions(null);
check('null input returns ""', str === '');

// 13b. Non-array input: undefined
str = serializePendingQuestions(undefined);
check('undefined input returns ""', str === '');

// 14. Single entry
str = serializePendingQuestions([{ token: 'Q47', question: "What's the square footage?" }]);
check(
  "single entry serializes to \"[Q47] What's the square footage?\"",
  str === "[Q47] What's the square footage?"
);

// 15. Multiple entries joined with ' || '
str = serializePendingQuestions([
  { token: 'Q47', question: "What's the square footage?" },
  { token: 'Q48', question: 'Is there parking?' },
]);
check(
  'two entries joined with " || "',
  str === "[Q47] What's the square footage? || [Q48] Is there parking?"
);

// 16. Round-trip: parse a 3-entry string, serialize, get back original
const original = "[Q10] First question here || [Q20] Second question here || [Q30] Third question here";
const parsed = parsePendingQuestions(original);
const reserialized = serializePendingQuestions(parsed);
check('round-trip: parsed length is 3', parsed.length === 3);
check('round-trip: reserialized matches original exactly', reserialized === original);

// ---------------------------------------------------------------------------
// findEntryByToken
// ---------------------------------------------------------------------------

console.log();
console.log(divider());
console.log('findEntryByToken');
console.log(divider());

const sampleEntries = [
  { token: 'Q47', question: "What's the square footage?" },
  { token: 'Q48', question: 'Is there parking?' },
  { token: 'Q49', question: 'When was the roof done?' },
];

// 17. Empty array
let found = findEntryByToken([], 'Q47');
check('empty array returns null', found === null);

// 18. Exact case match
found = findEntryByToken(sampleEntries, 'Q47');
check('exact case match returns correct entry', found !== null && found.token === 'Q47' && found.question === "What's the square footage?");

// 19. Lowercase input matches uppercase stored token
found = findEntryByToken(sampleEntries, 'q48');
check('lowercase token matches uppercase stored entry', found !== null && found.token === 'Q48');

// 20. Token not in list
found = findEntryByToken(sampleEntries, 'Q99');
check('token not in list returns null', found === null);

// 21. Null token
found = findEntryByToken(sampleEntries, null);
check('null token returns null', found === null);

// 21b. Undefined token
found = findEntryByToken(sampleEntries, undefined);
check('undefined token returns null', found === null);

// 22. Non-array entries
found = findEntryByToken(null, 'Q47');
check('null entries returns null', found === null);

// ---------------------------------------------------------------------------
// removeEntryByToken
// ---------------------------------------------------------------------------

console.log();
console.log(divider());
console.log('removeEntryByToken');
console.log(divider());

const threeEntries = [
  { token: 'Q47', question: "What's the square footage?" },
  { token: 'Q48', question: 'Is there parking?' },
  { token: 'Q49', question: 'When was the roof done?' },
];

// 23. Remove from middle, original not mutated
const afterRemove = removeEntryByToken(threeEntries, 'Q48');
check('remove from middle: result length is 2', afterRemove.length === 2);
check('remove from middle: Q48 is gone', afterRemove.every((e) => e.token !== 'Q48'));
check('remove from middle: Q47 remains', afterRemove.some((e) => e.token === 'Q47'));
check('remove from middle: Q49 remains', afterRemove.some((e) => e.token === 'Q49'));
check('remove from middle: original array not mutated (still length 3)', threeEntries.length === 3);
check('remove from middle: result is a new array (different reference)', afterRemove !== threeEntries);

// 24. Remove non-existent token returns copy, not same reference
const copyResult = removeEntryByToken(threeEntries, 'Q99');
check('remove non-existent: length unchanged', copyResult.length === 3);
check('remove non-existent: result is a new array reference', copyResult !== threeEntries);

// 25. Case-insensitive removal
const caseResult = removeEntryByToken(threeEntries, 'q47');
check('case-insensitive remove: Q47 is gone', caseResult.every((e) => e.token !== 'Q47'));
check('case-insensitive remove: length is 2', caseResult.length === 2);

// 26. Empty array
const emptyResult = removeEntryByToken([], 'Q47');
check('empty array input returns empty array', Array.isArray(emptyResult) && emptyResult.length === 0);

// 27. Null/undefined entries
const nullResult = removeEntryByToken(null, 'Q47');
check('null entries input returns empty array', Array.isArray(nullResult) && nullResult.length === 0);

const undefinedResult = removeEntryByToken(undefined, 'Q47');
check('undefined entries input returns empty array', Array.isArray(undefinedResult) && undefinedResult.length === 0);

// 28. Null token on non-empty array returns copy unchanged
const nullTokenResult = removeEntryByToken(threeEntries, null);
check('null token: length unchanged', nullTokenResult.length === 3);
check('null token: result is a new array reference', nullTokenResult !== threeEntries);

const undefinedTokenResult = removeEntryByToken(threeEntries, undefined);
check('undefined token: length unchanged', undefinedTokenResult.length === 3);
check('undefined token: result is a new array reference', undefinedTokenResult !== threeEntries);

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log();
console.log(divider());
const total = checksPassed + checksFailed;
console.log(`Total: ${total} | Passed: ${checksPassed} | Failed: ${checksFailed}`);
console.log(divider());

process.exit(checksFailed > 0 ? 1 : 0);
