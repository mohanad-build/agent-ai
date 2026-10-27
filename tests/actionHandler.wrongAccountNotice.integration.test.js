'use strict';

// Real disk, real store/agentConfig/agentDiscovery/queries -- only gmail is
// mocked, at the boundary (the same split digest.integration.deals.test.js
// uses for twilio/email/agentState). This is the one place that can prove
// the owner lookup is genuinely disk-based: content.actionHandler.test.js
// mocks src/transactions/store directly, which makes it unsafe to exercise
// discoverAgentIds against a real STORAGE_ROOT there (see that file's own
// light-touch test and its comment for why).

jest.mock('../src/gmail', () => ({
  fetchUnreadInboxEmails: jest.fn(),
  markRead:               jest.fn(),
  sendNewEmail:           jest.fn(),
}));

const fs   = require('node:fs');
const os   = require('node:os');
const path = require('node:path');

const gmail = require('../src/gmail');
const store = require('../src/transactions/store');
const { runActionHandler, _internal } = require('../src/content/actionHandler');

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wrongAccountNotice-integration-test-'));
}

function writeAgentConfig(baseDir, agentId, fields) {
  fs.writeFileSync(path.join(baseDir, `${agentId}.json`), JSON.stringify({ agentId, ...fields }), 'utf8');
}

function writeAssistantToken(baseDir) {
  fs.writeFileSync(path.join(baseDir, 'assistant.json'), JSON.stringify({ googleRefreshToken: 'fake-refresh-token' }), 'utf8');
}

const NOW = new Date('2026-10-27T11:00:00.000Z');
const PASSING_AUTH_RESULTS = { trusted: true, reason: 'ok', dmarc: 'pass', dkim: 'pass', spf: 'pass', fromDomain: 'gmail.com' };
const NOT_AUTOMATED = { automated: false, reason: null };

function makeTapMsg(overrides = {}) {
  return {
    messageId: 'msg-1',
    from: 'Wrong Account <wrong@gmail.com>',
    subject: '',
    body: '',
    snippet: '',
    automation: NOT_AUTOMATED,
    authResults: PASSING_AUTH_RESULTS,
    ...overrides,
  };
}

let baseDir;
let _origStorageRoot;
let _origMockNow;

beforeEach(() => {
  baseDir = makeTmpDir();
  _origStorageRoot = process.env.STORAGE_ROOT;
  process.env.STORAGE_ROOT = baseDir;
  _origMockNow = process.env.MOCK_NOW;
  process.env.MOCK_NOW = NOW.toISOString();

  writeAssistantToken(baseDir);
  gmail.fetchUnreadInboxEmails.mockResolvedValue([]);
  gmail.markRead.mockResolvedValue();
  gmail.sendNewEmail.mockResolvedValue();
  _internal._resetCooldowns();
});

afterEach(() => {
  fs.rmSync(baseDir, { recursive: true, force: true });
  if (_origStorageRoot === undefined) delete process.env.STORAGE_ROOT; else process.env.STORAGE_ROOT = _origStorageRoot;
  if (_origMockNow === undefined) delete process.env.MOCK_NOW; else process.env.MOCK_NOW = _origMockNow;
  jest.clearAllMocks();
});

