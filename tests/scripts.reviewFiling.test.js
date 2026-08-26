'use strict';

const fs   = require('node:fs');
const os   = require('node:os');
const path = require('node:path');

const { runReviewFiling } = require('../scripts/review-filing');
const { createTransaction, readTransaction } = require('../src/transactions/store');
const { recordDocumentSeen, _internal } = require('../src/transactions/filings');
const { buildFilingKey } = _internal;

const AGENT_ID = 'test-agent';
const CLOCK = new Date('2026-07-15T10:00:00.000Z');

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'review-filing-test-'));
}

// Builds a transaction with one filing record sitting at 'needs_review', via
// the real writers (store.createTransaction, filings.recordDocumentSeen)
// rather than hand-written JSON, so these tests break if the record shape
// changes underneath them.
function seedFiling(baseDir, messageId, attachmentId, filename) {
  const created = createTransaction(
    AGENT_ID,
    { type: 'buyer_purchase', state: 'conditional', address: '12 Main St' },
    { baseDir, now: CLOCK }
  );

  recordDocumentSeen(AGENT_ID, created.transactionId, messageId, attachmentId, {
    at: '2026-07-15T10:00:00.000Z',
    actor: 'agent',
    filename,
    mimeType: 'application/pdf',
    size: 1234,
    threadId: 'thread-1',
    baseDir,
    now: CLOCK,
  });

  return created.transactionId;
}

let baseDir;

beforeEach(() => { baseDir = makeTmpDir(); });
afterEach(() => { fs.rmSync(baseDir, { recursive: true, force: true }); });

