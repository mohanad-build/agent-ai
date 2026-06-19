'use strict';

const fs   = require('node:fs');
const path = require('node:path');

const { getStorageRoot } = require('../storagePaths');

// ── Error classes ─────────────────────────────────────────────────────────────

class ContentStateNotFoundError extends Error {
  constructor(agentId) {
    super(`Content state not found for agent: ${agentId}`);
    this.name = 'ContentStateNotFoundError';
    this.agentId = agentId;
  }
}

class ContentStateSchemaValidationError extends Error {
  constructor(message, errors) {
    super(message);
    this.name = 'ContentStateSchemaValidationError';
    this.errors = errors;
  }
}

class ContentStateCorruptionError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'ContentStateCorruptionError';
    if (cause !== undefined) this.cause = cause;
  }
}

// ── Constants ─────────────────────────────────────────────────────────────────

const WEEK_ISO_RE = /^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/;
const PIECE_ID_RE = /^(reel|blog)-\d{3}$/;

// ── Path helper ───────────────────────────────────────────────────────────────

function statePath(baseDir, agentId) {
  return path.join(baseDir, 'agents', `${agentId}.contentState.json`);
}

// ── Normalization ─────────────────────────────────────────────────────────────

function normalizeState(state) {
  return state;
}

// ── Validation ────────────────────────────────────────────────────────────────

function isIsoString(value) {
  return typeof value === 'string' && !Number.isNaN(new Date(value).getTime());
}

function validateState(state) {
  const errors = [];

  if (typeof state.agentId !== 'string' || state.agentId.trim() === '') {
    errors.push('agentId: required non-empty string');
  }

  if (state.schemaVersion !== 1) {
    errors.push('schemaVersion: must be 1');
  }

  if (!isIsoString(state.createdAt)) {
    errors.push('createdAt: required ISO 8601 string');
  }

  if (state.lastContentBatchSent !== null && !isIsoString(state.lastContentBatchSent)) {
    errors.push('lastContentBatchSent: must be null or ISO 8601 string');
  }

  if (state.batches === null || typeof state.batches !== 'object' || Array.isArray(state.batches)) {
    errors.push('batches: must be an object');
  } else {
    for (const [weekIso, batch] of Object.entries(state.batches)) {
      if (!WEEK_ISO_RE.test(weekIso)) {
        errors.push(`batches.${weekIso}: weekIso must match YYYY-Www format`);
      }

      if (batch.sentAt !== null && !isIsoString(batch.sentAt)) {
        errors.push(`batches.${weekIso}.sentAt: must be null or ISO 8601 string`);
      }

      if (!Array.isArray(batch.availableAngles)) {
        errors.push(`batches.${weekIso}.availableAngles: must be an array`);
      } else {
        batch.availableAngles.forEach((angle, i) => {
          const loc = `batches.${weekIso}.availableAngles[${i}]`;
          if (typeof angle.id !== 'string' || angle.id.trim() === '') {
            errors.push(`${loc}.id: required non-empty string`);
          }
          if (typeof angle.headline !== 'string' || angle.headline.trim() === '') {
            errors.push(`${loc}.headline: required non-empty string`);
          }
          if (typeof angle.themeTag !== 'string' || angle.themeTag.trim() === '') {
            errors.push(`${loc}.themeTag: required non-empty string`);
          }
          if (typeof angle.longFormSuitable !== 'boolean') {
            errors.push(`${loc}.longFormSuitable: required boolean`);
          }
          if (typeof angle.forbidsRateAdvice !== 'boolean') {
            errors.push(`${loc}.forbidsRateAdvice: required boolean`);
          }
          if (!Array.isArray(angle.bestSuitedFor)) {
            errors.push(`${loc}.bestSuitedFor: required array of strings`);
          } else {
            angle.bestSuitedFor.forEach((v, j) => {
              if (typeof v !== 'string') {
                errors.push(`${loc}.bestSuitedFor[${j}]: must be a string`);
              }
            });
          }
          if (typeof angle.surpriseScore !== 'number') {
            errors.push(`${loc}.surpriseScore: required number`);
          }
        });
      }

      if (batch.pieces === null || typeof batch.pieces !== 'object' || Array.isArray(batch.pieces)) {
        errors.push(`batches.${weekIso}.pieces: must be an object`);
      } else {
        for (const [pieceId, piece] of Object.entries(batch.pieces)) {
          if (!PIECE_ID_RE.test(pieceId)) {
            errors.push(`batches.${weekIso}.pieces.${pieceId}: pieceId must match (reel|blog)-NNN format`);
          }
          if (typeof piece.angleId !== 'string' || piece.angleId.trim() === '') {
            errors.push(`batches.${weekIso}.pieces.${pieceId}.angleId: required non-empty string`);
          }
          if (typeof piece.themeTag !== 'string' || piece.themeTag.trim() === '') {
            errors.push(`batches.${weekIso}.pieces.${pieceId}.themeTag: required non-empty string`);
          }
          if (typeof piece.forbidsRateAdvice !== 'boolean') {
            errors.push(`batches.${weekIso}.pieces.${pieceId}.forbidsRateAdvice: required boolean`);
          }
          if (!Number.isInteger(piece.regenCount) || piece.regenCount < 0) {
            errors.push(`batches.${weekIso}.pieces.${pieceId}.regenCount: must be integer >= 0`);
          }
          if (!Number.isInteger(piece.swapCount) || piece.swapCount < 0) {
            errors.push(`batches.${weekIso}.pieces.${pieceId}.swapCount: must be integer >= 0`);
          }

          if (!Array.isArray(piece.versions)) {
            errors.push(`batches.${weekIso}.pieces.${pieceId}.versions: must be an array`);
          } else {
            const versionIds = new Set();
            piece.versions.forEach((v, i) => {
              const loc = `batches.${weekIso}.pieces.${pieceId}.versions[${i}]`;
              if (typeof v.versionId !== 'string' || !v.versionId.startsWith('v-')) {
                errors.push(`${loc}.versionId: must be a string starting with "v-"`);
              } else {
                versionIds.add(v.versionId);
              }
              if (typeof v.text !== 'string') {
                errors.push(`${loc}.text: must be a string`);
              }
              if (!isIsoString(v.generatedAt)) {
                errors.push(`${loc}.generatedAt: required ISO 8601 string`);
              }
              if (v.claudeCallId !== null && typeof v.claudeCallId !== 'string') {
                errors.push(`${loc}.claudeCallId: must be null or string`);
              }
            });

            if (piece.approvedVersionId !== null) {
              if (typeof piece.approvedVersionId !== 'string') {
                errors.push(`batches.${weekIso}.pieces.${pieceId}.approvedVersionId: must be null or a versionId string`);
              } else if (!versionIds.has(piece.approvedVersionId)) {
                errors.push(`batches.${weekIso}.pieces.${pieceId}.approvedVersionId: "${piece.approvedVersionId}" not found in versions`);
              }
            }
          }
        }
      }
    }
  }

  if (errors.length > 0) {
    throw new ContentStateSchemaValidationError(
      `Content state validation failed: ${errors.join('; ')}`,
      errors
    );
  }
}

