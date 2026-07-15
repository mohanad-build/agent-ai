'use strict';

const {
  parseImportBody,
  renderImportResult,
} = require('../src/routes/dashboard');

describe('parseImportBody', () => {
  it('reads csvText from a string value', () => {
    expect(parseImportBody({ csvText: 'a,b\n1,2' })).toEqual({ csvText: 'a,b\n1,2' });
  });

  it('returns an empty string when csvText is missing', () => {
    expect(parseImportBody({})).toEqual({ csvText: '' });
  });

  it('trims whitespace padding', () => {
    expect(parseImportBody({ csvText: '  a,b\n1,2  ' })).toEqual({ csvText: 'a,b\n1,2' });
  });

  it('coerces a non-string value to an empty string', () => {
    expect(parseImportBody({ csvText: 42 })).toEqual({ csvText: '' });
    expect(parseImportBody({ csvText: { a: 1 } })).toEqual({ csvText: '' });
    expect(parseImportBody({ csvText: null })).toEqual({ csvText: '' });
  });
});

describe('renderImportResult', () => {
  const normalized = {
    meta: {
      mapping: { email: 0, name: 1, phone: null, source: null },
    },
  };

  it('surfaces the inferred column mapping', () => {
    const result = { landed: 0, counts: { ok: 0, skippedNoEmail: 0, skippedUnparseable: 0, skippedDupeInFile: 0, skippedDupeInSheet: 0 }, rows: [] };
    const html = renderImportResult('agent-1', normalized, result);
    expect(html).toContain('<pre>');
    expect(html).toContain('&quot;email&quot;: 0');
    expect(html).toContain('&quot;name&quot;: 1');
  });

  it('surfaces every count including zeros', () => {
    const result = {
      landed: 2,
      counts: { ok: 2, skippedNoEmail: 0, skippedUnparseable: 0, skippedDupeInFile: 0, skippedDupeInSheet: 0 },
      rows: [
        { email: 'a@example.com', status: 'landed', statusReason: '' },
        { email: 'b@example.com', status: 'landed', statusReason: '' },
      ],
    };
    const html = renderImportResult('agent-1', normalized, result);
    expect(html).toContain('skippedNoEmail');
    expect(html).toContain('skippedUnparseable');
    expect(html).toContain('skippedDupeInFile');
    expect(html).toContain('skippedDupeInSheet');
    // every count value, including the zeros, must appear as a rendered number
    expect(html.match(/<td>0<\/td>/g).length).toBe(4);
    expect(html).toContain('<td>2</td>');
  });

  it('surfaces a skipped row with its status and statusReason', () => {
    const result = {
      landed: 0,
      counts: { ok: 0, skippedNoEmail: 1, skippedUnparseable: 0, skippedDupeInFile: 0, skippedDupeInSheet: 0 },
      rows: [
        { email: '', status: 'skip:no-email', statusReason: 'missing or invalid email' },
      ],
    };
    const html = renderImportResult('agent-1', normalized, result);
    expect(html).toContain('skip:no-email');
    expect(html).toContain('missing or invalid email');
  });

  it('renders "(none)" for a row with no email', () => {
    const result = {
      landed: 0,
      counts: { ok: 0, skippedNoEmail: 0, skippedUnparseable: 1, skippedDupeInFile: 0, skippedDupeInSheet: 0 },
      rows: [
        { email: '', status: 'skip:unparseable', statusReason: 'row has fewer columns than the inferred mapping requires' },
      ],
    };
    const html = renderImportResult('agent-1', normalized, result);
    expect(html).toContain('(none)');
  });

  it('states plainly that no rows require manual attention when all rows landed', () => {
    const result = {
      landed: 3,
      counts: { ok: 3, skippedNoEmail: 0, skippedUnparseable: 0, skippedDupeInFile: 0, skippedDupeInSheet: 0 },
      rows: [
        { email: 'a@example.com', status: 'landed', statusReason: '' },
        { email: 'b@example.com', status: 'landed', statusReason: '' },
        { email: 'c@example.com', status: 'landed', statusReason: '' },
      ],
    };
    const html = renderImportResult('agent-1', normalized, result);
    expect(html).toContain('No rows require manual attention.');
  });

  it('escapes < and & in interpolated values', () => {
    const result = {
      landed: 0,
      counts: { ok: 0, skippedNoEmail: 1, skippedUnparseable: 0, skippedDupeInFile: 0, skippedDupeInSheet: 0 },
      rows: [
        { email: '<script>&x', status: 'skip:no-email', statusReason: 'reason with < and &' },
      ],
    };
    const html = renderImportResult('agent-1', normalized, result);
    expect(html).not.toContain('<script>&x');
    expect(html).toContain('&lt;script&gt;&amp;x');
    expect(html).toContain('reason with &lt; and &amp;');
  });
});
