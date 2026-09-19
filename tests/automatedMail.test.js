'use strict';

const { detectAutomated } = require('../src/automatedMail');

function header(name, value) {
  return { name, value };
}

const NOT_AUTOMATED = { automated: false, reason: null };

describe('detectAutomated', () => {
  describe('rule 1: auto_submitted', () => {
    it('triggers on a realistic Auto-Submitted value', () => {
      expect(detectAutomated([header('Auto-Submitted', 'auto-generated')]))
        .toEqual({ automated: true, reason: 'auto_submitted' });
    });

    it("'no' is not automated", () => {
      expect(detectAutomated([header('Auto-Submitted', 'no')])).toEqual(NOT_AUTOMATED);
    });

    it("'No ' (case and trailing space) is not automated", () => {
      expect(detectAutomated([header('Auto-Submitted', 'No ')])).toEqual(NOT_AUTOMATED);
    });

    it("'auto-generated; foo=bar' (cut at first ;) is automated", () => {
      expect(detectAutomated([header('Auto-Submitted', 'auto-generated; foo=bar')]))
        .toEqual({ automated: true, reason: 'auto_submitted' });
    });
  });

  describe('rule 2: autoreply_header', () => {
    it('X-Autoreply with a non-empty value triggers', () => {
      expect(detectAutomated([header('X-Autoreply', 'yes')]))
        .toEqual({ automated: true, reason: 'autoreply_header' });
    });

    it('X-Autorespond with a non-empty value triggers', () => {
      expect(detectAutomated([header('X-Autorespond', 'yes')]))
        .toEqual({ automated: true, reason: 'autoreply_header' });
    });
  });

  describe('rule 3: precedence', () => {
    it("Precedence: bulk triggers", () => {
      expect(detectAutomated([header('Precedence', 'bulk')]))
        .toEqual({ automated: true, reason: 'precedence' });
    });

    it("Precedence: first-class is not automated", () => {
      expect(detectAutomated([header('Precedence', 'first-class')])).toEqual(NOT_AUTOMATED);
    });
  });

  describe('rule 4: list_headers', () => {
    it('List-Id with a non-empty value triggers', () => {
      expect(detectAutomated([header('List-Id', '<announce.example.com>')]))
        .toEqual({ automated: true, reason: 'list_headers' });
    });

    it('List-Unsubscribe with a non-empty value triggers', () => {
      expect(detectAutomated([header('List-Unsubscribe', '<mailto:unsub@example.com>')]))
        .toEqual({ automated: true, reason: 'list_headers' });
    });

    it('empty List-Id is not automated', () => {
      expect(detectAutomated([header('List-Id', '')])).toEqual(NOT_AUTOMATED);
    });

    it('empty List-Unsubscribe is not automated', () => {
      expect(detectAutomated([header('List-Unsubscribe', '')])).toEqual(NOT_AUTOMATED);
    });
  });

  describe('rule 5: null_return_path', () => {
    it("Return-Path: '<>' triggers", () => {
      expect(detectAutomated([header('Return-Path', '<>')]))
        .toEqual({ automated: true, reason: 'null_return_path' });
    });

    it("Return-Path: ' <> ' (whitespace trimmed) triggers", () => {
      expect(detectAutomated([header('Return-Path', ' <> ')]))
        .toEqual({ automated: true, reason: 'null_return_path' });
    });

    it("Return-Path: '<bounce-123@example.com>' is not automated", () => {
      expect(detectAutomated([header('Return-Path', '<bounce-123@example.com>')])).toEqual(NOT_AUTOMATED);
    });

    it("Return-Path containing '<>' as a substring without being exactly '<>' after trimming is not automated", () => {
      expect(detectAutomated([header('Return-Path', '<bounce-123@example.com><>')])).toEqual(NOT_AUTOMATED);
    });
  });

  describe('rule 6: system_sender', () => {
    it.each([
      ['MAILER-DAEMON@example.com', 'MAILER-DAEMON@example.com'],
      ['No-Reply <no-reply@example.com>', 'No-Reply <no-reply@example.com>'],
      ['noreply+alerts@example.com', 'noreply+alerts@example.com'],
      ['donotreply@example.com', 'donotreply@example.com'],
    ])('%s triggers', (_label, fromValue) => {
      expect(detectAutomated([header('From', fromValue)]))
        .toEqual({ automated: true, reason: 'system_sender' });
    });

    it.each([
      ['John <john@example.com>', 'John <john@example.com>'],
      ['noreplyjohn@example.com', 'noreplyjohn@example.com'],
      ['john.noreply@example.com', 'john.noreply@example.com'],
    ])('%s is not automated', (_label, fromValue) => {
      expect(detectAutomated([header('From', fromValue)])).toEqual(NOT_AUTOMATED);
    });
  });

  describe('exact header-name equality, decoys', () => {
    it('X-Original-List-Id does not trigger list_headers', () => {
      expect(detectAutomated([header('X-Original-List-Id', '<something>')])).toEqual(NOT_AUTOMATED);
    });

    it('X-Auto-Submitted-Original does not trigger auto_submitted', () => {
      expect(detectAutomated([header('X-Auto-Submitted-Original', 'auto-generated')])).toEqual(NOT_AUTOMATED);
    });

    it('matches a header name in a different case', () => {
      expect(detectAutomated([header('precedence', 'BULK')]))
        .toEqual({ automated: true, reason: 'precedence' });
    });
  });

  describe('order', () => {
    it('a message with both Precedence: bulk and a noreply From reports precedence (earlier rule wins)', () => {
      const result = detectAutomated([
        header('Precedence', 'bulk'),
        header('From', 'no-reply@example.com'),
      ]);
      expect(result).toEqual({ automated: true, reason: 'precedence' });
    });
  });

  describe('a realistic normal message', () => {
    it('non-empty Return-Path, Authentication-Results, no other automated signal: not automated', () => {
      const result = detectAutomated([
        header('From', 'Jane Smith <jane@gmail.com>'),
        header('To', 'assistant@getklosed.ca'),
        header('Subject', 'APPROVE reel-001'),
        header('Return-Path', '<jane@gmail.com>'),
        header('Authentication-Results', 'mx.google.com; dkim=pass; spf=pass; dmarc=pass header.from=gmail.com'),
      ]);
      expect(result).toEqual(NOT_AUTOMATED);
    });
  });

  describe('totality: never throws, always returns the safe shape', () => {
    const cases = [
      ['undefined', undefined],
      ['null', null],
      ['a string', 'not-an-array'],
      ['an object', {}],
      ['[null]', [null]],
      ['[{}]', [{}]],
      ["[{ name: 'Auto-Submitted' }]", [{ name: 'Auto-Submitted' }]],
      ["[{ name: 'Auto-Submitted', value: 42 }]", [{ name: 'Auto-Submitted', value: 42 }]],
      ["[{ name: 'From', value: {} }]", [{ name: 'From', value: {} }]],
    ];

    cases.forEach(([label, input]) => {
      it(`does not throw for ${label}`, () => {
        expect(() => detectAutomated(input)).not.toThrow();
        expect(detectAutomated(input)).toEqual(NOT_AUTOMATED);
      });
    });
  });
});
