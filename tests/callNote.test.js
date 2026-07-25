'use strict';

const { stripCallNote } = require('../src/callNote');

describe('stripCallNote', () => {
  it('an untouched tap body with no note returns empty string', () => {
    expect(stripCallNote('Notes from the call: ')).toBe('');
  });

  it('a note after the label is extracted', () => {
    expect(stripCallNote('Notes from the call: wants a 2pm viewing')).toBe('wants a 2pm viewing');
  });

  it('a Gmail dash-dash signature is dropped, keeping only the note', () => {
    const body = 'Notes from the call: wants a 2pm viewing\n-- \nMo | Royal LePage';
    expect(stripCallNote(body)).toBe('wants a 2pm viewing');
  });

  it('a "Sent from my iPhone" mobile signature is dropped, keeping only the note', () => {
    const body = 'Notes from the call: wants a 2pm viewing\nSent from my iPhone';
    expect(stripCallNote(body)).toBe('wants a 2pm viewing');
  });

  it('an empty body returns empty string', () => {
    expect(stripCallNote('')).toBe('');
  });

  it('a label on its own line followed by the note and a "Sent via" signature', () => {
    const body = 'Notes from the call:\nasked about parking\nSent via Gmail';
    expect(stripCallNote(body)).toBe('asked about parking');
  });
});
