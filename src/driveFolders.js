// src/driveFolders.js
//
// TC_SPEC section 14 tier 2 item 5 (third of three): the Drive folder ids
// the drain pass will need somewhere to file a document. Async, and
// deliberately NOT under src/transactions/ -- every module in that
// directory is synchronous, and that property is load-bearing for TC_SPEC
// 7.7's concurrency safety (a store read-patch-write cycle with an await
// inside it is exactly the hazard 7.7 warns about). This module is the
// place that awaits; it hands a plain, already-resolved value to the
// synchronous store/agentConfig writers, and never opens one of their
// write cycles until every await it needs has already settled.
//
// Two exports, both idempotent: an id already present on the record means
// no Drive call at all, not even a existence check.

'use strict';

const drive = require('./drive');
const { patchAgent } = require('./agentConfig');
const store = require('./transactions/store');

// -- Argument assertions ------------------------------------------------------------

function assertNonEmptyString(fnName, name, value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${fnName}: ${name} must be a non-empty string`);
  }
}

// -- ensureAgentParentFolder --------------------------------------------------------

// TC_SPEC 10.1/10.2: drive.file scope can only see folders the app itself
// created, so each agent needs one app-owned root-level parent, created
// once and reused forever. Lazy, not part of onboarding: the first caller
// that needs a parent folder (deal-open, or the drain pass on an agent
// onboarded before this existed) creates it and persists the id via
// patchAgent, so every agent -- new or already onboarded -- self-heals on
// first use. No backfill script exists or is needed.
async function ensureAgentParentFolder(agentConfig) {
  assertNonEmptyString('ensureAgentParentFolder', 'agentId', agentConfig?.agentId);

  if (agentConfig.driveParentFolderId) {
    return agentConfig.driveParentFolderId;
  }

  const folder = await drive.createFolder(agentConfig, agentConfig.agentId);
  patchAgent(agentConfig.agentId, { driveParentFolderId: folder.id });
  return folder.id;
}

// -- buildTransactionFolderName ------------------------------------------------------

// "<address> - <YYYY-MM-DD of transaction.createdAt>", deliberately NOT the
// confirmed closing date, which amends TC_SPEC 10.2's literal wording. Two
// paths can create this folder -- deal-open, and lazily later if deal-open's
// own attempt failed -- and a closing date that gets confirmed in the
// window between them would give the same deal two different folder names
// depending on which path won the race. createdAt is fixed the instant the
// transaction exists and can never disagree with itself between two
// callers. It also disambiguates the case 10.2 actually cares about -- the
// same property sold twice, i.e. two different transaction records with the
// same address -- since two different transactions cannot share a
// createdAt down to the second. 10.2 itself says a folder name is a label
// for a human browsing Drive, not a queryable record, so createdAt standing
// in for the closing date here costs nothing a record depends on.
//
// Sanitising is minimal and applies ONLY to the string built for Drive:
// trim and collapse internal whitespace runs. The stored transaction.address
// is never touched here or anywhere downstream -- 6762e9c stores it
// verbatim and never normalises it, and that must stay true regardless of
// what a folder name needs to look like.
function buildTransactionFolderName(transaction) {
  const cleanAddress = transaction.address.trim().replace(/\s+/g, ' ');
  const dateOnly = transaction.createdAt.slice(0, 10);
  return `${cleanAddress} - ${dateOnly}`;
}

// -- ensureTransactionFolder ----------------------------------------------------

// opts.baseDir/opts.now thread through to the one store.writeTransaction
// call at the end, the same opts bag every src/transactions/ writer takes;
// they do not reach patchAgent/loadAgent (agentConfig.js has no baseDir
// concept, and always resolves via getStorageRoot()).
//
// Every await -- ensureAgentParentFolder's own Drive/patchAgent work, then
// this function's own drive.createFolder -- completes before the store
// write below ever runs. That write is a single synchronous
// store.writeTransaction call with the whole record already assembled in
// memory; nothing awaits between opening it and it finishing, matching the
// same discipline every src/transactions/ writer already enforces on
// itself, just held here instead of inside that directory.
//
// NO EVENT is appended for this. TC_SPEC 7.7: the event log is the record
// of what happened TO THE DEAL; a filing, a fact set, a person satisfied.
// Which Drive folder id a machine assigned itself is machinery, not
// something that happened to the deal, and does not belong in that log.
async function ensureTransactionFolder(agentConfig, transaction, opts = {}) {
  assertNonEmptyString('ensureTransactionFolder', 'agentId', agentConfig?.agentId);
  assertNonEmptyString('ensureTransactionFolder', 'transactionId', transaction?.transactionId);
  assertNonEmptyString('ensureTransactionFolder', 'address', transaction?.address);
  assertNonEmptyString('ensureTransactionFolder', 'createdAt', transaction?.createdAt);

  if (transaction.driveFolderId) {
    return transaction.driveFolderId;
  }

  const parentId = await ensureAgentParentFolder(agentConfig);
  const name = buildTransactionFolderName(transaction);
  const folder = await drive.createFolder(agentConfig, name, { parentId });

  const next = { ...transaction, driveFolderId: folder.id };
  store.writeTransaction(agentConfig.agentId, next, { baseDir: opts.baseDir, now: opts.now });

  return folder.id;
}

module.exports = {
  ensureAgentParentFolder,
  ensureTransactionFolder,
};

module.exports._internal = {
  buildTransactionFolderName,
};
