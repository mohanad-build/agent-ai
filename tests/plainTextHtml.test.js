'use strict';

const { escapeHtml, plainTextToHtml } = require('../src/plainTextHtml');

describe('escapeHtml', () => {
  test('escapes & to &amp;', () => {
    expect(escapeHtml('&')).toBe('&amp;');
  });

  test('escapes < to &lt;', () => {
    expect(escapeHtml('<')).toBe('&lt;');
  });

  test('escapes > to &gt;', () => {
    expect(escapeHtml('>')).toBe('&gt;');
  });

  test('escapes " to &quot;', () => {
    expect(escapeHtml('"')).toBe('&quot;');
  });

  test("escapes ' to &#39;", () => {
    expect(escapeHtml("'")).toBe('&#39;');
  });

  test('escapes & first, so "&lt;" becomes "&amp;lt;" not a double-escape', () => {
    expect(escapeHtml('&lt;')).toBe('&amp;lt;');
  });

  test('null gives empty string', () => {
    expect(escapeHtml(null)).toBe('');
  });

  test('undefined gives empty string', () => {
    expect(escapeHtml(undefined)).toBe('');
  });

  test('a number gives its string form', () => {
    expect(escapeHtml(42)).toBe('42');
  });
});

describe('plainTextToHtml', () => {
  test('\\n becomes <br>', () => {
    expect(plainTextToHtml('a\nb')).toBe('a<br>b');
  });

  test('\\r\\n becomes <br>', () => {
    expect(plainTextToHtml('a\r\nb')).toBe('a<br>b');
  });

  test('\\r becomes <br>', () => {
    expect(plainTextToHtml('a\rb')).toBe('a<br>b');
  });

  test('a blank line becomes two <br> in a row', () => {
    expect(plainTextToHtml('a\n\nb')).toBe('a<br><br>b');
  });

  test('escaping happens before conversion: a literal "<br>" never becomes a real line break', () => {
    expect(plainTextToHtml('<br>')).toBe('&lt;br&gt;');
  });

  test('markdown-looking input stays literal, no tags added other than <br>', () => {
    const inputs = ['- item', '*x*', '---', '# h', '[a](http://x)'];
    for (const input of inputs) {
      const out = plainTextToHtml(input);
      expect(out).toBe(escapeHtml(input));
      expect(out.replace(/<br>/g, '')).not.toContain('<');
    }
  });

  test('null gives empty string', () => {
    expect(plainTextToHtml(null)).toBe('');
  });

  test('undefined gives empty string', () => {
    expect(plainTextToHtml(undefined)).toBe('');
  });

  test('a number gives its string form', () => {
    expect(plainTextToHtml(42)).toBe('42');
  });

  test('a realistic reply body', () => {
    const input = "Smith & Jones <lead>\n\nReply to Mo's note";
    const expected = "Smith &amp; Jones &lt;lead&gt;<br><br>Reply to Mo&#39;s note";
    expect(plainTextToHtml(input)).toBe(expected);
  });
});
