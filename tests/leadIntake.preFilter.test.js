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
