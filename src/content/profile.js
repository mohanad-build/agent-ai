'use strict';

const fs   = require('node:fs');
const path = require('node:path');

const { getStorageRoot } = require('../storagePaths');

// ── Error classes ─────────────────────────────────────────────────────────────

class ProfileNotFoundError extends Error {
  constructor(agentId) {
    super(`Content profile not found for agent: ${agentId}`);
    this.name = 'ProfileNotFoundError';
  }
}

class SchemaValidationError extends Error {
  /** @param {string[]} errors */
  constructor(errors) {
    super(`Content profile validation failed: ${errors.join('; ')}`);
    this.name = 'SchemaValidationError';
    this.errors = errors;
  }
}

class ProfileCorruptionError extends Error {
  constructor(agentId, cause) {
    super(`Content profile for agent '${agentId}' contains invalid JSON: ${cause.message}`);
    this.name = 'ProfileCorruptionError';
  }
}

// ── Constants ─────────────────────────────────────────────────────────────────

const VALID_MODES        = new Set(['shadow', 'live']);
const VALID_FOCUS        = new Set(['buyers', 'sellers', 'both']);
const VALID_VOLUMES      = new Set(['max', 'balanced', 'minimum']);
const VALID_CADENCES     = new Set(['weekly']);
const VALID_DAYS         = new Set(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']);
const VALID_TIERS        = new Set(['extracted', 'self_described', 'default']);
const VALID_SAMPLE_TYPES = new Set(['video_transcript', 'blog_post', 'email', 'voice_note_transcript', 'social_post', 'free_write']);
const DELIVERY_TIME_RE   = /^([01]\d|2[0-3]):[0-5]\d$/;

// ── Path helper ───────────────────────────────────────────────────────────────

function profilePath(baseDir, agentId) {
  return path.join(baseDir, 'agents', `${agentId}.contentProfile.json`);
}

// ── Normalization (applied silently before validation) ────────────────────────

function normalizeProfile(profile) {
  const out = { ...profile };

  if (typeof out.deliveryDay === 'string') {
    out.deliveryDay = out.deliveryDay.toLowerCase();
  }

  if (Array.isArray(out.forbiddenTerms)) {
    out.forbiddenTerms = out.forbiddenTerms.map(t =>
      typeof t === 'string' ? t.trim().toLowerCase() : t
    );
  }

  if (Array.isArray(out.forbiddenTopics)) {
    out.forbiddenTopics = out.forbiddenTopics.map(t =>
      typeof t === 'string' ? t.trim() : t
    );
  }

  return out;
}

// ── Validation ────────────────────────────────────────────────────────────────

function validateProfile(profile) {
  const errors = [];

  if (typeof profile.agentId !== 'string' || profile.agentId.trim() === '') {
    errors.push('agentId: required non-empty string');
  }

  if (typeof profile.contentEngineEnabled !== 'boolean') {
    errors.push('contentEngineEnabled: required boolean');
  }

  if (!VALID_MODES.has(profile.contentEngineMode)) {
    errors.push(`contentEngineMode: must be one of ${[...VALID_MODES].join(', ')}`);
  }

  if (!VALID_FOCUS.has(profile.primaryFocus)) {
    errors.push(`primaryFocus: must be one of ${[...VALID_FOCUS].join(', ')}`);
  }

  if (!VALID_VOLUMES.has(profile.contentVolume)) {
    errors.push(`contentVolume: must be one of ${[...VALID_VOLUMES].join(', ')}`);
  }

  if (!VALID_CADENCES.has(profile.cadence)) {
    errors.push(`cadence: must be one of ${[...VALID_CADENCES].join(', ')}`);
  }

  if (!VALID_DAYS.has(profile.deliveryDay)) {
    errors.push('deliveryDay: must be a lowercase day name (monday through sunday)');
  }

  if (typeof profile.deliveryTime !== 'string' || !DELIVERY_TIME_RE.test(profile.deliveryTime)) {
    errors.push('deliveryTime: must match HH:MM (24h) format, e.g. 07:00 or 23:59');
  }

  if (typeof profile.timezone !== 'string' || profile.timezone.trim() === '') {
    errors.push('timezone: required non-empty string');
  }

  if (!VALID_TIERS.has(profile.voiceDescriptorTier)) {
    errors.push(`voiceDescriptorTier: must be one of ${[...VALID_TIERS].join(', ')}`);
  }

  if (
    typeof profile.activatedAt !== 'string' ||
    Number.isNaN(new Date(profile.activatedAt).getTime())
  ) {
    errors.push('activatedAt: required ISO 8601 string');
  }

  // Optional with type constraints

  if (profile.voiceSamples !== undefined) {
    if (!Array.isArray(profile.voiceSamples)) {
      errors.push('voiceSamples: must be an array');
    } else if (profile.voiceSamples.length > 5) {
      errors.push('voiceSamples: maximum 5 items allowed');
    } else {
      profile.voiceSamples.forEach((s, i) => {
        if (s == null || typeof s !== 'object' || Array.isArray(s)) {
          errors.push(`voiceSamples[${i}]: must be an object`);
          return;
        }
        if (!VALID_SAMPLE_TYPES.has(s.type)) {
          errors.push(`voiceSamples[${i}].type: must be one of ${[...VALID_SAMPLE_TYPES].join(', ')}`);
        }
        if (typeof s.content !== 'string') {
          errors.push(`voiceSamples[${i}].content: must be a string`);
        }
      });
    }
  }

  if (profile.selfDescription !== undefined && profile.selfDescription !== null) {
    if (typeof profile.selfDescription !== 'string') {
      errors.push('selfDescription: must be a string');
    } else if (profile.selfDescription.length > 1000) {
      errors.push('selfDescription: maximum 1000 characters');
    }
  }

  if (profile.voiceDescriptor !== undefined && profile.voiceDescriptor !== null) {
    if (typeof profile.voiceDescriptor !== 'string') {
      errors.push('voiceDescriptor: must be a string or null');
    }
  }

  if (profile.voiceDescriptorVersion !== undefined) {
    if (!Number.isInteger(profile.voiceDescriptorVersion) || profile.voiceDescriptorVersion < 1) {
      errors.push('voiceDescriptorVersion: must be a positive integer');
    }
  }

  if (profile.voiceExtractedAt !== undefined && profile.voiceExtractedAt !== null) {
    if (
      typeof profile.voiceExtractedAt !== 'string' ||
      Number.isNaN(new Date(profile.voiceExtractedAt).getTime())
    ) {
      errors.push('voiceExtractedAt: must be an ISO 8601 string or null');
    }
  }

  if (profile.forbiddenTerms !== undefined) {
    if (!Array.isArray(profile.forbiddenTerms)) {
      errors.push('forbiddenTerms: must be an array');
    } else {
      profile.forbiddenTerms.forEach((t, i) => {
        if (typeof t !== 'string') errors.push(`forbiddenTerms[${i}]: must be a string`);
      });
    }
  }

  if (profile.forbiddenTopics !== undefined) {
    if (!Array.isArray(profile.forbiddenTopics)) {
      errors.push('forbiddenTopics: must be an array');
    } else {
      profile.forbiddenTopics.forEach((t, i) => {
        if (typeof t !== 'string') errors.push(`forbiddenTopics[${i}]: must be a string`);
      });
    }
  }

  return errors;
}

// ── Public API ────────────────────────────────────────────────────────────────

function readContentProfile(agentId, opts = {}) {
  const baseDir = opts.baseDir || getStorageRoot();
  const filePath = profilePath(baseDir, agentId);
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new ProfileCorruptionError(agentId, err);
  }
}

