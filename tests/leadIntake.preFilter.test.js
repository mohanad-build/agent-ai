'use strict';

const leadIntake = require('../src/leadIntake');
const { isNoiseSender } = leadIntake;
const { applyPreFilter } = leadIntake._internal;

describe('isNoiseSender', () => {
  test('calendar domain sender is blocked', () => {
    const result = isNoiseSender({ from: 'Calendly <invite@calendly.com>', subject: 'New booking', body: 'details' });
    expect(result).toEqual({ pass: false, reason: 'calendar domain: calendly.com' });
  });

  test('google.com calendar-automation domain is blocked', () => {
    const result = isNoiseSender({ from: 'calendar-notification@google.com', subject: 'Event reminder', body: 'x' });
    expect(result).toEqual({ pass: false, reason: 'calendar domain: google.com' });
  });

  test('empty body and short subject is blocked', () => {
    const result = isNoiseSender({ from: 'a@example.com', subject: 'Hi', body: '' });
    expect(result).toEqual({ pass: false, reason: 'empty body and short subject' });
  });

  test('empty body but long-enough subject passes', () => {
    const result = isNoiseSender({ from: 'a@example.com', subject: 'Interested in the property', body: '' });
    expect(result).toEqual({ pass: true, reason: '' });
  });

  test('a clean lead passes', () => {
    const result = isNoiseSender({
      from: 'Jane Doe <jane@example.com>',
      subject: 'Question about 45 Maple',
      body: 'Is this still available?',
    });
    expect(result).toEqual({ pass: true, reason: '' });
  });
});

describe('applyPreFilter', () => {
  const labelMap = new Map([
    ['agent-ai/processing', 'L_PROC'],
    ['agent-ai/intaken', 'L_INTAKEN'],
    ['agent-ai/noise', 'L_NOISE'],
    ['agent-ai/first-touch-pending', 'L_FTP'],
    ['agent-ai/business', 'L_BIZ'],
  ]);

  test('reply (In-Reply-To present) is blocked before noise checks run', () => {
    const result = applyPreFilter(
      { from: 'a@example.com', subject: 'Re: hi', body: 'reply text', inReplyTo: '<abc@mail.gmail.com>' },
      labelMap
    );
    expect(result).toEqual({ pass: false, reason: 'reply (In-Reply-To present)' });
  });

  test('calendar domain sender is blocked (delegated to isNoiseSender)', () => {
    const result = applyPreFilter(
      { from: 'invite@calendly.com', subject: 'New booking', body: 'details' },
      labelMap
    );
    expect(result).toEqual({ pass: false, reason: 'calendar domain: calendly.com' });
  });

  test('empty body and short subject is blocked (delegated to isNoiseSender)', () => {
    const result = applyPreFilter({ from: 'a@example.com', subject: 'Hi', body: '' }, labelMap);
    expect(result).toEqual({ pass: false, reason: 'empty body and short subject' });
  });

  test('already has an intake label is blocked', () => {
    const result = applyPreFilter(
      {
        from: 'a@example.com',
        subject: 'Interested in the property',
        body: 'Is this still available?',
        labelIds: ['L_NOISE'],
      },
      labelMap
    );
    expect(result).toEqual({ pass: false, reason: 'already has intake label' });
  });

  test('already has the business label is blocked (loop guard)', () => {
    const result = applyPreFilter(
      {
        from: 'a@example.com',
        subject: 'Interested in the property',
        body: 'Is this still available?',
        labelIds: ['L_BIZ'],
      },
      labelMap
    );
    expect(result).toEqual({ pass: false, reason: 'already has intake label' });
  });

  test('a clean lead with no matching labels passes', () => {
    const result = applyPreFilter(
      {
        from: 'Jane Doe <jane@example.com>',
        subject: 'Question about 45 Maple',
        body: 'Is this still available?',
        labelIds: ['SOME_OTHER_LABEL'],
      },
      labelMap
    );
    expect(result).toEqual({ pass: true, reason: '' });
  });
});

