// src/claude.js
// Anthropic SDK wrapper. Handles model selection, JSON parsing for categorization,
// em-dash stripping, banned-phrase detection, and reject-and-redraft retries.
//
// This module is the only place in the system that calls the Anthropic API directly.
// Everything else (orchestrator, prompts, etc.) goes through categorize() and draft().

const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic.default({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// ---------------------------------------------------------------------------
// Model selection
// ---------------------------------------------------------------------------

const MODELS = {
  // Haiku for high-volume cheap calls (categorization runs on every reply).
  CATEGORIZATION: 'claude-haiku-4-5-20251001',
  // Sonnet for quality-sensitive low-volume calls (drafting lead-facing emails).
  DRAFTING: 'claude-sonnet-4-6',
};

const MAX_TOKENS = {
  CATEGORIZATION: 300,
  DRAFTING: 600,
};

const DRAFT_RETRY_LIMIT = 2; // initial attempt + 2 retries = 3 total attempts
const API_RETRY_BACKOFF_MS = 3000;

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/**
 * Strip em-dashes and en-dashes from text, replacing each with a comma + space.
 * Belt-and-suspenders with the prompt-level ban: even if the model produces a
 * dash, this strips it before the email reaches the lead.
 *
 * Why comma instead of removing entirely: em-dashes typically separate clauses,
 * and removing them produces sentence fragments. Comma preserves grammar.
 */
function stripDashes(text) {
  return text.replace(/[—–]/g, ', ');
}

/**
 * Find banned phrases present in text. Case-insensitive. Returns the list of
 * phrases that were found (in their original casing from the bannedList).
 *
 * Aggressive matching: a banned phrase is flagged if its lowercased form
 * appears anywhere in the lowercased text. False positives are cheap (one
 * retry); false negatives are expensive (a violation reaches the lead).
 */
function findBannedPhrases(text, bannedList) {
  const lowerText = text.toLowerCase();
  const violations = [];
  for (const phrase of bannedList) {
    if (lowerText.includes(phrase.toLowerCase())) {
      violations.push(phrase);
    }
  }
  return violations;
}

/**
 * Strip markdown code fences from a model response.
 * Models occasionally wrap raw-JSON responses in ```json ... ``` despite
 * instructions not to. Defensive parse.
 */
function stripCodeFences(text) {
  return text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();
}

/**
 * Sleep for ms milliseconds. Used for API retry backoff.
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Internal: call the Anthropic API with one retry on failure.
 * Returns the assistant text content. Throws on second failure.
 */
async function callApi({ model, maxTokens, system, user }) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await client.messages.create({
        model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: user }],
      });
      // Anthropic SDK returns content as an array of blocks. We only use text.
      const textBlock = response.content.find((b) => b.type === 'text');
      if (!textBlock) {
        throw new Error('No text content in API response');
      }
      return textBlock.text;
    } catch (err) {
      lastError = err;
      if (attempt === 0) {
        await sleep(API_RETRY_BACKOFF_MS);
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

// ---------------------------------------------------------------------------
// Categorization
// ---------------------------------------------------------------------------

/**
 * Run the categorization Claude call. Uses Haiku.
 *
 * Input: { system, user } from prompts.buildCategorizationPrompt()
 * Returns: { category, confidence, reasoning }
 *
 * Throws if the response cannot be parsed as JSON or is missing required fields.
 * The orchestrator should treat parse failures as needs_review with a logged error.
 */
async function categorize({ system, user }) {
  const rawText = await callApi({
    model: MODELS.CATEGORIZATION,
    maxTokens: MAX_TOKENS.CATEGORIZATION,
    system,
    user,
  });

  const cleaned = stripCodeFences(rawText);

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(
      `Categorization response was not valid JSON. Raw response: ${rawText.slice(0, 500)}`
    );
  }

  const { category, confidence, reasoning } = parsed;

  const validCategories = [
    'answer_general',
    'answer_property_specific',
    'hot_signal',
    'stop_signal',
    'needs_review',
  ];
  if (!validCategories.includes(category)) {
    throw new Error(`Invalid category in response: "${category}"`);
  }
  if (typeof confidence !== 'number' || confidence < 0 || confidence > 1) {
    throw new Error(`Invalid confidence in response: "${confidence}"`);
  }
  if (typeof reasoning !== 'string' || reasoning.length === 0) {
    throw new Error('Missing or empty reasoning in response');
  }

  return { category, confidence, reasoning };
}

// ---------------------------------------------------------------------------
// Drafting (with reject-and-redraft for banned phrases)
// ---------------------------------------------------------------------------

/**
 * Run a drafting Claude call with banned-phrase enforcement. Uses Sonnet.
 *
 * Behavior:
 *  1. Generate draft.
 *  2. Strip em-dashes and en-dashes (always, no retry).
 *  3. Check for banned phrases.
 *  4. If clean, return.
 *  5. If dirty, retry with a corrective prompt up to DRAFT_RETRY_LIMIT times.
 *  6. After all retries: return the last draft with escalate=true so the
 *     orchestrator can route the reply to needs_review instead of sending it.
 *
 * Input:
 *   prompts: { system, user } from prompts.buildPath1A/1B/3DraftPrompt()
 *   bannedPhrases: array of phrases (universal + agent-specific, already deduped)
 *
 * Returns:
 *   {
 *     text: string,           // post-processed draft (em-dashes stripped)
 *     violations: string[],   // banned phrases still present in final text (empty if clean)
 *     attempts: number,       // 1, 2, or 3
 *     escalate: boolean,      // true if violations remained after all retries
 *   }
 */
async function draft({ system, user }, bannedPhrases) {
  let currentSystem = system;
  let currentUser = user;
  let lastText = '';
  let lastViolations = [];

  for (let attempt = 1; attempt <= DRAFT_RETRY_LIMIT + 1; attempt++) {
    const rawText = await callApi({
      model: MODELS.DRAFTING,
      maxTokens: MAX_TOKENS.DRAFTING,
      system: currentSystem,
      user: currentUser,
    });

    const cleanedText = stripDashes(rawText.trim());
    const violations = findBannedPhrases(cleanedText, bannedPhrases);

    lastText = cleanedText;
    lastViolations = violations;

    if (violations.length === 0) {
      return {
        text: cleanedText,
        violations: [],
        attempts: attempt,
        escalate: false,
      };
    }

    // Violations found. If we have retries left, build a corrective user prompt.
    if (attempt <= DRAFT_RETRY_LIMIT) {
      const violationList = violations.map((v) => `"${v}"`).join(', ');
      currentUser = `${user}

IMPORTANT CORRECTION:
Your previous draft contained banned phrases: ${violationList}.
You MUST rewrite the email without using any of those phrases (or close variants of them). All other rules from the system prompt still apply. Try again.`;
    }
  }

  // All retries exhausted, violations persist. Signal escalation to orchestrator.
  return {
    text: lastText,
    violations: lastViolations,
    attempts: DRAFT_RETRY_LIMIT + 1,
    escalate: true,
  };
}

// ---------------------------------------------------------------------------
// Module exports
// ---------------------------------------------------------------------------

module.exports = {
  categorize,
  draft,
  // Utilities exported for testability:
  stripDashes,
  findBannedPhrases,
  stripCodeFences,
  // Constants exported for testability and orchestrator visibility:
  MODELS,
  DRAFT_RETRY_LIMIT,
};
