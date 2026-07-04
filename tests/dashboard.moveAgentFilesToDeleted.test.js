'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');

const { moveAgentFilesToDeleted } = require('../src/routes/dashboard');

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dashboard-delete-'));
  process.env.STORAGE_ROOT = tmpDir;
});

afterEach(() => {
  delete process.env.STORAGE_ROOT;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function findDeletedSubdir(agentId) {
  const deletedRoot = path.join(tmpDir, '_deleted');
  const entries = fs.readdirSync(deletedRoot);
  const match = entries.find((e) => e.startsWith(`${agentId}-`));
  return match ? path.join(deletedRoot, match) : null;
}

describe('moveAgentFilesToDeleted', () => {
  it('moves the full file family by prefix boundary, leaving unrelated and decoy files behind', () => {
    const fooFiles = [
      'foo.json',
      'foo.state.json',
      'foo.contentProfile.json',
      'foo.contentState.json',
      'foo.content-engine-errors.log',
    ];
    for (const f of fooFiles) fs.writeFileSync(path.join(tmpDir, f), '{}');
    fs.writeFileSync(path.join(tmpDir, 'bar.json'), '{}');
    fs.writeFileSync(path.join(tmpDir, 'foo-2.json'), '{}');

    const moved = moveAgentFilesToDeleted('foo');

    expect(moved.slice().sort()).toEqual(fooFiles.slice().sort());

    for (const f of fooFiles) {
      expect(fs.existsSync(path.join(tmpDir, f))).toBe(false);
    }

    expect(fs.existsSync(path.join(tmpDir, 'bar.json'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'foo-2.json'))).toBe(true);

    const destDir = findDeletedSubdir('foo');
    expect(destDir).not.toBeNull();
    for (const f of fooFiles) {
      expect(fs.existsSync(path.join(destDir, f))).toBe(true);
    }
  });

  it('returns an empty array and moves nothing when no files match', () => {
    fs.writeFileSync(path.join(tmpDir, 'bar.json'), '{}');

    const moved = moveAgentFilesToDeleted('nonexistent');

    expect(moved).toEqual([]);
    expect(fs.existsSync(path.join(tmpDir, '_deleted'))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, 'bar.json'))).toBe(true);
  });
});
