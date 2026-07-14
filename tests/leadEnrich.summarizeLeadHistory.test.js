'use strict';

const {
  summarizeLeadHistory,
  SUMMARIZE_THRESHOLD,
  STATUS_ALLOWLIST,
  _internal,
} = require('../src/leadEnrich');
const { buildSummaryPrompt } = _internal;

function msg({ id, threadId = id, from = 'lead@example.com', to = 'agent@example.com', subject = 'Subject', body = 'Body', internalDate }) {
  return { id, threadId, from, to, subject, body, internalDate };
}

function mockClaude(responses) {
  const queue = Array.isArray(responses) ? [...responses] : null;
  const fixed = queue ? null : responses;
  return {
    callRaw: jest.fn().mockImplementation(async () => {
      if (queue) return queue.shift();
      return fixed;
    }),
  };
}

function jsonResponse(obj) {
  return JSON.stringify(obj);
}

const DEFAULT_MODEL_RESPONSE = jsonResponse({
  summary: 'Lead asked about 45 Maple on 2026-01-01. Email history only, phone/SMS not visible.',
  status: 'warm',
  soi: false,
  soiReason: '',
});

describe('summarizeLeadHistory', () => {
  test('found:false -> no Haiku call at all, note carried into summary, status needs_review', async () => {
    const claude = mockClaude(DEFAULT_MODEL_RESPONSE);
    const scanResult = { found: false, note: 'no history found in Gmail', messages: [] };

    const result = await summarizeLeadHistory(scanResult, { claude });

    expect(claude.callRaw).not.toHaveBeenCalled();
    expect(result.summary).toBe('no history found in Gmail');
    expect(result.inferredStatus).toBe('needs_review');
    expect(result.lastContactDate).toBe('');
    expect(result.proposedSoi).toBe(false);
  });

  test('under threshold -> exactly ONE callRaw, tiered:false', async () => {
    const claude = mockClaude(DEFAULT_MODEL_RESPONSE);
    const messages = [
      msg({ id: 'a', threadId: 't1', internalDate: 1000 }),
      msg({ id: 'b', threadId: 't1', internalDate: 2000 }),
    ];
    const scanResult = { found: true, note: '', messages };

    const result = await summarizeLeadHistory(scanResult, { claude });

    expect(claude.callRaw).toHaveBeenCalledTimes(1);
    expect(result.tiered).toBe(false);
    expect(result.messageCount).toBe(2);
  });

  test('over threshold (25 messages across 3 threads) -> one call per thread plus one final call, tiered:true, threadCount correct', async () => {
    const threadDigestResponse = 'Thread digest text.';
    const responses = [threadDigestResponse, threadDigestResponse, threadDigestResponse, DEFAULT_MODEL_RESPONSE];
    const claude = mockClaude(responses);

    const messages = [];
    let dateCounter = 1000;
    for (let t = 0; t < 3; t++) {
      const perThread = t === 0 ? 9 : t === 1 ? 8 : 8; // 9 + 8 + 8 = 25
      for (let i = 0; i < perThread; i++) {
        messages.push(msg({ id: `t${t}-m${i}`, threadId: `thread-${t}`, internalDate: dateCounter }));
        dateCounter += 10;
      }
    }
    expect(messages.length).toBe(25);
    expect(messages.length).toBeGreaterThan(SUMMARIZE_THRESHOLD);

    const scanResult = { found: true, note: '', messages };

    const result = await summarizeLeadHistory(scanResult, { claude });

    expect(claude.callRaw).toHaveBeenCalledTimes(4); // 3 thread digests + 1 final
    expect(result.tiered).toBe(true);
    expect(result.threadCount).toBe(3);
    expect(result.messageCount).toBe(25);
  });

  test('lastContactDate = max internalDate, NOT taken from the model response', async () => {
    // internalDate epoch ms for 2026-03-05
    const maxInternalDate = new Date('2026-03-05T00:00:00.000Z').getTime();
    const messages = [
      msg({ id: 'a', threadId: 't1', internalDate: new Date('2026-01-01T00:00:00.000Z').getTime() }),
      msg({ id: 'b', threadId: 't1', internalDate: maxInternalDate }),
    ];
    const modelResponseWithWrongDate = jsonResponse({
      summary: 'Summary text quoting emails, email history only.',
      status: 'warm',
      soi: false,
      soiReason: '',
      lastContactDate: '1999-12-31', // model tries to sneak in a different date; must be ignored
    });
    const claude = mockClaude(modelResponseWithWrongDate);
    const scanResult = { found: true, note: '', messages };

    const result = await summarizeLeadHistory(scanResult, { claude });

    expect(result.lastContactDate).toBe('2026-03-05');
    expect(result.lastContactDate).not.toBe('1999-12-31');
  });

  test('invalid status from the model falls back to needs_review, no throw', async () => {
    const claude = mockClaude(jsonResponse({
      summary: 'Summary text.',
      status: 'totally_made_up_status',
      soi: false,
      soiReason: '',
    }));
    const messages = [msg({ id: 'a', threadId: 't1', internalDate: 1000 })];
    const scanResult = { found: true, note: '', messages };

    const result = await summarizeLeadHistory(scanResult, { claude });

    expect(result.inferredStatus).toBe('needs_review');
  });

  test('malformed JSON from the model throws (strictness preserved)', async () => {
    const claude = mockClaude('not json at all');
    const messages = [msg({ id: 'a', threadId: 't1', internalDate: 1000 })];
    const scanResult = { found: true, note: '', messages };

    await expect(summarizeLeadHistory(scanResult, { claude })).rejects.toThrow();
  });

  test('proposedSoi true is returned, but no Sheet/column-T write path exists in this function', async () => {
    const claude = mockClaude(jsonResponse({
      summary: 'Evidence of a closed deal on 2026-02-01: "we closed on the house."',
      status: 'cold',
      soi: true,
      soiReason: 'Lead explicitly said "we closed on the house" on 2026-02-01.',
    }));
    const messages = [msg({ id: 'a', threadId: 't1', internalDate: 1000 })];
    const scanResult = { found: true, note: '', messages };

    // Only opts.claude is supplied; no email/gmail-like write dependency is
    // injected or required for this call to succeed, which is structural
    // proof there is no Sheet write path inside summarizeLeadHistory.
    const result = await summarizeLeadHistory(scanResult, { claude });

    expect(result.proposedSoi).toBe(true);
    expect(result.soiReason).toContain('closed on the house');

    const source = summarizeLeadHistory.toString();
    expect(source).not.toMatch(/appendSheetRow|updateSheetRow|readSheetRows|require\(['"]\.\/gmail['"]\)/);
  });

  test('the built prompt contains the evidence-quoting instruction, the email-only limitation instruction, and the status allowlist', () => {
    const { system } = buildSummaryPrompt(['[2026-01-01] From: a@x.com\nHi'], STATUS_ALLOWLIST);

    expect(system).toContain('quote specific evidence');
    expect(system).toContain('email history only');
    expect(system).toContain('phone or SMS contact');
    for (const status of STATUS_ALLOWLIST) {
      expect(system).toContain(status);
    }
  });
});