// ── Atomic write ──────────────────────────────────────────────────────────────

function writeStateFile(filePath, state) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
  fs.renameSync(tmp, filePath);
}

// ── Public API ────────────────────────────────────────────────────────────────

function readContentState(agentId, opts = {}) {
  const baseDir = opts.baseDir || getStorageRoot();
  const filePath = statePath(baseDir, agentId);
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      const defaultState = buildDefaultContentState(agentId, opts);
      writeStateFile(filePath, defaultState);
      return defaultState;
    }
    throw new ContentStateCorruptionError(
      `Failed to read content state for agent '${agentId}': ${err.message}`,
      err
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new ContentStateCorruptionError(
      `Content state for agent '${agentId}' contains invalid JSON: ${err.message}`,
      err
    );
  }
  validateState(parsed);
  return parsed;
}

function writeContentState(agentId, state, opts = {}) {
  const baseDir = opts.baseDir || getStorageRoot();
  validateState(state);
  const filePath = statePath(baseDir, agentId);
  writeStateFile(filePath, state);
  return state;
}

function updateContentState(agentId, patch, opts = {}) {
  const current = readContentState(agentId, opts);
  const merged = { ...current, ...patch };
  return writeContentState(agentId, merged, opts);
}

function initBatch(agentId, weekIso, { pieces, availableAngles }, opts = {}) {
  const state = readContentState(agentId, opts);
  if (state.batches[weekIso]) {
    throw new Error(`Batch already exists for weekIso: ${weekIso}`);
  }
  const piecesMap = {};
  for (const p of pieces) {
    piecesMap[p.id] = {
      angleId: p.angleId,
      themeTag: p.themeTag,
      forbidsRateAdvice: p.forbidsRateAdvice,
      regenCount: 0,
      swapCount: 0,
      versions: [{
        versionId: `v-${p.initialVersion.generatedAt}`,
        text: p.initialVersion.text,
        generatedAt: p.initialVersion.generatedAt,
        claudeCallId: p.initialVersion.claudeCallId ?? null,
      }],
      approvedVersionId: null,
    };
  }
  state.batches[weekIso] = { sentAt: null, availableAngles: availableAngles ?? [], pieces: piecesMap };
  return writeContentState(agentId, state, opts);
}

