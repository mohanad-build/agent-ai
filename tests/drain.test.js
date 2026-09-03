'use strict';

const fs   = require('node:fs');
const os   = require('node:os');
const path = require('node:path');

const { drainFilings, MAX_ATTEMPTS } = require('../src/drain');
const gmailAttachments = require('../src/gmailAttachments');
const driveFolders = require('../src/driveFolders');
const drive = require('../src/drive');
const filings = require('../src/transactions/filings');
const { createTransaction, readTransaction } = require('../src/transactions/store');

const AGENT_ID = 'test-agent';
const CLOCK = new Date('2026-07-15T10:00:00.000Z');
const AT = '2026-07-16T09:30:00.000Z';
const LATER = new Date(AT);
const THREAD_ID = 'thread-abc123';
const MESSAGE_ID = 'msg-1';
const ATTACHMENT_ID = 'att-1';

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'drain-test-'));
}

let baseDir;
let spies;

beforeEach(() => {
  baseDir = makeTmpDir();
  spies = [];
});

afterEach(() => {
  spies.forEach((s) => s.mockRestore());
  fs.rmSync(baseDir, { recursive: true, force: true });
});

function spyOn(obj, method) {
  const s = jest.spyOn(obj, method);
  spies.push(s);
  return s;
}

function agentConfig(overrides = {}) {
  return { agentId: AGENT_ID, gmailAddress: 'agent@rlp.ca', ...overrides };
}

function create(overrides = {}) {
  return createTransaction(
    AGENT_ID,
    { type: 'buyer_purchase', state: 'conditional', address: '12 Main St', ...overrides },
    { baseDir, now: CLOCK }
  );
}

function seeFiling(transactionId, overrides = {}) {
  const messageId = overrides.messageId || MESSAGE_ID;
  const attachmentId = overrides.attachmentId || ATTACHMENT_ID;
  return filings.recordDocumentSeen(AGENT_ID, transactionId, messageId, attachmentId, {
    at: AT,
    actor: 'system',
    filename: 'agreement.pdf',
    mimeType: 'application/pdf',
    size: 2048,
    threadId: THREAD_ID,
    sender: 'Lawyer <lawyer@firm.com>',
    receivedAt: '2026-07-14T08:00:00.000Z',
    subject: 'APS',
    baseDir,
    now: LATER,
    ...overrides,
  });
}

function opts(overrides = {}) {
  return { at: AT, actor: 'system', baseDir, now: LATER, ...overrides };
}

function mockHappyPath({ driveFileId = 'drive-file-1', contentHash = 'sha256:abc123' } = {}) {
  spyOn(gmailAttachments, 'fetchAttachmentBytes').mockResolvedValue({
    buffer: Buffer.from('bytes'),
    contentHash,
  });
  spyOn(driveFolders, 'ensureTransactionFolder').mockResolvedValue('folder-1');
  spyOn(drive, 'uploadFile').mockResolvedValue({
    id: driveFileId,
    name: 'x',
    webViewLink: 'https://drive.example/x',
    parents: ['folder-1'],
  });
}

