'use strict';

jest.mock('../src/gmail');

const gmailMod = require('../src/gmail');
const digestMod = require('../src/digest');
const { pollSentFolderForDraftResolution } = digestMod;
const { parseShadowDraftBody, computeJaccardOverlap, secondsFromIso } = digestMod._internal;

// ── Fixtures ──────────────────────────────────────────────────────────────────

const START_ISO = '2026-05-10T00:00:00Z';
const END_ISO   = '2026-05-17T00:00:00Z';

const BASE_AGENT = {
  agentId: 'agent-test',
  gmailAddress: 'agent@example.com',
  agentSignature: 'Best,\nAgent',
};

function makeShadowDraftBody(leadEmail, draftBody) {
  return [
    'This is a draft. The lead did NOT receive this message.',
    `If you want to send your own version, reply at ${leadEmail}.`,
    '---',
    draftBody,
  ].join('\n');
}

beforeEach(() => {
  jest.clearAllMocks();
});

afterEach(() => {
  jest.useRealTimers();
});

// ── parseShadowDraftBody ──────────────────────────────────────────────────────

describe('parseShadowDraftBody', () => {
  test('well-formed body returns leadEmail and draftBody', () => {
    const raw = makeShadowDraftBody('lead@example.com', 'Hello there, this is the draft.');
    const result = parseShadowDraftBody(raw);
    expect(result).not.toBeNull();
    expect(result.leadEmail).toBe('lead@example.com');
    expect(result.draftBody).toBe('Hello there, this is the draft.');
  });

  test('missing "reply at" line returns null', () => {
    const raw = 'This is a draft. No reply line here.\n---\nBody';
    expect(parseShadowDraftBody(raw)).toBeNull();
  });

  test('missing --- separator returns null', () => {
    const raw = 'If you want to send your own version, reply at lead@example.com.\nBody without separator';
    expect(parseShadowDraftBody(raw)).toBeNull();
  });

  test('leadEmail with trailing period is stripped', () => {
    const raw = 'If you want to send your own version, reply at lead@example.com.\n---\nBody';
    const result = parseShadowDraftBody(raw);
    expect(result.leadEmail).toBe('lead@example.com');
  });

  test('draftBody with surrounding whitespace is trimmed', () => {
    const raw = 'If you want to send your own version, reply at lead@example.com.\n---\n   trimmed body   ';
    const result = parseShadowDraftBody(raw);
    expect(result.draftBody).toBe('trimmed body');
  });
});

// ── computeJaccardOverlap ─────────────────────────────────────────────────────

describe('computeJaccardOverlap', () => {
  const agent = { agentId: 'test' };

  test('identical bodies return 1.0', () => {
    const body = 'the quick brown fox jumps over the lazy dog';
    expect(computeJaccardOverlap(body, body, agent)).toBe(1.0);
  });

  test('completely disjoint bodies return 0.0', () => {
    expect(computeJaccardOverlap('alpha beta gamma', 'delta epsilon zeta', agent)).toBe(0.0);
  });

  test('partial overlap returns value between 0 and 1', () => {
    const score = computeJaccardOverlap('alpha beta gamma delta', 'alpha beta epsilon zeta', agent);
    // intersection={alpha,beta}=2, union={alpha,beta,gamma,delta,epsilon,zeta}=6 => 2/6 ~0.33
    expect(score).toBeCloseTo(2 / 6, 5);
  });

  test('both empty after normalization return 0.0', () => {
    expect(computeJaccardOverlap('', '', agent)).toBe(0.0);
  });

  test('one empty after normalization returns 0.0', () => {
    expect(computeJaccardOverlap('some content here', '', agent)).toBe(0.0);
  });

  test('greeting-only difference yields high overlap (greeting strip works)', () => {
    const base = 'we have great listings available for you right now';
    const withGreeting = `Hi Sarah,\n${base}`;
    const score = computeJaccardOverlap(base, withGreeting, agent);
    expect(score).toBe(1.0);
  });

  test('sign-off-only difference yields high overlap (sign-off strip works)', () => {
    const body = 'we have great listings available for you';
    const agentWithSig = { agentId: 'test', agentSignature: 'Best,' };
    const withSig = `${body}\nBest,\nAgent Name`;
    const score = computeJaccardOverlap(body, withSig, agentWithSig);
    expect(score).toBe(1.0);
  });

  test('quoted-text in sent body is stripped and does not inflate score', () => {
    const draft = 'come see the unit on thursday afternoon';
    const sentWithQuote = `come see the unit on thursday afternoon\n> On Mon, May 13 wrote:\n> Original lead message here with many extra unique words`;
    const score = computeJaccardOverlap(draft, sentWithQuote, agent);
    expect(score).toBe(1.0);
  });
});