function writeContentProfile(agentId, profile, opts = {}) {
  const baseDir = opts.baseDir || getStorageRoot();
  const normalized = normalizeProfile(profile);
  const errors = validateProfile(normalized);
  if (errors.length > 0) throw new SchemaValidationError(errors);
  const filePath = profilePath(baseDir, agentId);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(normalized, null, 2), 'utf8');
  fs.renameSync(tmp, filePath);
  return normalized;
}

function updateContentProfile(agentId, patch, opts = {}) {
  const existing = readContentProfile(agentId, opts);
  if (existing === null) throw new ProfileNotFoundError(agentId);
  return writeContentProfile(agentId, { ...existing, ...patch }, opts);
}

function setContentEngineEnabled(agentId, enabled, opts = {}) {
  if (typeof enabled !== 'boolean') {
    throw new TypeError(`setContentEngineEnabled: enabled must be a boolean, got ${typeof enabled}`);
  }
  return updateContentProfile(agentId, { contentEngineEnabled: enabled }, opts);
}

function isContentEngineEnabled(agentId, opts = {}) {
  const profile = readContentProfile(agentId, opts);
  if (profile === null) return false;
  return profile.contentEngineEnabled === true;
}

function buildDefaultContentProfile(agentId, overrides = {}) {
  if (typeof agentId !== 'string' || agentId.trim() === '') {
    throw new TypeError('buildDefaultContentProfile: agentId must be a non-empty string');
  }
  return {
    agentId,
    contentEngineEnabled: false,
    contentEngineMode:    'shadow',
    primaryFocus:         'both',
    voiceSamples:         [],
    selfDescription:      '',
    voiceDescriptor:      null,
    voiceDescriptorVersion: 1,
    voiceDescriptorTier:  'default',
    voiceExtractedAt:     null,
    forbiddenTerms:       [],
    forbiddenTopics:      [],
    contentVolume:        'max',
    cadence:              'weekly',
    deliveryDay:          'monday',
    deliveryTime:         '07:00',
    timezone:             'America/Toronto',
    activatedAt:          new Date().toISOString(),
    ...overrides,
  };
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  ProfileNotFoundError,
  SchemaValidationError,
  ProfileCorruptionError,
  readContentProfile,
  writeContentProfile,
  updateContentProfile,
  setContentEngineEnabled,
  isContentEngineEnabled,
  buildDefaultContentProfile,
};
