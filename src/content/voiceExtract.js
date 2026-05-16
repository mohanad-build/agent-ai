'use strict';

const claude  = require('../claude');
const profile = require('./profile');

const { MODELS }              = claude;
const { readContentProfile, updateContentProfile } = profile;
const { ProfileNotFoundError } = profile;

// ── Error class ───────────────────────────────────────────────────────────────

class VoiceExtractionError extends Error {
  constructor({ message, cause, errors, attempts }) {
    super(message);
    this.name     = 'VoiceExtractionError';
    this.cause    = cause;
    this.errors   = errors;
    this.attempts = attempts;
  }
}

// ── Constants ─────────────────────────────────────────────────────────────────

const DESCRIPTOR_SCHEMA_VERSION = 1;

const VALID_TIERS = new Set(['extracted', 'self_described', 'default']);

const SYSTEM_DEFAULT_DESCRIPTOR = Object.freeze({
  version:           1,
  extractedAt:       null,
  modelUsed:         'system_default',
  samplesUsedCount:  0,
  tier:              'default',
  tone:              'Warm and professional. Treats clients as informed adults. Avoids hype and pressure.',
  sentenceRhythm:    'Mix of short and medium sentences. Paragraphs of 2-4 sentences. Occasional one-line paragraphs for emphasis.',
  signaturePhrases:  [],
  vocabularyNotes:   'Uses clear, accessible vocabulary. Avoids industry jargon when speaking to clients. Prefers concrete language over abstractions.',
  ctaPattern:        'Soft closing with an invitation to reach out. Provides a clear next step without urgency.',
  hookPattern:       'Opens with the most relevant piece of information for the reader, often a recent market development or a specific question worth answering.',
  extractedRefusals: ['hustle', 'crushing it', 'dont miss out', 'opportunity of a lifetime'],
  rawSummary:        'A warm professional Toronto real estate agent voice. Communicates clearly, respects the readers intelligence, avoids high-pressure sales language. Treats real estate transactions as significant life decisions deserving careful attention. Defaults to soft CTAs and reader-empowering framing. This is a generic fallback voice; agent has not yet provided samples or a self-description to tune from.',
});

// ── Schema text shared by both prompts ───────────────────────────────────────

const SCHEMA_DESCRIPTION = `{
  "version": 1,
  "extractedAt": "<ISO 8601 timestamp string>",
  "modelUsed": "<model id string>",
  "samplesUsedCount": <integer 0-5>,
  "tier": "extracted" | "self_described" | "default",
  "tone": "<2-3 sentences describing overall tone>",
  "sentenceRhythm": "<short/long mix, paragraph length, use of fragments>",
  "signaturePhrases": ["<phrase>", ...],
  "vocabularyNotes": "<words they reach for, words they avoid>",
  "ctaPattern": "<how they typically close>",
  "hookPattern": "<how they open>",
  "extractedRefusals": ["<word or phrase>", ...],
  "rawSummary": "<200-word freeform paragraph synthesizing the voice>"
}

Field guidance:
- tone: 2-3 sentences. Non-empty.
- sentenceRhythm: describe cadence and paragraph shape. Non-empty.
- signaturePhrases: 0-10 items, each a non-empty string. Phrases this person actually uses.
- vocabularyNotes: words and patterns they favour and avoid. Non-empty.
- ctaPattern: how they close content. Non-empty.
- hookPattern: how they open content. Non-empty.
- extractedRefusals: 0-10 items, inferred from what the voice avoids -- not external rules.
- rawSummary: approximately 200 words, freeform synthesis. Non-empty.
- Do not use em-dashes anywhere in any string values.`;

// ── Prompt builders ───────────────────────────────────────────────────────────

const SYSTEM_PROMPT_TIER1 =
  'You are a careful editorial analyst. Your job is to read writing samples from ' +
  'a real estate professional and produce a structured voice descriptor that ' +
  'captures how this specific person sounds in their writing. Return ONLY valid ' +
  'JSON matching the requested schema. No preamble, no markdown fences, no ' +
  'trailing commentary. Do not use em-dashes anywhere in the JSON values.';