// ── pollSentFolderForDraftResolution ──────────────────────────────────────────

describe('pollSentFolderForDraftResolution', () => {
  const DRAFT_MS = 1747440000000;

  function makeDraftMsg(id, leadEmail, draftBody) {
    return {
      id,
      threadId: `thread-${id}`,
      from: 'agent@example.com',
      to: 'agent@example.com',
      subject: '[SHADOW DRAFT]',
      body: makeShadowDraftBody(leadEmail, draftBody),
      internalDate: DRAFT_MS,
    };
  }

  function makeSentMsg(id, body, offsetMs = 3600000) {
    return {
      id,
      threadId: `thread-sent-${id}`,
      from: 'agent@example.com',
      to: 'lead@example.com',
      subject: 'Re: your inquiry',
      body,
      internalDate: DRAFT_MS + offsetMs,
    };
  }

  test('3 drafts: sentAsIs + editedThenSent + rejected = {1,1,1}', async () => {
    const draft1Body = 'the unit is available on thursday at 2pm please confirm';
    const draft2Body = 'we have two great options for your budget range';
    const draft3Body = 'this is a third draft that nobody will respond to';

    // searchMessages: first call = shadow drafts, then one per sent lookup
    gmailMod.searchMessages
      .mockResolvedValueOnce(['draft1', 'draft2', 'draft3']) // shadow drafts
      .mockResolvedValueOnce(['sent1'])                       // sent for draft1
      .mockResolvedValueOnce(['sent2'])                       // sent for draft2
      .mockResolvedValueOnce([]);                             // no sent for draft3

    gmailMod.fetchMessage
      .mockResolvedValueOnce(makeDraftMsg('draft1', 'lead1@example.com', draft1Body))
      .mockResolvedValueOnce(makeSentMsg('sent1', draft1Body))              // identical -> sentAsIs
      .mockResolvedValueOnce(makeDraftMsg('draft2', 'lead2@example.com', draft2Body))
      .mockResolvedValueOnce(makeSentMsg('sent2', 'we have two great options plus some changes made here'))  // edited -> editedThenSent
      .mockResolvedValueOnce(makeDraftMsg('draft3', 'lead3@example.com', draft3Body));
    // no fetchMessage for draft3 since sentIds is empty

    const result = await pollSentFolderForDraftResolution(BASE_AGENT, START_ISO, END_ISO);
    expect(result).toEqual({ sentAsIs: 1, editedThenSent: 1, rejected: 1 });
  });

  test('empty window (no shadow drafts) returns zero counts, not null', async () => {
    gmailMod.searchMessages.mockResolvedValue([]);

    const result = await pollSentFolderForDraftResolution(BASE_AGENT, START_ISO, END_ISO);
    expect(result).toEqual({ sentAsIs: 0, editedThenSent: 0, rejected: 0 });
  });

  test('timeout: searchMessages advances clock past 30s, function returns null', async () => {
    jest.useFakeTimers();

    gmailMod.searchMessages.mockImplementation(async () => {
      jest.advanceTimersByTime(35000);
      return ['draft1'];
    });

    const result = await pollSentFolderForDraftResolution(BASE_AGENT, START_ISO, END_ISO);
    expect(result).toBeNull();
  });

  test('malformed shadow draft body is skipped silently', async () => {
    gmailMod.searchMessages
      .mockResolvedValueOnce(['bad1'])
      .mockResolvedValueOnce(['good1'])
      .mockResolvedValueOnce(['sent1']);

    const goodBody = 'available thursday at 2pm';
    gmailMod.fetchMessage
      .mockResolvedValueOnce({ id: 'bad1', body: 'not a shadow draft at all', internalDate: DRAFT_MS })
      .mockResolvedValueOnce(makeDraftMsg('good1', 'lead@example.com', goodBody))
      .mockResolvedValueOnce(makeSentMsg('sent1', goodBody));

    // Reset to only return one good draft
    gmailMod.searchMessages.mockReset();
    gmailMod.fetchMessage.mockReset();

    gmailMod.searchMessages
      .mockResolvedValueOnce(['bad1', 'good1'])
      .mockResolvedValueOnce(['sent1']);

    gmailMod.fetchMessage
      .mockResolvedValueOnce({ id: 'bad1', body: 'not a shadow draft at all', internalDate: DRAFT_MS })
      .mockResolvedValueOnce(makeDraftMsg('good1', 'lead@example.com', goodBody))
      .mockResolvedValueOnce(makeSentMsg('sent1', goodBody));

    const result = await pollSentFolderForDraftResolution(BASE_AGENT, START_ISO, END_ISO);
    expect(result).toEqual({ sentAsIs: 1, editedThenSent: 0, rejected: 0 });
  });
});
