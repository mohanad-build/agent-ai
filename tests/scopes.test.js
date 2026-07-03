'use strict';

const { OAUTH_SCOPES } = require('../src/scopes');

test('OAUTH_SCOPES is exactly gmail.modify and drive.file', () => {
  expect(OAUTH_SCOPES).toEqual([
    'https://www.googleapis.com/auth/gmail.modify',
    'https://www.googleapis.com/auth/drive.file',
  ]);
  expect(OAUTH_SCOPES).toHaveLength(2);
});