const SYSTEM_PROMPT_TIER2 =
  'You are a careful editorial analyst. Your job is to read a self-description ' +
  'from a real estate professional and produce a structured voice descriptor that ' +
  'captures how this specific person sounds in their writing. Return ONLY valid ' +
  'JSON matching the requested schema. No preamble, no markdown fences, no ' +
  'trailing commentary. Do not use em-dashes anywhere in the JSON values.';

function buildExtractionPrompt(samples) {
  const sampleBlocks = samples.map((s, i) => {
    const truncated = truncateSampleContent(s.content);
    return `=== SAMPLE ${i + 1} (type: ${s.type}) ===\n${truncated}`;
  }).join('\n\n');

  const user =
    `Below are ${samples.length} sample(s) of writing. Samples may include video transcripts, ` +
    `blog posts, emails, IG captions, voice notes, and free-writes. Read all samples carefully, ` +
    `then produce a voice descriptor following this exact JSON schema:\n\n` +
    `${SCHEMA_DESCRIPTION}\n\n` +
    `Focus on what makes this voice distinctive, not generic real estate agent traits. ` +
    `If samples are short or limited, produce thinner content but still complete the schema. ` +
    `Synthesize across samples; note format-specific patterns where they emerge.\n\n` +
    sampleBlocks;

  return { system: SYSTEM_PROMPT_TIER1, user };
}

function buildSelfDescriptionPrompt(selfDescription) {
  const user =
    `Below is a brief self-description from a real estate professional about how ` +
    `they sound in their writing. Use this to produce a voice descriptor following ` +
    `this exact JSON schema:\n\n` +
    `${SCHEMA_DESCRIPTION}\n\n` +
    `Where the self-description is silent on a field, produce reasonable inferences ` +
    `but mark them as tentative in tone (e.g., "likely uses short sentences" rather ` +
    `than "uses short sentences"). Where the self-description is explicit, capture it ` +
    `precisely. Do not invent signature phrases the agent has not stated; leave that ` +
    `array empty if no phrases are evident.\n\n` +
    `=== SELF-DESCRIPTION ===\n${selfDescription}`;

  return { system: SYSTEM_PROMPT_TIER2, user };
}

// ── Sample truncation ─────────────────────────────────────────────────────────

function truncateSampleContent(content, maxWords = 2000) {
  const tokens = content.split(/\s+/);
  if (tokens.length <= maxWords) return content;
  return tokens.slice(0, maxWords).join(' ') + ' [truncated]';
}

// ── Descriptor validation ─────────────────────────────────────────────────────

function validateDescriptor(d) {
  const errors = [];

  if (!Number.isInteger(d.version) || d.version !== DESCRIPTOR_SCHEMA_VERSION) {
    errors.push(`version: must be integer ${DESCRIPTOR_SCHEMA_VERSION}`);
  }

  if (typeof d.extractedAt !== 'string' || Number.isNaN(new Date(d.extractedAt).getTime())) {
    errors.push('extractedAt: must be a valid ISO 8601 string');
  }

  if (typeof d.modelUsed !== 'string' || d.modelUsed.trim() === '') {
    errors.push('modelUsed: missing or empty');
  }

  if (!Number.isInteger(d.samplesUsedCount) || d.samplesUsedCount < 0) {
    errors.push('samplesUsedCount: must be a non-negative integer');
  }

  if (!VALID_TIERS.has(d.tier)) {
    errors.push(`tier: must be one of ${[...VALID_TIERS].join(', ')}`);
  }

  for (const field of ['tone', 'sentenceRhythm', 'vocabularyNotes', 'ctaPattern', 'hookPattern', 'rawSummary']) {
    if (typeof d[field] !== 'string' || d[field].trim() === '') {
      errors.push(`${field}: missing or empty`);
    }
  }

  for (const field of ['signaturePhrases', 'extractedRefusals']) {
    if (!Array.isArray(d[field])) {
      errors.push(`${field}: must be an array`);
      continue;
    }
    if (d[field].length > 10) {
      errors.push(`${field}: maximum 10 items`);
    }
    d[field].forEach((item, i) => {
      if (typeof item !== 'string') {
        errors.push(`${field}: contains non-string at index ${i}`);
      } else if (item.trim() === '') {
        errors.push(`${field}: contains empty string at index ${i}`);
      }
    });
  }

  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}