describe('wrong-account tap notice, real disk', () => {
  test('1. owner found: notice sent to the real gmailAddress, naming the deal address and the wrong From; existing wrong-address reply also sent; the deal file is untouched', async () => {
    writeAgentConfig(baseDir, 'agent-owner', { gmailAddress: 'owner@example.com' });
    const owned = store.createTransaction(
      'agent-owner',
      { type: 'buyer_purchase', state: 'conditional', address: '1 Livecheck Test St' },
      { baseDir, now: NOW }
    );
    const before = fs.readFileSync(store._internal.transactionPath(baseDir, 'agent-owner', owned.transactionId), 'utf8');

    const msg = makeTapMsg({ subject: `RECEIPT ${owned.transactionId} brokerage_deposit_receipt_received` });
    gmail.fetchUnreadInboxEmails.mockResolvedValue([msg]);

    // allAgentConfigs deliberately does NOT include agent-owner: the
    // owner lookup must find them from disk regardless.
    await runActionHandler([]);

    expect(gmail.sendNewEmail).toHaveBeenCalledTimes(2);
    expect(gmail.sendNewEmail).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ to: 'wrong@gmail.com', subject: 'GetKlosed: email address not recognized' })
    );
    expect(gmail.sendNewEmail).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        to: 'owner@example.com',
        subject: 'GetKlosed: a request for 1 Livecheck Test St came from an unrecognized address',
        body:
          "A request for 1 Livecheck Test St came in from wrong@gmail.com, which isn't the email address your GetKlosed account is set up with. Nothing was changed.\n\n" +
          "If that was you, please send it again from owner@example.com. When you resend it, check that the From line says owner@example.com before you press Send.\n\n" +
          "If that wasn't you, you don't need to do anything.",
      })
    );

    const after = fs.readFileSync(store._internal.transactionPath(baseDir, 'agent-owner', owned.transactionId), 'utf8');
    expect(after).toBe(before);
  });

  test('2. lapsed login: the owner is on disk but absent from allAgentConfigs (and a different agent is present), yet still gets the notice', async () => {
    writeAgentConfig(baseDir, 'agent-lapsed', { gmailAddress: 'lapsed@example.com' });
    const owned = store.createTransaction(
      'agent-lapsed',
      { type: 'seller_sale', state: 'conditional', address: '2 Lapsed Login Ave' },
      { baseDir, now: NOW }
    );

    const msg = makeTapMsg({ subject: `DONE ${owned.transactionId} some_item` });
    gmail.fetchUnreadInboxEmails.mockResolvedValue([msg]);

    // A different, unrelated agent IS present in allAgentConfigs, making
    // explicit that agent-lapsed's absence is the point, not an accident
    // of an empty array.
    const otherAgent = { agentId: 'other-agent', gmailAddress: 'other@example.com' };

    await runActionHandler([otherAgent]);

    expect(gmail.sendNewEmail).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ to: 'lapsed@example.com', subject: 'GetKlosed: a request for 2 Lapsed Login Ave came from an unrecognized address' })
    );
  });

  test('3. cooldown: a second tap on the same (agent, transaction) within 24h is suppressed, even from a different wrong address; the existing wrong-address reply is unaffected either time', async () => {
    writeAgentConfig(baseDir, 'agent-owner', { gmailAddress: 'owner@example.com' });
    const owned = store.createTransaction(
      'agent-owner',
      { type: 'buyer_purchase', state: 'conditional', address: '3 Cooldown Rd' },
      { baseDir, now: NOW }
    );

    const firstMsg = makeTapMsg({ messageId: 'msg-first', from: 'Wrong One <wrong1@gmail.com>', subject: `RECEIPT ${owned.transactionId} brokerage_deposit_receipt_received` });
    gmail.fetchUnreadInboxEmails.mockResolvedValue([firstMsg]);
    await runActionHandler([]);
    expect(gmail.sendNewEmail).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({ to: 'owner@example.com' }));
    gmail.sendNewEmail.mockClear();

    const secondMsg = makeTapMsg({ messageId: 'msg-second', from: 'Wrong Two <wrong2@gmail.com>', subject: `RECEIPT ${owned.transactionId} brokerage_deposit_receipt_received` });
    gmail.fetchUnreadInboxEmails.mockResolvedValue([secondMsg]);
    await runActionHandler([]);

    // Still gets the wrong-address reply (a different sender address, not
    // yet in that OTHER cooldown), but not a second owner notice.
    expect(gmail.sendNewEmail).toHaveBeenCalledTimes(1);
    expect(gmail.sendNewEmail).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ to: 'wrong2@gmail.com', subject: 'GetKlosed: email address not recognized' })
    );
    expect(gmail.sendNewEmail).not.toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({ to: 'owner@example.com' }));
  });

  test("4. unknown transaction id: no agent owns it, falls back to today's behaviour (wrong-address reply only)", async () => {
    writeAgentConfig(baseDir, 'agent-owner', { gmailAddress: 'owner@example.com' });
    store.createTransaction('agent-owner', { type: 'buyer_purchase', state: 'conditional', address: '4 Unrelated St' }, { baseDir, now: NOW });

    const msg = makeTapMsg({ subject: 'RECEIPT txn-20261027-ffffffff brokerage_deposit_receipt_received' });
    gmail.fetchUnreadInboxEmails.mockResolvedValue([msg]);

    await runActionHandler([]);

    expect(gmail.sendNewEmail).toHaveBeenCalledTimes(1);
    expect(gmail.sendNewEmail).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ to: 'wrong@gmail.com', subject: 'GetKlosed: email address not recognized' })
    );
  });

  test("5. ambiguous owner (manufactured collision): falls back to today's behaviour the same way", async () => {
    writeAgentConfig(baseDir, 'agent-a', { gmailAddress: 'a@example.com' });
    writeAgentConfig(baseDir, 'agent-b', { gmailAddress: 'b@example.com' });
    const sharedId = 'txn-20261027-c0ffee00';
    const dirA = store._internal.transactionsDir(baseDir, 'agent-a');
    const dirB = store._internal.transactionsDir(baseDir, 'agent-b');
    fs.mkdirSync(dirA, { recursive: true });
    fs.mkdirSync(dirB, { recursive: true });
    const envelope = {
      schemaVersion: 1, transactionId: sharedId, type: 'buyer_purchase', state: 'conditional',
      address: '5 Collision Ct', createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(),
    };
    fs.writeFileSync(path.join(dirA, `${sharedId}.json`), JSON.stringify({ ...envelope, agentId: 'agent-a' }), 'utf8');
    fs.writeFileSync(path.join(dirB, `${sharedId}.json`), JSON.stringify({ ...envelope, agentId: 'agent-b' }), 'utf8');

    const msg = makeTapMsg({ subject: `RECEIPT ${sharedId} brokerage_deposit_receipt_received` });
    gmail.fetchUnreadInboxEmails.mockResolvedValue([msg]);

    await runActionHandler([]);

    expect(gmail.sendNewEmail).toHaveBeenCalledTimes(1);
    expect(gmail.sendNewEmail).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ to: 'wrong@gmail.com', subject: 'GetKlosed: email address not recognized' })
    );
  });

  test('6. a corrupt file for an unrelated agent, at the same id, does not block the real owner end to end', async () => {
    writeAgentConfig(baseDir, 'agent-corrupt', {});
    writeAgentConfig(baseDir, 'agent-real', { gmailAddress: 'real@example.com' });
    const targetId = 'txn-20261027-deadbeef';
    const corruptDir = store._internal.transactionsDir(baseDir, 'agent-corrupt');
    fs.mkdirSync(corruptDir, { recursive: true });
    fs.writeFileSync(path.join(corruptDir, `${targetId}.json`), '{ not valid json', 'utf8');

    const realDir = store._internal.transactionsDir(baseDir, 'agent-real');
    fs.mkdirSync(realDir, { recursive: true });
    const realEnvelope = {
      schemaVersion: 1, transactionId: targetId, agentId: 'agent-real', type: 'buyer_purchase', state: 'conditional',
      address: '6 Real Owner Blvd', createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(),
    };
    fs.writeFileSync(path.join(realDir, `${targetId}.json`), JSON.stringify(realEnvelope), 'utf8');

    const msg = makeTapMsg({ subject: `RECEIPT ${targetId} brokerage_deposit_receipt_received` });
    gmail.fetchUnreadInboxEmails.mockResolvedValue([msg]);

    await runActionHandler([]);

    expect(gmail.sendNewEmail).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ to: 'real@example.com', subject: 'GetKlosed: a request for 6 Real Owner Blvd came from an unrecognized address' })
    );
  });
});
