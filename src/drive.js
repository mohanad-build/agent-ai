// src/drive.js
//
// Thin Google Drive client: create a folder, upload a file. Both calls are
// POST, so both go through withGoogleRetry (gaxios does not retry POST) --
// see src/googleRetry.js for why. Auth is shared with Gmail/Sheets via
// gmail.getOAuthClient so one token has one cache; a second OAuth2 client
// built here would silently survive handleAuthFailure's eviction.

const { Readable } = require('node:stream');
const { google } = require('googleapis');
const { getOAuthClient } = require('./gmail');
const { withGoogleRetry } = require('./googleRetry');

// -- Argument assertions ------------------------------------------------------------

function assertNonEmptyString(fnName, name, value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${fnName}: ${name} must be a non-empty string`);
  }
}

// -- createFolder -----------------------------------------------------------------

async function createFolder(agentConfig, name, opts = {}) {
  const { parentId } = opts;

  assertNonEmptyString('createFolder', 'name', name);
  if (parentId !== undefined) {
    assertNonEmptyString('createFolder', 'parentId', parentId);
  }

  const auth = getOAuthClient(agentConfig);
  const drive = google.drive({ version: 'v3', auth });

  const requestBody = {
    name,
    mimeType: 'application/vnd.google-apps.folder',
  };
  if (parentId !== undefined) {
    requestBody.parents = [parentId];
  }

  try {
    return await withGoogleRetry(agentConfig, async () => {
      const res = await drive.files.create({
        requestBody,
        fields: 'id, name, parents',
      });
      return { id: res.data.id, name: res.data.name, parents: res.data.parents };
    });
  } catch (err) {
    console.error(`[${agentConfig.agentId}] createFolder failed: ${err.message}`);
    throw err;
  }
}

// -- uploadFile -------------------------------------------------------------------

// media.body must be a stream, not a Buffer: googleapis calls .pipe() on it
// (node_modules/googleapis-common/build/src/apirequest.js:180), and a raw
// Buffer has no .pipe(), so it throws a TypeError before any HTTP request --
// no status, no response, nothing for withGoogleRetry to see. Readable.from
// wraps the buffer in something .pipe() actually works on.
async function uploadFile(agentConfig, opts = {}) {
  const { name, folderId, mimeType, buffer } = opts;

  assertNonEmptyString('uploadFile', 'name', name);
  assertNonEmptyString('uploadFile', 'folderId', folderId);
  assertNonEmptyString('uploadFile', 'mimeType', mimeType);
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error('uploadFile: buffer must be a non-empty Buffer');
  }

  const auth = getOAuthClient(agentConfig);
  const drive = google.drive({ version: 'v3', auth });

  try {
    return await withGoogleRetry(agentConfig, async () => {
      const res = await drive.files.create({
        requestBody: { name, parents: [folderId] },
        media: { mimeType, body: Readable.from(buffer) },
        fields: 'id, name, webViewLink, parents',
      });
      return {
        id: res.data.id,
        name: res.data.name,
        webViewLink: res.data.webViewLink,
        parents: res.data.parents,
      };
    });
  } catch (err) {
    console.error(`[${agentConfig.agentId}] uploadFile failed: ${buffer.length} bytes, error: ${err.message}`);
    throw err;
  }
}

module.exports = {
  createFolder,
  uploadFile,
};