describe('applyPreFilter with ctx (own address / known lead)', () => {
  const labelMap = new Map([
    ['agent-ai/processing', 'L_PROC'],
    ['agent-ai/intaken', 'L_INTAKEN'],
    ['agent-ai/noise', 'L_NOISE'],
    ['agent-ai/first-touch-pending', 'L_FTP'],
  ]);

  const cleanMsg = {
    from: 'Jane Doe <jane@example.com>',
    subject: 'Question about 45 Maple',
    body: 'Is this still available?',
  };

  test('sender equal to ctx.ownAddress is skipped', () => {
    const result = applyPreFilter(cleanMsg, labelMap, { ownAddress: 'jane@example.com' });
    expect(result).toEqual({ pass: false, reason: 'own address (self-sent)' });
  });

  test('sender already present in ctx.rows column A is skipped', () => {
    const rows = [{ rowIndex: 5, leadId: 'jane@example.com' }];
    const result = applyPreFilter(cleanMsg, labelMap, { rows });
    expect(result.pass).toBe(false);
    expect(result.reason).toMatch(/known lead/);
  });

  test('sender not in column A and not the own address still passes (guard the guard)', () => {
    const rows = [{ rowIndex: 5, leadId: 'someone-else@example.com' }];
    const result = applyPreFilter(cleanMsg, labelMap, { ownAddress: 'agent@example.com', rows });
    expect(result).toEqual({ pass: true, reason: '' });
  });

  test('ctx omitted entirely: legacy two-arg call still works', () => {
    const result = applyPreFilter(cleanMsg, labelMap);
    expect(result).toEqual({ pass: true, reason: '' });
  });

  test('ctx omitted entirely: In-Reply-To rule still blocks', () => {
    const result = applyPreFilter(
      Object.assign({}, cleanMsg, { inReplyTo: '<abc@mail.gmail.com>' }),
      labelMap
    );
    expect(result).toEqual({ pass: false, reason: 'reply (In-Reply-To present)' });
  });

  test('ctx omitted entirely: calendar domain rule still blocks', () => {
    const result = applyPreFilter({ from: 'invite@calendly.com', subject: 'New booking', body: 'details' }, labelMap);
    expect(result).toEqual({ pass: false, reason: 'calendar domain: calendly.com' });
  });

  test('ctx omitted entirely: empty body/short subject rule still blocks', () => {
    const result = applyPreFilter({ from: 'a@example.com', subject: 'Hi', body: '' }, labelMap);
    expect(result).toEqual({ pass: false, reason: 'empty body and short subject' });
  });

  test('ctx omitted entirely: existing intake label rule still blocks', () => {
    const result = applyPreFilter(
      Object.assign({}, cleanMsg, { labelIds: ['L_NOISE'] }),
      labelMap
    );
    expect(result).toEqual({ pass: false, reason: 'already has intake label' });
  });

  test('ctx.ownAddress absent but ctx.rows present: known-lead rule still fires', () => {
    const rows = [{ rowIndex: 5, leadId: 'jane@example.com' }];
    const result = applyPreFilter(cleanMsg, labelMap, { rows });
    expect(result.pass).toBe(false);
    expect(result.reason).toMatch(/known lead/);
  });

  test('ctx.ownAddress absent but ctx.rows present: own-address rule does not throw or false-match', () => {
    const rows = [{ rowIndex: 5, leadId: 'someone-else@example.com' }];
    const result = applyPreFilter(cleanMsg, labelMap, { rows });
    expect(result).toEqual({ pass: true, reason: '' });
  });

  test('case-insensitivity: column A holding mixed-case email matches an upper-case sender header', () => {
    const rows = [{ rowIndex: 5, leadId: 'Jane@Example.com' }];
    const msg = {
      from: 'Jane Lead <JANE@EXAMPLE.COM>',
      subject: 'Question about 45 Maple',
      body: 'Is this still available?',
    };
    const result = applyPreFilter(msg, labelMap, { rows });
    expect(result.pass).toBe(false);
    expect(result.reason).toMatch(/known lead/);
  });

  test('own-address compare is case-insensitive against a mixed-case sender header', () => {
    const msg = { from: 'Agent Self <AGENT@EXAMPLE.COM>', subject: 'Test', body: 'test body here' };
    const result = applyPreFilter(msg, labelMap, { ownAddress: 'agent@example.com' });
    expect(result).toEqual({ pass: false, reason: 'own address (self-sent)' });
  });
});