function recordRegen(agentId, weekIso, pieceId, newVersion, opts = {}) {
  const state = readContentState(agentId, opts);
  if (!state.batches[weekIso]) {
    throw new Error(`Batch not found for weekIso: ${weekIso}`);
  }
  if (!state.batches[weekIso].pieces[pieceId]) {
    throw new Error(`Piece not found: ${pieceId} in batch ${weekIso}`);
  }
  const piece = state.batches[weekIso].pieces[pieceId];
  piece.versions.push({
    versionId: `v-${newVersion.generatedAt}`,
    text: newVersion.text,
    generatedAt: newVersion.generatedAt,
    claudeCallId: newVersion.claudeCallId ?? null,
  });
  piece.regenCount += 1;
  return writeContentState(agentId, state, opts);
}

function recordSwap(agentId, weekIso, pieceId, newAngleData, newVersion, opts = {}) {
  const state = readContentState(agentId, opts);
  if (!state.batches[weekIso]) {
    throw new Error(`Batch not found for weekIso: ${weekIso}`);
  }
  if (!state.batches[weekIso].pieces[pieceId]) {
    throw new Error(`Piece not found: ${pieceId} in batch ${weekIso}`);
  }
  const piece = state.batches[weekIso].pieces[pieceId];
  piece.angleId = newAngleData.angleId;
  piece.themeTag = newAngleData.themeTag;
  piece.forbidsRateAdvice = newAngleData.forbidsRateAdvice;
  piece.versions = [{
    versionId: `v-${newVersion.generatedAt}`,
    text: newVersion.text,
    generatedAt: newVersion.generatedAt,
    claudeCallId: newVersion.claudeCallId ?? null,
  }];
  piece.swapCount += 1;
  piece.approvedVersionId = null;
  // regenCount carries over: a regen-then-swap within the same batch keeps the count
  return writeContentState(agentId, state, opts);
}

function approveVersion(agentId, weekIso, pieceId, versionId, opts = {}) {
  const state = readContentState(agentId, opts);
  if (!state.batches[weekIso]) {
    throw new Error(`Batch not found for weekIso: ${weekIso}`);
  }
  if (!state.batches[weekIso].pieces[pieceId]) {
    throw new Error(`Piece not found: ${pieceId} in batch ${weekIso}`);
  }
  const piece = state.batches[weekIso].pieces[pieceId];
  if (!piece.versions.some(v => v.versionId === versionId)) {
    throw new Error(`versionId not found: ${versionId} in piece ${pieceId}`);
  }
  piece.approvedVersionId = versionId;
  return writeContentState(agentId, state, opts);
}

function recordBatchSent(agentId, weekIso, sentAt, opts = {}) {
  const state = readContentState(agentId, opts);
  if (!state.batches[weekIso]) {
    throw new Error(`Batch not found for weekIso: ${weekIso}`);
  }
  state.lastContentBatchSent = sentAt;
  state.batches[weekIso].sentAt = sentAt;
  return writeContentState(agentId, state, opts);
}

function buildAgentHistory(agentId, opts = {}) {
  const state = readContentState(agentId, opts);
  const weekKeys = Object.keys(state.batches).sort().reverse();
  if (weekKeys.length === 0) {
    return { recentThemeTags: [], rejectedRateContent: false };
  }
  const recentKeys = weekKeys.slice(0, 2);
  const themeTags = new Set();
  let rejectedRateContent = false;
  for (const weekIso of recentKeys) {
    const batch = state.batches[weekIso];
    for (const piece of Object.values(batch.pieces)) {
      if (piece.approvedVersionId !== null) {
        themeTags.add(piece.themeTag);
      }
      if (piece.forbidsRateAdvice && piece.regenCount > 0) {
        rejectedRateContent = true;
      }
    }
  }
  return {
    recentThemeTags: [...themeTags].sort(),
    rejectedRateContent,
  };
}

// ── Factory ───────────────────────────────────────────────────────────────────

function buildDefaultContentState(agentId, opts = {}) {
  if (typeof agentId !== 'string' || agentId.trim() === '') {
    throw new TypeError('buildDefaultContentState: agentId must be a non-empty string');
  }
  return {
    agentId,
    schemaVersion: 1,
    createdAt: (opts.now || new Date()).toISOString(),
    lastContentBatchSent: null,
    batches: {},
  };
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  ContentStateNotFoundError,
  ContentStateSchemaValidationError,
  ContentStateCorruptionError,
  readContentState,
  writeContentState,
  updateContentState,
  initBatch,
  recordRegen,
  recordSwap,
  approveVersion,
  recordBatchSent,
  buildAgentHistory,
  buildDefaultContentState,
};

module.exports._internal = {
  statePath,
  normalizeState,
  validateState,
  writeStateFile,
};