describe('runReviewFiling', () => {
  test("confirm moves review from 'needs_review' to 'confirmed'", () => {
    const transactionId = seedFiling(baseDir, 'msg-1', 'att-1', 'contract.pdf');
    const key = buildFilingKey('msg-1', 'att-1');

    runReviewFiling(AGENT_ID, transactionId, 'msg-1', 'att-1', { actor: 'agent', baseDir, at: '2026-07-15T11:00:00.000Z' });

    const onDisk = readTransaction(AGENT_ID, transactionId, { baseDir });
    expect(onDisk.filings[key].review).toBe('confirmed');
  });

  test("reject moves review from 'needs_review' to 'rejected'", () => {
    const transactionId = seedFiling(baseDir, 'msg-1', 'att-1', 'contract.pdf');
    const key = buildFilingKey('msg-1', 'att-1');

    runReviewFiling(AGENT_ID, transactionId, 'msg-1', 'att-1', { reject: true, actor: 'agent', baseDir, at: '2026-07-15T11:00:00.000Z' });

    const onDisk = readTransaction(AGENT_ID, transactionId, { baseDir });
    expect(onDisk.filings[key].review).toBe('rejected');
  });

  test("confirm appends a 'document_confirmed' event", () => {
    const transactionId = seedFiling(baseDir, 'msg-1', 'att-1', 'contract.pdf');
    const key = buildFilingKey('msg-1', 'att-1');

    runReviewFiling(AGENT_ID, transactionId, 'msg-1', 'att-1', { actor: 'agent', baseDir, at: '2026-07-15T11:00:00.000Z' });

    const onDisk = readTransaction(AGENT_ID, transactionId, { baseDir });
    const event = onDisk.events[onDisk.events.length - 1];
    expect(event.kind).toBe('document_confirmed');
    expect(event.payload).toEqual({ key, filename: 'contract.pdf' });
  });

  test("reject appends a 'document_rejected' event", () => {
    const transactionId = seedFiling(baseDir, 'msg-1', 'att-1', 'contract.pdf');
    const key = buildFilingKey('msg-1', 'att-1');

    runReviewFiling(AGENT_ID, transactionId, 'msg-1', 'att-1', { reject: true, actor: 'agent', baseDir, at: '2026-07-15T11:00:00.000Z' });

    const onDisk = readTransaction(AGENT_ID, transactionId, { baseDir });
    const event = onDisk.events[onDisk.events.length - 1];
    expect(event.kind).toBe('document_rejected');
    expect(event.payload).toEqual({ key, filename: 'contract.pdf' });
  });

  test('confirming an already-confirmed record throws, naming the current review value', () => {
    const transactionId = seedFiling(baseDir, 'msg-1', 'att-1', 'contract.pdf');
    runReviewFiling(AGENT_ID, transactionId, 'msg-1', 'att-1', { actor: 'agent', baseDir, at: '2026-07-15T11:00:00.000Z' });

    expect(() =>
      runReviewFiling(AGENT_ID, transactionId, 'msg-1', 'att-1', { actor: 'agent', baseDir, at: '2026-07-15T12:00:00.000Z' })
    ).toThrow(/review is 'confirmed'/);
  });

  test('confirming an already-rejected record throws', () => {
    const transactionId = seedFiling(baseDir, 'msg-1', 'att-1', 'contract.pdf');
    runReviewFiling(AGENT_ID, transactionId, 'msg-1', 'att-1', { reject: true, actor: 'agent', baseDir, at: '2026-07-15T11:00:00.000Z' });

    expect(() =>
      runReviewFiling(AGENT_ID, transactionId, 'msg-1', 'att-1', { actor: 'agent', baseDir, at: '2026-07-15T12:00:00.000Z' })
    ).toThrow(/review is 'rejected'/);
  });

  test('rejecting an already-confirmed record throws', () => {
    const transactionId = seedFiling(baseDir, 'msg-1', 'att-1', 'contract.pdf');
    runReviewFiling(AGENT_ID, transactionId, 'msg-1', 'att-1', { actor: 'agent', baseDir, at: '2026-07-15T11:00:00.000Z' });

    expect(() =>
      runReviewFiling(AGENT_ID, transactionId, 'msg-1', 'att-1', { reject: true, actor: 'agent', baseDir, at: '2026-07-15T12:00:00.000Z' })
    ).toThrow(/review is 'confirmed'/);
  });

  test('a messageId/attachmentId pair with no filing record throws, mentioning no filing record', () => {
    const transactionId = seedFiling(baseDir, 'msg-1', 'att-1', 'contract.pdf');

    expect(() =>
      runReviewFiling(AGENT_ID, transactionId, 'msg-does-not-exist', 'att-does-not-exist', { actor: 'agent', baseDir, at: '2026-07-15T11:00:00.000Z' })
    ).toThrow(/no filing record/);
  });

  test('a transaction that does not exist throws, mentioning no transaction', () => {
    expect(() =>
      runReviewFiling(AGENT_ID, 'txn-20260715-deadbeef', 'msg-1', 'att-1', { actor: 'agent', baseDir, at: '2026-07-15T11:00:00.000Z' })
    ).toThrow(/no transaction/);
  });

  test('confirm leaves status untouched', () => {
    const transactionId = seedFiling(baseDir, 'msg-1', 'att-1', 'contract.pdf');
    const key = buildFilingKey('msg-1', 'att-1');

    runReviewFiling(AGENT_ID, transactionId, 'msg-1', 'att-1', { actor: 'agent', baseDir, at: '2026-07-15T11:00:00.000Z' });

    const onDisk = readTransaction(AGENT_ID, transactionId, { baseDir });
    expect(onDisk.filings[key].status).toBe('seen');
  });

  test('confirming one of two filing records leaves the other at needs_review', () => {
    const created = createTransaction(
      AGENT_ID,
      { type: 'buyer_purchase', state: 'conditional', address: '12 Main St' },
      { baseDir, now: CLOCK }
    );

    recordDocumentSeen(AGENT_ID, created.transactionId, 'msg-1', 'att-1', {
      at: '2026-07-15T10:00:00.000Z',
      actor: 'agent',
      filename: 'contract.pdf',
      mimeType: 'application/pdf',
      size: 1234,
      threadId: 'thread-1',
      baseDir,
      now: CLOCK,
    });
    recordDocumentSeen(AGENT_ID, created.transactionId, 'msg-2', 'att-2', {
      at: '2026-07-15T10:05:00.000Z',
      actor: 'agent',
      filename: 'waiver.pdf',
      mimeType: 'application/pdf',
      size: 5678,
      threadId: 'thread-1',
      baseDir,
      now: CLOCK,
    });

    runReviewFiling(AGENT_ID, created.transactionId, 'msg-1', 'att-1', { actor: 'agent', baseDir, at: '2026-07-15T11:00:00.000Z' });

    const onDisk = readTransaction(AGENT_ID, created.transactionId, { baseDir });
    const key1 = buildFilingKey('msg-1', 'att-1');
    const key2 = buildFilingKey('msg-2', 'att-2');
    expect(onDisk.filings[key1].review).toBe('confirmed');
    expect(onDisk.filings[key2].review).toBe('needs_review');
  });
});
