'use strict';

const { Readable } = require('node:stream');

// Mock googleapis so drive.js never touches real Drive.
jest.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: jest.fn().mockImplementation(() => ({
        setCredentials: jest.fn(),
      })),
    },
    drive: jest.fn(),
  },
}));

// Mock gmail.js so getOAuthClient does not run for real.
jest.mock('../src/gmail');

const { google } = require('googleapis');
const gmailMod = require('../src/gmail');

const mockCreate = jest.fn();
google.drive.mockReturnValue({
  files: { create: mockCreate },
});

const { createFolder, uploadFile } = require('../src/drive');

const agentConfig = { agentId: 'agent-a', googleRefreshToken: 'token-a' };

function makeHttpError(status) {
  return { message: `http ${status}`, response: { status, headers: {} } };
}

beforeEach(() => {
  mockCreate.mockReset();
  gmailMod.getOAuthClient.mockReset().mockReturnValue({ fake: 'auth' });
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.useRealTimers();
  console.error.mockRestore();
});

// -- createFolder -------------------------------------------------------------------

describe('createFolder', () => {
  test('root-level folder: requestBody has no parents key at all', async () => {
    mockCreate.mockResolvedValue({ data: { id: 'F1', name: 'root-folder', parents: undefined } });

    await createFolder(agentConfig, 'root-folder');

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const { requestBody, fields } = mockCreate.mock.calls[0][0];
    expect(requestBody).toEqual({
      name: 'root-folder',
      mimeType: 'application/vnd.google-apps.folder',
    });
    expect('parents' in requestBody).toBe(false);
    expect(fields).toBe('id, name, parents');
  });

  test('nested folder: requestBody.parents is [parentId]', async () => {
    mockCreate.mockResolvedValue({ data: { id: 'F2', name: 'child', parents: ['P1'] } });

    await createFolder(agentConfig, 'child', { parentId: 'P1' });

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const { requestBody } = mockCreate.mock.calls[0][0];
    expect(requestBody).toEqual({
      name: 'child',
      mimeType: 'application/vnd.google-apps.folder',
      parents: ['P1'],
    });
  });

  test('return shape: id, name, parents only', async () => {
    mockCreate.mockResolvedValue({
      data: { id: 'F3', name: 'shaped', parents: ['P1'], webViewLink: 'ignored' },
    });

    const result = await createFolder(agentConfig, 'shaped', { parentId: 'P1' });

    expect(result).toEqual({ id: 'F3', name: 'shaped', parents: ['P1'] });
  });

  test('empty string name throws before any API call', async () => {
    await expect(createFolder(agentConfig, '')).rejects.toThrow(
      'createFolder: name must be a non-empty string'
    );
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test('empty string parentId throws before any API call', async () => {
    await expect(createFolder(agentConfig, 'name', { parentId: '' })).rejects.toThrow(
      'createFolder: parentId must be a non-empty string'
    );
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

// -- uploadFile ---------------------------------------------------------------------

describe('uploadFile', () => {
  const validOpts = () => ({
    name: 'doc.pdf',
    folderId: 'F1',
    mimeType: 'application/pdf',
    buffer: Buffer.from('hello world'),
  });

  test('media.body is a Readable stream, not the raw Buffer', async () => {
    mockCreate.mockResolvedValue({ data: { id: 'X1', name: 'doc.pdf' } });

    await uploadFile(agentConfig, validOpts());

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const { media } = mockCreate.mock.calls[0][0];
    expect(media.body).toBeInstanceOf(Readable);
    expect(Buffer.isBuffer(media.body)).toBe(false);
    expect(media.mimeType).toBe('application/pdf');
  });

  test('requestBody carries name and parents: [folderId]', async () => {
    mockCreate.mockResolvedValue({ data: { id: 'X1', name: 'doc.pdf' } });

    await uploadFile(agentConfig, validOpts());

    const { requestBody, fields } = mockCreate.mock.calls[0][0];
    expect(requestBody).toEqual({ name: 'doc.pdf', parents: ['F1'] });
    expect(fields).toBe('id, name, webViewLink, parents');
  });

  test('return shape: id, name, webViewLink, parents only', async () => {
    mockCreate.mockResolvedValue({
      data: { id: 'X2', name: 'doc.pdf', webViewLink: 'https://x', parents: ['F1'], size: '999' },
    });

    const result = await uploadFile(agentConfig, validOpts());

    expect(result).toEqual({ id: 'X2', name: 'doc.pdf', webViewLink: 'https://x', parents: ['F1'] });
  });

  test('missing name throws before any API call', async () => {
    const opts = validOpts();
    delete opts.name;
    await expect(uploadFile(agentConfig, opts)).rejects.toThrow(
      'uploadFile: name must be a non-empty string'
    );
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test('missing folderId throws before any API call', async () => {
    const opts = validOpts();
    delete opts.folderId;
    await expect(uploadFile(agentConfig, opts)).rejects.toThrow(
      'uploadFile: folderId must be a non-empty string'
    );
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test('missing mimeType throws before any API call', async () => {
    const opts = validOpts();
    delete opts.mimeType;
    await expect(uploadFile(agentConfig, opts)).rejects.toThrow(
      'uploadFile: mimeType must be a non-empty string'
    );
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test('non-Buffer body is rejected before any API call', async () => {
    const opts = validOpts();
    opts.buffer = 'not a buffer';
    await expect(uploadFile(agentConfig, opts)).rejects.toThrow(
      'uploadFile: buffer must be a non-empty Buffer'
    );
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test('empty Buffer is rejected before any API call', async () => {
    const opts = validOpts();
    opts.buffer = Buffer.alloc(0);
    await expect(uploadFile(agentConfig, opts)).rejects.toThrow(
      'uploadFile: buffer must be a non-empty Buffer'
    );
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

// -- withGoogleRetry wiring -----------------------------------------------------------

describe('withGoogleRetry wiring', () => {
  test('createFolder: a 500 is retried and the second attempt succeeds', async () => {
    jest.useFakeTimers();
    mockCreate
      .mockRejectedValueOnce(makeHttpError(500))
      .mockResolvedValueOnce({ data: { id: 'F1', name: 'root-folder' } });

    const resultPromise = createFolder(agentConfig, 'root-folder');
    await jest.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toEqual({ id: 'F1', name: 'root-folder', parents: undefined });
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  test('uploadFile: a 500 is retried and the second attempt succeeds', async () => {
    jest.useFakeTimers();
    mockCreate
      .mockRejectedValueOnce(makeHttpError(500))
      .mockResolvedValueOnce({ data: { id: 'X1', name: 'doc.pdf' } });

    const resultPromise = uploadFile(agentConfig, validOptsForRetry());
    await jest.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.id).toBe('X1');
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });
});

function validOptsForRetry() {
  return {
    name: 'doc.pdf',
    folderId: 'F1',
    mimeType: 'application/pdf',
    buffer: Buffer.from('hello world'),
  };
}