describe('drainFilings', () => {
  it('drains a seen filing end to end: fetches, ensures the folder, uploads, and records filed', async () => {
    const created = create();
    seeFiling(created.transactionId);
    mockHappyPath();

    await drainFilings(agentConfig(), opts());

    const key = filings.buildFilingKey(MESSAGE_ID, ATTACHMENT_ID);
    const reread = readTransaction(AGENT_ID, created.transactionId, { baseDir });
    expect(reread.filings[key].status).toBe('filed');
    expect(reread.filings[key].driveFileId).toBe('drive-file-1');
    expect(reread.filings[key].contentHash).toBe('sha256:abc123');
  });

  it('does nothing for a filing not at status seen', async () => {
    const created = create();
    seeFiling(created.transactionId);
    mockHappyPath();
    // First drain files it (status -> filed).
    await drainFilings(agentConfig(), opts());
    const fetchSpy = gmailAttachments.fetchAttachmentBytes;
    fetchSpy.mockClear();

    // Second drain finds nothing at 'seen' left to do.
    await drainFilings(agentConfig(), opts({ at: '2026-07-16T09:35:00.000Z', now: new Date('2026-07-16T09:35:00.000Z') }));

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does not re-hash: contentHash is exactly what fetchAttachmentBytes returned, untouched', async () => {
    const created = create();
    seeFiling(created.transactionId);
    mockHappyPath({ contentHash: 'sha256:whatever-the-fetch-said' });

    await drainFilings(agentConfig(), opts());

    const key = filings.buildFilingKey(MESSAGE_ID, ATTACHMENT_ID);
    const reread = readTransaction(AGENT_ID, created.transactionId, { baseDir });
    expect(reread.filings[key].contentHash).toBe('sha256:whatever-the-fetch-said');
  });

  describe('the Drive filename', () => {
    it('is built from receivedAt (YYYY-MM-DD), the parsed display name, and the stored filename', async () => {
      const created = create();
      seeFiling(created.transactionId, { sender: 'Jane Smith <jane@firm.com>', receivedAt: '2026-07-14T08:00:00.000Z' });
      mockHappyPath();
      const uploadSpy = drive.uploadFile;

      await drainFilings(agentConfig(), opts());

      expect(uploadSpy).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ name: '2026-07-14 - from Jane Smith - agreement.pdf' })
      );
    });

    it('falls back to the raw address when the From header has no display name', async () => {
      const created = create();
      seeFiling(created.transactionId, { sender: 'jane@firm.com', receivedAt: '2026-07-14T08:00:00.000Z' });
      mockHappyPath();
      const uploadSpy = drive.uploadFile;

      await drainFilings(agentConfig(), opts());

      expect(uploadSpy).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ name: '2026-07-14 - from jane@firm.com - agreement.pdf' })
      );
    });

    it('falls back to "unknown sender" when the stored sender is empty', async () => {
      const created = create();
      seeFiling(created.transactionId, { sender: '', receivedAt: '2026-07-14T08:00:00.000Z' });
      mockHappyPath();
      const uploadSpy = drive.uploadFile;

      await drainFilings(agentConfig(), opts());

      expect(uploadSpy).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ name: '2026-07-14 - from unknown sender - agreement.pdf' })
      );
    });

    // THE POINT of keeping receivedAt distinct from seenAt: a fixture where
    // they're equal would pass even if the filename were built from the
    // wrong field. This one sets them several days apart, the exact
    // situation TC_SPEC 7.14 says will happen in production (a document
    // that arrives before its transaction is opened).
    it('uses receivedAt, not seenAt, even when they differ by several days', async () => {
      const created = create();
      seeFiling(created.transactionId, {
        at: '2026-07-20T09:30:00.000Z', // seenAt: five days after the message actually arrived
        receivedAt: '2026-07-15T08:00:00.000Z',
        now: new Date('2026-07-20T09:30:00.000Z'),
      });
      mockHappyPath();
      const uploadSpy = drive.uploadFile;

      await drainFilings(agentConfig(), opts());

      expect(uploadSpy).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ name: expect.stringContaining('2026-07-15') })
      );
      expect(uploadSpy).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ name: expect.stringContaining('2026-07-20') })
      );
    });

    it('sanitizes path separators and control characters out of the sender label and filename', async () => {
      const created = create();
      seeFiling(created.transactionId, {
        sender: 'Evil <evil@x.com>',
        filename: '../../etc/passwd.pdf',
        receivedAt: '2026-07-14T08:00:00.000Z',
      });
      mockHappyPath();
      const uploadSpy = drive.uploadFile;

      await drainFilings(agentConfig(), opts());

      const [, uploadArgs] = uploadSpy.mock.calls[0];
      expect(uploadArgs.name).not.toMatch(/[\\/]/);
      expect(uploadArgs.name.startsWith('.')).toBe(false);
    });
  });

  describe('failure and the attempts incrementer', () => {
    it('on a fetch failure, records an attempt failure naming the step, leaving status at seen', async () => {
      const created = create();
      seeFiling(created.transactionId);
      spyOn(gmailAttachments, 'fetchAttachmentBytes').mockRejectedValue(new Error('network blew up'));

      await drainFilings(agentConfig(), opts());

      const key = filings.buildFilingKey(MESSAGE_ID, ATTACHMENT_ID);
      const reread = readTransaction(AGENT_ID, created.transactionId, { baseDir });
      expect(reread.filings[key].status).toBe('seen');
      expect(reread.filings[key].attempts).toBe(1);
      expect(reread.filings[key].lastError).toBe('fetch failed: network blew up');
      expect(reread.filings[key].lastAttemptAt).toBe(AT);
    });

    it('names the folder step when ensureTransactionFolder fails', async () => {
      const created = create();
      seeFiling(created.transactionId);
      spyOn(gmailAttachments, 'fetchAttachmentBytes').mockResolvedValue({ buffer: Buffer.from('x'), contentHash: 'sha256:x' });
      spyOn(driveFolders, 'ensureTransactionFolder').mockRejectedValue(new Error('drive outage'));

      await drainFilings(agentConfig(), opts());

      const key = filings.buildFilingKey(MESSAGE_ID, ATTACHMENT_ID);
      const reread = readTransaction(AGENT_ID, created.transactionId, { baseDir });
      expect(reread.filings[key].lastError).toBe('folder failed: drive outage');
    });

    it('names the upload step when uploadFile fails', async () => {
      const created = create();
      seeFiling(created.transactionId);
      spyOn(gmailAttachments, 'fetchAttachmentBytes').mockResolvedValue({ buffer: Buffer.from('x'), contentHash: 'sha256:x' });
      spyOn(driveFolders, 'ensureTransactionFolder').mockResolvedValue('folder-1');
      spyOn(drive, 'uploadFile').mockRejectedValue(new Error('quota exceeded'));

      await drainFilings(agentConfig(), opts());

      const key = filings.buildFilingKey(MESSAGE_ID, ATTACHMENT_ID);
      const reread = readTransaction(AGENT_ID, created.transactionId, { baseDir });
      expect(reread.filings[key].lastError).toBe('upload failed: quota exceeded');
    });

    it('abandons after MAX_ATTEMPTS consecutive failures, and not before', async () => {
      const created = create();
      seeFiling(created.transactionId);
      spyOn(gmailAttachments, 'fetchAttachmentBytes').mockRejectedValue(new Error('boom'));
      const key = filings.buildFilingKey(MESSAGE_ID, ATTACHMENT_ID);

      for (let i = 1; i < MAX_ATTEMPTS; i++) {
        await drainFilings(agentConfig(), opts());
        const midway = readTransaction(AGENT_ID, created.transactionId, { baseDir });
        expect(midway.filings[key].status).toBe('seen');
        expect(midway.filings[key].attempts).toBe(i);
      }

      await drainFilings(agentConfig(), opts());

      const reread = readTransaction(AGENT_ID, created.transactionId, { baseDir });
      expect(reread.filings[key].status).toBe('abandoned');
      expect(reread.filings[key].attempts).toBe(MAX_ATTEMPTS);
      expect(reread.filings[key].lastError).toBe('fetch failed: boom');
    });

    it('one filing failing does not stop the next filing on the same agent from draining', async () => {
      const created = create();
      seeFiling(created.transactionId, { messageId: 'msg-fails', attachmentId: 'att-fails' });
      seeFiling(created.transactionId, { messageId: 'msg-succeeds', attachmentId: 'att-succeeds' });

      spyOn(gmailAttachments, 'fetchAttachmentBytes').mockImplementation(async (_agentConfig, messageId) => {
        if (messageId === 'msg-fails') throw new Error('boom');
        return { buffer: Buffer.from('b'), contentHash: 'sha256:b' };
      });
      spyOn(driveFolders, 'ensureTransactionFolder').mockResolvedValue('folder-1');
      spyOn(drive, 'uploadFile').mockResolvedValue({ id: 'drive-succeeds', name: 'x', webViewLink: 'y', parents: [] });

      await drainFilings(agentConfig(), opts());

      const keyFails = filings.buildFilingKey('msg-fails', 'att-fails');
      const keySucceeds = filings.buildFilingKey('msg-succeeds', 'att-succeeds');
      const reread = readTransaction(AGENT_ID, created.transactionId, { baseDir });
      expect(reread.filings[keyFails].status).toBe('seen');
      expect(reread.filings[keyFails].attempts).toBe(1);
      expect(reread.filings[keySucceeds].status).toBe('filed');
    });

    // Regression test: ensureTransactionFolder (driveFolders.js) persists
    // whatever transaction object its caller hands it. If drainFilings
    // handed it the entries snapshot taken at the top of the function
    // instead of a fresh read, the folder-creation write for the SECOND
    // filing on this transaction would silently overwrite the FIRST
    // filing's attempt-failure write, since that stale snapshot predates it.
    //
    // This deliberately does NOT mock driveFolders.ensureTransactionFolder
    // as a black box, unlike every other test in this file: doing that would
    // bypass the exact store.writeTransaction call this test exists to catch
    // a regression in, and a first version of this test that did mock it
    // that way passed whether the fix was present or not -- it never
    // actually exercised the code path it was written to guard. Only
    // drive.createFolder (the real Google API boundary) is mocked here; the
    // real ensureTransactionFolder and ensureAgentParentFolder run.
    // driveParentFolderId is pre-set on agentConfig so ensureAgentParentFolder
    // short-circuits without its own drive.createFolder/patchAgent calls,
    // leaving exactly one drive.createFolder call: ensureTransactionFolder's
    // own, for the transaction folder.
    it('a second filing on the same transaction creating the folder does not clobber an earlier failed filing on the same transaction', async () => {
      const created = create();
      seeFiling(created.transactionId, { messageId: 'msg-A', attachmentId: 'att-A' });
      seeFiling(created.transactionId, { messageId: 'msg-B', attachmentId: 'att-B' });

      spyOn(gmailAttachments, 'fetchAttachmentBytes').mockImplementation(async (_agentConfig, messageId) => {
        if (messageId === 'msg-A') throw new Error('boom A');
        return { buffer: Buffer.from('b'), contentHash: 'sha256:b' };
      });
      const createFolderSpy = spyOn(drive, 'createFolder').mockResolvedValue({ id: 'folder-1', name: 'x', parents: ['parent-1'] });
      spyOn(drive, 'uploadFile').mockResolvedValue({ id: 'drive-B', name: 'x', webViewLink: 'y', parents: [] });

      await drainFilings(agentConfig({ driveParentFolderId: 'parent-1' }), opts());

      const keyA = filings.buildFilingKey('msg-A', 'att-A');
      const keyB = filings.buildFilingKey('msg-B', 'att-B');
      const reread = readTransaction(AGENT_ID, created.transactionId, { baseDir });
      expect(reread.filings[keyA].status).toBe('seen');
      expect(reread.filings[keyA].attempts).toBe(1);
      expect(reread.filings[keyA].lastError).toBe('fetch failed: boom A');
      expect(reread.filings[keyB].status).toBe('filed');
      expect(createFolderSpy).toHaveBeenCalledTimes(1);
    });

    // THE SEQUENTIAL-LOOP GUARANTEE. Two filings on the same transaction,
    // both ultimately failing, with their processing forced to genuinely
    // interleave via manually-controlled (not real-timer) deferred promises:
    // real setTimeout delays would make this flaky under CI load, since the
    // relative order of two independently-scheduled short timers is not
    // guaranteed. Deferred promises resolved by hand from the test, with
    // microtask flushes in between, are deterministic instead: the ordering
    // is driven by explicit calls in this test, not by wall-clock racing.
    //
    // This exercises the SAME real ensureTransactionFolder path as the
    // regression test above (only drive.createFolder is mocked), because
    // that is the one place in this whole module where a write is built
    // from a snapshot taken before the write actually happens -- the gap
    // between ensureTransactionFolder's own internal awaits (ensuring the
    // parent folder, then creating the folder) and its store.writeTransaction
    // call is exactly the window a concurrent implementation could let
    // another filing's write land in.
    //
    // The assertion is on the LOST WRITE, not on call ordering: both
    // filings' failures must survive, full stop. A call-order assertion
    // would pass a broken refactor that happens to preserve ordering while
    // still losing data through a different path.
    it('does not lose one filing\'s recorded failure when its slow folder-creation write brackets a second filing\'s fast failure on the same transaction', async () => {
      const created = create();
      seeFiling(created.transactionId, { messageId: 'msg-A', attachmentId: 'att-A' });
      seeFiling(created.transactionId, { messageId: 'msg-B', attachmentId: 'att-B' });

      function makeDeferred() {
        let resolve, reject;
        const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
        promise.catch(() => {}); // silence "unhandled rejection" before drain.js ever awaits this
        return { promise, resolve, reject };
      }
      async function flush(times = 10) {
        for (let i = 0; i < times; i++) await Promise.resolve();
      }

      const fetchA = makeDeferred();
      const fetchB = makeDeferred();
      const createFolder = makeDeferred();

      spyOn(gmailAttachments, 'fetchAttachmentBytes').mockImplementation(async (_agentConfig, messageId) => {
        return messageId === 'msg-A' ? fetchA.promise : fetchB.promise;
      });
      // Only drive.createFolder is mocked (deferred): ensureTransactionFolder
      // and ensureAgentParentFolder run for real, same as the regression
      // test above, so the write this test targets is the genuine one.
      spyOn(drive, 'createFolder').mockImplementation(() => createFolder.promise);
      spyOn(drive, 'uploadFile').mockRejectedValue(new Error('upload boom'));

      const drainPromise = drainFilings(agentConfig({ driveParentFolderId: 'parent-1' }), opts());
      await flush();

      // A's fetch succeeds, carrying A through to (and suspending inside)
      // the folder-creation await -- this is where a fresh pre-read snapshot
      // for A gets taken, before B has done anything at all.
      fetchA.resolve({ buffer: Buffer.from('a'), contentHash: 'sha256:a' });
      await flush();

      // While A's folder creation is still pending, B fails fast and writes
      // its own failure to disk.
      fetchB.reject(new Error('fetch B boom'));
      await flush();

      // Only now does A's slow folder creation resolve. Under the shipped
      // sequential implementation, B has not even started at this point (A's
      // whole iteration, including its own eventual write, finishes before
      // B's begins), so there is nothing of B's for A's write to clobber.
      // Under a concurrent implementation, A's pre-read snapshot predates
      // B's already-completed write, and finishing the folder creation now
      // would silently revert it.
      createFolder.resolve({ id: 'folder-1', name: 'x', parents: ['parent-1'] });
      await drainPromise;

      const keyA = filings.buildFilingKey('msg-A', 'att-A');
      const keyB = filings.buildFilingKey('msg-B', 'att-B');
      const reread = readTransaction(AGENT_ID, created.transactionId, { baseDir });

      expect(reread.filings[keyA].attempts).toBe(1);
      expect(reread.filings[keyA].lastError).toBe('upload failed: upload boom');
      // THE ASSERTION THAT MATTERS: B's failure must still be there.
      expect(reread.filings[keyB].attempts).toBe(1);
      expect(reread.filings[keyB].lastError).toBe('fetch failed: fetch B boom');
    });
  });

  describe('no index over filing status', () => {
    it('reads via queries.readAllTransactions and finds a seen filing without any separate status index', async () => {
      const created = create();
      seeFiling(created.transactionId);
      mockHappyPath();

      await drainFilings(agentConfig(), opts());

      const key = filings.buildFilingKey(MESSAGE_ID, ATTACHMENT_ID);
      const reread = readTransaction(AGENT_ID, created.transactionId, { baseDir });
      expect(reread.filings[key].status).toBe('filed');
    });

    it('drains filings across more than one transaction for the same agent', async () => {
      const first = create({ address: '12 Main St' });
      const second = create({ address: '99 Other Ave' });
      seeFiling(first.transactionId, { messageId: 'msg-first', attachmentId: 'att-first' });
      seeFiling(second.transactionId, { messageId: 'msg-second', attachmentId: 'att-second' });
      mockHappyPath();

      await drainFilings(agentConfig(), opts());

      const rereadFirst = readTransaction(AGENT_ID, first.transactionId, { baseDir });
      const rereadSecond = readTransaction(AGENT_ID, second.transactionId, { baseDir });
      const keyFirst = filings.buildFilingKey('msg-first', 'att-first');
      const keySecond = filings.buildFilingKey('msg-second', 'att-second');
      expect(rereadFirst.filings[keyFirst].status).toBe('filed');
      expect(rereadSecond.filings[keySecond].status).toBe('filed');
    });
  });
});
