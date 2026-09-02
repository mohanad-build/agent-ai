'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');

jest.mock('../src/drive');
const drive = require('../src/drive');

const { ensureAgentParentFolder, ensureTransactionFolder, _internal } = require('../src/driveFolders');
const { loadAgent, patchAgent } = require('../src/agentConfig');
const { createTransaction, readTransaction } = require('../src/transactions/store');

const AGENT_ID = 'agent-a';
const CLOCK = new Date('2026-07-15T10:00:00.000Z');

let agentsDir;
let baseDir;

beforeEach(() => {
  jest.clearAllMocks();
  agentsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'driveFolders-agents-'));
  baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'driveFolders-txns-'));
  process.env.STORAGE_ROOT = agentsDir;
});

afterEach(() => {
  delete process.env.STORAGE_ROOT;
  fs.rmSync(agentsDir, { recursive: true, force: true });
  fs.rmSync(baseDir, { recursive: true, force: true });
});

function writeAgent(cfg) {
  fs.writeFileSync(path.join(agentsDir, `${AGENT_ID}.json`), JSON.stringify({ agentId: AGENT_ID, ...cfg }));
}

function createTxn(overrides = {}) {
  return createTransaction(
    AGENT_ID,
    { type: 'buyer_purchase', state: 'conditional', address: '12 Main St', ...overrides },
    { baseDir, now: CLOCK }
  );
}

describe('ensureAgentParentFolder', () => {
  test('creates the folder once, persists the id via patchAgent, and a second call makes zero Drive calls', async () => {
    writeAgent({});
    drive.createFolder.mockResolvedValue({ id: 'folder-parent-1', name: AGENT_ID, parents: undefined });

    const agentConfig = loadAgent(AGENT_ID);
    const folderId = await ensureAgentParentFolder(agentConfig);

    expect(folderId).toBe('folder-parent-1');
    expect(drive.createFolder).toHaveBeenCalledTimes(1);
    expect(loadAgent(AGENT_ID).driveParentFolderId).toBe('folder-parent-1');

    const reloaded = loadAgent(AGENT_ID);
    const secondFolderId = await ensureAgentParentFolder(reloaded);

    expect(secondFolderId).toBe('folder-parent-1');
    expect(drive.createFolder).toHaveBeenCalledTimes(1); // still 1, no new call
  });

  test('returns the persisted id directly with no Drive call when driveParentFolderId is already present', async () => {
    writeAgent({ driveParentFolderId: 'existing-folder' });
    const agentConfig = loadAgent(AGENT_ID);

    const folderId = await ensureAgentParentFolder(agentConfig);

    expect(folderId).toBe('existing-folder');
    expect(drive.createFolder).not.toHaveBeenCalled();
  });
});

describe('ensureTransactionFolder', () => {
  test('names the folder "<address> - <createdAt date>" and parents it to the agent parent folder', async () => {
    writeAgent({});
    drive.createFolder
      .mockResolvedValueOnce({ id: 'folder-parent-1', name: AGENT_ID, parents: undefined })
      .mockResolvedValueOnce({ id: 'folder-txn-1', name: '12 Main St - 2026-07-15', parents: ['folder-parent-1'] });

    const agentConfig = loadAgent(AGENT_ID);
    const transaction = createTxn();

    const folderId = await ensureTransactionFolder(agentConfig, transaction, { baseDir });

    expect(folderId).toBe('folder-txn-1');
    expect(drive.createFolder).toHaveBeenCalledTimes(2);
    expect(drive.createFolder).toHaveBeenNthCalledWith(
      2,
      agentConfig,
      '12 Main St - 2026-07-15',
      { parentId: 'folder-parent-1' }
    );

    const onDisk = readTransaction(AGENT_ID, transaction.transactionId, { baseDir });
    expect(onDisk.driveFolderId).toBe('folder-txn-1');
  });

  test('a second call returns the stored id and makes zero Drive calls', async () => {
    writeAgent({ driveParentFolderId: 'folder-parent-1' });
    drive.createFolder.mockResolvedValue({ id: 'folder-txn-1', name: 'x', parents: ['folder-parent-1'] });

    const agentConfig = loadAgent(AGENT_ID);
    const transaction = createTxn();

    const firstId = await ensureTransactionFolder(agentConfig, transaction, { baseDir });
    expect(drive.createFolder).toHaveBeenCalledTimes(1);

    const reloaded = readTransaction(AGENT_ID, transaction.transactionId, { baseDir });
    const secondId = await ensureTransactionFolder(agentConfig, reloaded, { baseDir });

    expect(secondId).toBe(firstId);
    expect(drive.createFolder).toHaveBeenCalledTimes(1); // still 1
  });

  test('a messy address produces a clean folder name, and the stored address is byte-identical afterwards', async () => {
    writeAgent({ driveParentFolderId: 'folder-parent-1' });
    drive.createFolder.mockResolvedValue({ id: 'folder-txn-1', name: 'x', parents: ['folder-parent-1'] });

    const messyAddress = '  12   Main   St  ';
    const agentConfig = loadAgent(AGENT_ID);
    const transaction = createTxn({ address: messyAddress });

    await ensureTransactionFolder(agentConfig, transaction, { baseDir });

    expect(drive.createFolder).toHaveBeenCalledWith(
      agentConfig,
      '12 Main St - 2026-07-15',
      { parentId: 'folder-parent-1' }
    );

    const onDisk = readTransaction(AGENT_ID, transaction.transactionId, { baseDir });
    expect(onDisk.address).toBe(messyAddress); // untouched, verbatim, whitespace and all
  });

  test('appends NO event to the transaction event log', async () => {
    writeAgent({ driveParentFolderId: 'folder-parent-1' });
    drive.createFolder.mockResolvedValue({ id: 'folder-txn-1', name: 'x', parents: ['folder-parent-1'] });

    const agentConfig = loadAgent(AGENT_ID);
    const transaction = createTxn();
    const eventsBefore = transaction.events;

    await ensureTransactionFolder(agentConfig, transaction, { baseDir });

    const onDisk = readTransaction(AGENT_ID, transaction.transactionId, { baseDir });
    expect(onDisk.events).toEqual(eventsBefore);
  });

  test('propagates a Drive failure without writing driveFolderId onto the record', async () => {
    writeAgent({ driveParentFolderId: 'folder-parent-1' });
    drive.createFolder.mockRejectedValue(new Error('Drive returned 500'));

    const agentConfig = loadAgent(AGENT_ID);
    const transaction = createTxn();

    await expect(ensureTransactionFolder(agentConfig, transaction, { baseDir })).rejects.toThrow('Drive returned 500');

    const onDisk = readTransaction(AGENT_ID, transaction.transactionId, { baseDir });
    expect('driveFolderId' in onDisk).toBe(false);
  });
});

describe('_internal.buildTransactionFolderName', () => {
  test('trims and collapses internal whitespace without touching the source object', () => {
    const transaction = { address: '  12   Main   St  ', createdAt: '2026-07-15T10:00:00.000Z' };
    expect(_internal.buildTransactionFolderName(transaction)).toBe('12 Main St - 2026-07-15');
    expect(transaction.address).toBe('  12   Main   St  ');
  });
});
