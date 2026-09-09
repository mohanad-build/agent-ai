'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');

const {
  AGENT_ID_REGEX,
  AGENT_FILE_BLOCKLIST,
  isAgentConfigFilename,
  discoverAgentIds,
} = require('../src/agentDiscovery');

// Imported, not hardcoded as 'sessions' or '_sessions': the point of this
// guard is that the *actual* directory the session store creates under
// STORAGE_ROOT (src/sessionStore.js, CASA 2.2.1's file-backed session
// store) is never adopted as a phantom agent, not that some string that
// merely looks like it isn't. A hardcoded guess would stop proving
// anything the moment the two names drifted apart.
const { SESSION_STORE_SUBDIR } = require('../src/sessionStore');

let tmpDir;

// AGENT_ID is cleared globally before every test (tests/setup/clearAgentIdEnv.js
// via jest.config.js's setupFilesAfterEnv), not here -- see that file for why
// a per-file delete alone is not reliable against dotenv's reload.
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentDiscovery-test-'));
  process.env.STORAGE_ROOT = tmpDir;
});

afterEach(() => {
  delete process.env.STORAGE_ROOT;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeAgentFile(name) {
  fs.writeFileSync(path.join(tmpDir, name), '{}');
}

// --------------------------------------------------------------------------
// AGENT_ID_REGEX contract
// --------------------------------------------------------------------------

describe('AGENT_ID_REGEX', () => {
  it('matches plain agent filenames', () => {
    expect(AGENT_ID_REGEX.test('mo-test.json')).toBe(true);
    expect(AGENT_ID_REGEX.test('assistant.json')).toBe(true);
    expect(AGENT_ID_REGEX.test('agent-42.json')).toBe(true);
  });

  it('rejects uppercase letters and underscores', () => {
    expect(AGENT_ID_REGEX.test('Mo-Test.json')).toBe(false);
    expect(AGENT_ID_REGEX.test('mo_test.json')).toBe(false);
  });

  // THE REGRESSION CASES: these are real companion files that sit in the
  // storage root today. An unanchored `f.endsWith('.json')` accepts every
  // one of them; every digest run was trying to load all three as agents,
  // saved only by a downstream isActive check.
  it('rejects mo-test.contentProfile.json', () => {
    expect(AGENT_ID_REGEX.test('mo-test.contentProfile.json')).toBe(false);
  });

  it('rejects mo-test.contentState.json', () => {
    expect(AGENT_ID_REGEX.test('mo-test.contentState.json')).toBe(false);
  });

  it('rejects mo-test.state.json', () => {
    expect(AGENT_ID_REGEX.test('mo-test.state.json')).toBe(false);
  });

  it('rejects a log file with .json nowhere near the end', () => {
    expect(AGENT_ID_REGEX.test('mo-test.digest-errors.log')).toBe(false);
  });

  // THE OTHER REGRESSION CASE: a crash-orphaned temp file, in either shape
  // a writer in this codebase has ever produced. An unanchored filter would
  // adopt either as a phantom agent holding a live copy of an encrypted
  // googleRefreshToken -- session 39's bug arriving by a new route.
  it('rejects the current temp-file shape, <id>.json.tmp', () => {
    expect(AGENT_ID_REGEX.test('mo-test.json.tmp')).toBe(false);
  });

  it('rejects the legacy temp-file shape, <id>.tmp.json', () => {
    expect(AGENT_ID_REGEX.test('mo-test.tmp.json')).toBe(false);
  });
});

// --------------------------------------------------------------------------
// isAgentConfigFilename: regex AND blocklist, one predicate
// --------------------------------------------------------------------------

describe('isAgentConfigFilename', () => {
  it('accepts a real agent filename', () => {
    expect(isAgentConfigFilename('mo-test.json')).toBe(true);
  });

  it('rejects example.json even though it satisfies the regex', () => {
    expect(AGENT_ID_REGEX.test('example.json')).toBe(true);
    expect(AGENT_FILE_BLOCKLIST.has('example.json')).toBe(true);
    expect(isAgentConfigFilename('example.json')).toBe(false);
  });

  it('rejects .gitkeep even though it satisfies the regex', () => {
    expect(isAgentConfigFilename('.gitkeep')).toBe(false);
  });

  it('rejects a companion file (regex alone would already reject it)', () => {
    expect(isAgentConfigFilename('mo-test.contentProfile.json')).toBe(false);
  });
});

// --------------------------------------------------------------------------
// discoverAgentIds
// --------------------------------------------------------------------------

describe('discoverAgentIds', () => {
  it('returns only valid agent ids, sorted, companion files and temp files excluded', () => {
    writeAgentFile('zebra.json');
    writeAgentFile('mo-test.json');
    writeAgentFile('mo-test.state.json');
    writeAgentFile('mo-test.contentProfile.json');
    writeAgentFile('mo-test.contentState.json');
    writeAgentFile('mo-test.json.tmp');
    writeAgentFile('mo-test.tmp.json');
    writeAgentFile('Mo-Test.json');
    writeAgentFile('mo_test.json');
    fs.writeFileSync(path.join(tmpDir, 'mo-test.digest-errors.log'), '');
    writeAgentFile('assistant.json');

    const ids = discoverAgentIds();

    expect(ids).toEqual(['assistant', 'mo-test', 'zebra']);
  });

  it('excludes blocklisted filenames', () => {
    writeAgentFile('example.json');
    writeAgentFile('real-agent.json');

    const ids = discoverAgentIds();

    expect(ids).toEqual(['real-agent']);
  });

  it('returns an empty array when the storage root does not exist', () => {
    process.env.STORAGE_ROOT = path.join(tmpDir, 'nonexistent');
    expect(discoverAgentIds()).toEqual([]);
  });

  it('returns an empty array when the storage root is empty', () => {
    expect(discoverAgentIds()).toEqual([]);
  });

  it('accepts an explicit baseDir override instead of STORAGE_ROOT', () => {
    const otherDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentDiscovery-other-'));
    try {
      fs.writeFileSync(path.join(otherDir, 'other-agent.json'), '{}');
      expect(discoverAgentIds({ baseDir: otherDir })).toEqual(['other-agent']);
    } finally {
      fs.rmSync(otherDir, { recursive: true, force: true });
    }
  });

  // THE SCOPING OVERRIDE: a flag some code paths honour and others ignore is
  // not a flag, it is a trap (this is why tokenMigration.js now imports this
  // module instead of silently ignoring AGENT_ID as it used to). Short-
  // circuits before ever touching the filesystem, so it wins even when the
  // directory has other, real agent files in it.
  it('process.env.AGENT_ID short-circuits to a single-element array', () => {
    writeAgentFile('mo-test.json');
    writeAgentFile('assistant.json');
    process.env.AGENT_ID = 'my-agent';

    expect(discoverAgentIds()).toEqual(['my-agent']);
  });

  // THE PHANTOM-AGENT GUARD (session 39's bug class arriving by a new
  // route): the session store now creates a real directory,
  // STORAGE_ROOT/<SESSION_STORE_SUBDIR>, sitting in the exact directory
  // discoverAgentIds scans. fs.readdirSync returns directory entries and
  // files alike with no type distinction applied before the filename
  // filter runs, so this directory is only excluded because
  // isAgentConfigFilename's regex is anchored on a literal .json suffix,
  // not because anything here knows it's a directory. Asserting this
  // rather than reasoning about it, per the recon that gated this change.
  it('never adopts the session store subdirectory as a phantom agent', () => {
    fs.mkdirSync(path.join(tmpDir, SESSION_STORE_SUBDIR));
    writeAgentFile('real-agent.json');

    expect(isAgentConfigFilename(SESSION_STORE_SUBDIR)).toBe(false);
    expect(discoverAgentIds()).toEqual(['real-agent']);
  });
});
