'use strict';

const { renderWelcomeEmail } = require('../src/welcomeEmail');

const SHEET_LINK = 'https://docs.google.com/spreadsheets/d/abc123/edit';

describe('renderWelcomeEmail', () => {
  test('subject equals the expected string', () => {
    const { subject } = renderWelcomeEmail({ firstName: 'Sarah', sheetLink: SHEET_LINK, mode: 'shadow' });
    expect(subject).toBe("You're all set with GetKlosed");
  });

  test('shadow mode: text and html contain shadow reassurance and not live wording', () => {
    const { text, html } = renderWelcomeEmail({ firstName: 'Sarah', sheetLink: SHEET_LINK, mode: 'shadow' });
    expect(text).toContain('sends nothing on its own');
    expect(html).toContain('sends nothing on its own');
    expect(text).not.toContain('will reply to leads automatically');
    expect(html).not.toContain('will reply to leads automatically');
  });

  test('live mode: text and html contain live wording and not the shadow claim', () => {
    const { text, html } = renderWelcomeEmail({ firstName: 'Sarah', sheetLink: SHEET_LINK, mode: 'live' });
    expect(text).toContain('will reply to leads automatically');
    expect(html).toContain('will reply to leads automatically');
    expect(text).not.toContain('sends nothing on its own');
    expect(html).not.toContain('sends nothing on its own');
  });

  test('sheet link appears in both text and html', () => {
    const { text, html } = renderWelcomeEmail({ firstName: 'Sarah', sheetLink: SHEET_LINK, mode: 'live' });
    expect(text).toContain(SHEET_LINK);
    expect(html).toContain(SHEET_LINK);
  });

  test('firstName is interpolated', () => {
    const { text, html } = renderWelcomeEmail({ firstName: 'Sarah', sheetLink: SHEET_LINK, mode: 'live' });
    expect(text).toContain('Hi Sarah,');
    expect(html).toContain('Hi Sarah,');
  });

  test('falls back to "there" when firstName is empty', () => {
    const { text, html } = renderWelcomeEmail({ firstName: '', sheetLink: SHEET_LINK, mode: 'live' });
    expect(text).toContain('Hi there,');
    expect(html).toContain('Hi there,');
  });

  test('falls back to "there" when firstName is missing', () => {
    const { text, html } = renderWelcomeEmail({ sheetLink: SHEET_LINK, mode: 'live' });
    expect(text).toContain('Hi there,');
    expect(html).toContain('Hi there,');
  });

  test('both text and html are non-empty strings', () => {
    const { text, html } = renderWelcomeEmail({ firstName: 'Sarah', sheetLink: SHEET_LINK, mode: 'live' });
    expect(typeof text).toBe('string');
    expect(text.length).toBeGreaterThan(0);
    expect(typeof html).toBe('string');
    expect(html.length).toBeGreaterThan(0);
  });

  test('no em-dash character appears in subject, text, or html', () => {
    const { subject, text, html } = renderWelcomeEmail({ firstName: 'Sarah', sheetLink: SHEET_LINK, mode: 'shadow' });
    expect(subject).not.toContain('—');
    expect(text).not.toContain('—');
    expect(html).not.toContain('—');

    const liveResult = renderWelcomeEmail({ firstName: 'Sarah', sheetLink: SHEET_LINK, mode: 'live' });
    expect(liveResult.text).not.toContain('—');
    expect(liveResult.html).not.toContain('—');
  });
});