// ── Core extraction logic ─────────────────────────────────────────────────────

async function extractVoice(samples, selfDescription, opts = {}) {
  const model = opts.model || MODELS.SONNET;

  // Tier 3 -- no samples and no self-description
  const trimmedDesc = (typeof selfDescription === 'string') ? selfDescription.trim() : '';
  if (!samples || samples.length === 0) {
    if (!trimmedDesc) {
      const clone = structuredClone(SYSTEM_DEFAULT_DESCRIPTOR);
      clone.extractedAt = new Date().toISOString();
      return clone;
    }
  }

  // Build prompt for Tier 1 or Tier 2
  const hasSamples = samples && samples.length > 0;
  const { system, user } = hasSamples
    ? buildExtractionPrompt(samples)
    : buildSelfDescriptionPrompt(trimmedDesc);

  let lastParseError;
  let lastValidationErrors;

  for (let attempt = 1; attempt <= 2; attempt++) {
    const raw = await claude.callRaw({ system, user, model, maxTokens: 2048 });

    // Defensive strip of code fences and whitespace
    let cleaned = raw.trim();
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (parseErr) {
      lastParseError = parseErr;
      if (attempt === 1) continue;
      throw new VoiceExtractionError({
        message:  'Claude response could not be parsed as JSON after 2 attempts',
        cause:    parseErr,
        attempts: 2,
      });
    }

    const validation = validateDescriptor(parsed);
    if (!validation.valid) {
      lastValidationErrors = validation.errors;
      if (attempt === 1) continue;
      throw new VoiceExtractionError({
        message:  'Claude response failed schema validation after 2 attempts',
        errors:   validation.errors,
        attempts: 2,
      });
    }

    // Augment with authoritative metadata (overwrite whatever Claude returned)
    parsed.version          = DESCRIPTOR_SCHEMA_VERSION;
    parsed.extractedAt      = new Date().toISOString();
    parsed.modelUsed        = model;
    parsed.samplesUsedCount = hasSamples ? samples.length : 0;
    parsed.tier             = hasSamples ? 'extracted' : 'self_described';

    return parsed;
  }

  // Should not reach here -- loop exits via return or throw
  throw new VoiceExtractionError({
    message:  'Voice extraction failed unexpectedly',
    cause:    lastParseError,
    errors:   lastValidationErrors,
    attempts: 2,
  });
}

// ── Orchestration wrapper ─────────────────────────────────────────────────────

async function extractVoiceForAgent(agentId, opts = {}) {
  const p = readContentProfile(agentId, opts);
  if (p === null) throw new ProfileNotFoundError(agentId);

  // Idempotency check
  if (p.voiceDescriptor && opts.force !== true) {
    if (p.voiceDescriptorVersion === DESCRIPTOR_SCHEMA_VERSION) {
      return { extracted: false, reason: 'already_present', descriptor: p.voiceDescriptor };
    }
    // Version mismatch -- re-extract
    console.log(
      `[voiceExtract] schema version bump ${p.voiceDescriptorVersion} -> ${DESCRIPTOR_SCHEMA_VERSION}, ` +
      `re-extracting for ${agentId}`
    );
  }

  const descriptor = await extractVoice(p.voiceSamples || [], p.selfDescription || '', opts);

  updateContentProfile(agentId, {
    voiceDescriptor:        descriptor,
    voiceDescriptorVersion: DESCRIPTOR_SCHEMA_VERSION,
    voiceDescriptorTier:    descriptor.tier,
    voiceExtractedAt:       new Date().toISOString(),
  }, opts);

  return { extracted: true, descriptor, tier: descriptor.tier };
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  SYSTEM_DEFAULT_DESCRIPTOR,
  DESCRIPTOR_SCHEMA_VERSION,
  extractVoice,
  extractVoiceForAgent,
  VoiceExtractionError,
  _internal: {
    validateDescriptor,
    truncateSampleContent,
    buildExtractionPrompt,
    buildSelfDescriptionPrompt,
  },
};
