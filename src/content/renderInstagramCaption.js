'use strict';

const claude = require('../claude');

const { MODELS, stripDashes } = claude;

// ── Error class ───────────────────────────────────────────────────────────────

class InstagramCaptionGenerationError extends Error {
  constructor(message, { cause, validationErrors } = {}) {
    super(message);
    this.name = 'InstagramCaptionGenerationError';
    if (cause) this.cause = cause;
    if (validationErrors) this.validationErrors = validationErrors;
  }
}

// ── Input validation ──────────────────────────────────────────────────────────

function validateInputs({ angle, contentProfile, reelScript }) {
  if (angle == null || typeof angle !== 'object') {
    throw new TypeError('angle must be a non-null object');
  }
  if (typeof angle.headline !== 'string' || angle.headline.trim() === '') {
    throw new TypeError('angle.headline must be a non-empty string');
  }
  if (typeof angle.thesis !== 'string' || angle.thesis.trim() === '') {
    throw new TypeError('angle.thesis must be a non-empty string');
  }
  if (!Array.isArray(angle.dataPoints)) {
    throw new TypeError('angle.dataPoints must be an array');
  }
  if (typeof angle.sourceFooter !== 'string' || angle.sourceFooter.trim() === '') {
    throw new TypeError('angle.sourceFooter must be a non-empty string');
  }
  if (!('forbidsRateAdvice' in angle)) {
    throw new TypeError('angle.forbidsRateAdvice is required');
  }

  if (contentProfile == null || typeof contentProfile !== 'object') {
    throw new TypeError('contentProfile must be a non-null object');
  }
  if (typeof contentProfile.voiceDescriptor !== 'string') {
    throw new TypeError('contentProfile.voiceDescriptor must be a string');
  }
  if (!Array.isArray(contentProfile.forbiddenTerms)) {
    throw new TypeError('contentProfile.forbiddenTerms must be an array');
  }
  if (!Array.isArray(contentProfile.forbiddenTopics)) {
    throw new TypeError('contentProfile.forbiddenTopics must be an array');
  }

  if (typeof reelScript !== 'string' || reelScript.trim() === '') {
    throw new TypeError('reelScript must be a non-empty string');
  }
}

// ── buildInstagramCaptionPrompt ───────────────────────────────────────────────

function buildInstagramCaptionPrompt({ angle, contentProfile, reelScript }) {
  const forbiddenTermsList = contentProfile.forbiddenTerms.join(', ');
  const forbiddenTopicsList = contentProfile.forbiddenTopics.join(', ');

  const system = [
    'You are writing an Instagram caption that accompanies a 60-90 second Reel for a Canadian real estate agent. The caption is the prose that lives under the video; together they ship as one post.',
    '',
    'VOICE -- non-negotiable:',
    'The agent\'s voice descriptor is the load-bearing context. It dominates any generic "social caption" tone. If voice descriptor and the angle\'s tone conflict, voice descriptor wins. Do not soften toward neutral.',
    '',
    contentProfile.voiceDescriptor,
    '',
    'RELATIONSHIP TO THE REEL:',
    'A Reel script has already been written for the same angle. Use it for thematic alignment, not as source material. The caption must:',
    '- Cover the same theme as the script',
    '- Cite the same data points',
    '- Use complementary phrasing, not duplicate the script\'s hook verbatim',
    '- Read as written by the same person looking at the same data',
    '',
    'The Reel script is provided below for context. Do not copy from it.',
    '',
    'FORMAT -- exact structure required:',
    'Produce four labeled sections. Each section header must appear on its own line exactly as shown:',
    '',
    'HOOK:',
    '<one short line that makes sense and pulls the reader in before IG truncates with "...more">',
    '',
    'PARAGRAPHS:',
    '<2-3 short paragraphs of prose, separated by single blank lines>',
    '',
    'CTA:',
    '<one or two short lines, IG-native: DM, comment, link in bio, save for later. No "swipe up.">',
    '',
    'HASHTAGS:',
    '<10-15 hashtags, each starting with #, separated by spaces, one line>',
    '',
    'LENGTH:',
    'Target total prose (HOOK + PARAGRAPHS + CTA, excluding hashtags) at 100-180 words.',
    '',
    'HOOK CONSTRAINT (critical):',
    'The HOOK line must be 125 characters or fewer including spaces. IG truncates with "...more" around that point on mobile; if the hook lands after the cutoff, the post fails. Count carefully.',
    '',
    'HASHTAG RULES:',
    '- 10-15 hashtags total. No more, no fewer.',
    '- Each starts with # and contains no spaces inside.',
    '- No duplicates.',
    '- Mix broad real estate tags with Toronto-specific tags.',
    '- Single line, space-separated.',
    '',
    'WRITTEN FOR THE EYE (not the ear, unlike the Reel script):',
    '- IG captions are read, not heard. Sentences can be slightly longer than the script\'s.',
    '- Short paragraphs (2-4 sentences each).',
    '- No em-dashes or en-dashes. Use commas or periods.',
    '- No semicolons.',
    '- No "navigating," "landscape," "journey," "in conclusion," "it\'s important to note," "let me explain." These are AI tells.',
    '- No tri-colon listicles.',
    '',
    'CONSTRAINTS:',
    '- Every factual claim must trace to a dataPoint in the source angle. Do not introduce historical comparisons, neutral-range claims, easing-cycle framing, or context not present in the angle.',
    '- Do not attribute quotes to real people.',
    '- Hard exclusions:',
    `  Terms: ${forbiddenTermsList}`,
    `  Topics: ${forbiddenTopicsList}`,
    '',
    'OUTPUT FORMAT:',
    'Return ONLY the four labeled sections in plain text. No preamble. No JSON. No code fences. Begin with "HOOK:" on the first line.',
  ].join('\n');

  const dpLines = angle.dataPoints.map(dp => {
    const asOf = dp.asOf ? dp.asOf.slice(0, 10) : '';
    return `- ${dp.metric} (as of ${asOf})`;
  }).join('\n');

  const user = [
    'Source angle:',
    '',
    `Headline: ${angle.headline}`,
    `Thesis: ${angle.thesis}`,
    `Theme: ${angle.themeTag || ''}`,
    `Audience focus: ${angle.audienceFocus || ''}`,
    '',
    'Data points referenced:',
    dpLines,
    '',
    'Source footer (for thematic reference, do not include in caption):',
    angle.sourceFooter,
    '',
    'Reel script (for thematic alignment, do not copy):',
    reelScript,
    '',
    'Write the Instagram caption.',
  ].join('\n');

  return { system, user };
}

// ── parseSections ─────────────────────────────────────────────────────────────

const IG_SECTION_HEADERS = [
  { key: 'hook',       pattern: /^hook\s*:$/i },
  { key: 'paragraphs', pattern: /^paragraphs\s*:$/i },
  { key: 'cta',        pattern: /^cta\s*:$/i },
  { key: 'hashtags',   pattern: /^hashtags\s*:$/i },
];

function parseSections(rawText) {
  const lines = rawText.split('\n');
  const buffers = { hook: [], paragraphs: [], cta: [], hashtags: [] };
  let currentKey = null;

  for (const line of lines) {
    const stripped = line.trimEnd();
    const normalized = stripped.trim();
    let matched = false;
    for (const { key, pattern } of IG_SECTION_HEADERS) {
      if (pattern.test(normalized)) {
        currentKey = key;
        matched = true;
        break;
      }
    }
    if (!matched && currentKey !== null) {
      buffers[currentKey].push(stripped);
    }
  }

  const hook = buffers.hook.join('\n').trim();

  const rawParaText = buffers.paragraphs.join('\n');
  const paragraphs = rawParaText
    .split(/\n\s*\n/)
    .map(p => p.trim())
    .filter(p => p.length > 0);

  const cta = buffers.cta.join('\n').trim();

  const hashtagsRaw = buffers.hashtags.join(' ');
  const hashtags = hashtagsRaw
    .split(/\s+/)
    .map(h => h.trim())
    .filter(h => h.length > 0);

  if (!hook) return null;
  if (paragraphs.length === 0) return null;
  if (!cta) return null;
  if (hashtags.length === 0) return null;

  return { hook, paragraphs, cta, hashtags };
}

// ── validateInstagramCaption ──────────────────────────────────────────────────

function countWords(text) {
  return text.trim().split(/\s+/).filter(w => w.length > 0).length;
}

function validateInstagramCaption(sections, { angle: _angle, contentProfile }) {
  const errors = [];

  if (!sections.hook || sections.hook.trim() === '') {
    errors.push('hook is empty');
  }
  if (!Array.isArray(sections.paragraphs) || sections.paragraphs.length < 2) {
    errors.push(`paragraphs count ${sections.paragraphs ? sections.paragraphs.length : 0} is below minimum 2`);
  }
  if (Array.isArray(sections.paragraphs) && sections.paragraphs.length > 3) {
    errors.push(`paragraphs count ${sections.paragraphs.length} exceeds maximum 3`);
  }
  if (!sections.cta || sections.cta.trim() === '') {
    errors.push('cta is empty');
  }

  const hashtagCount = Array.isArray(sections.hashtags) ? sections.hashtags.length : 0;
  if (hashtagCount < 10) {
    errors.push(`hashtags count ${hashtagCount} is below minimum 10`);
  } else if (hashtagCount > 15) {
    errors.push(`hashtags count ${hashtagCount} exceeds maximum 15`);
  }

  if (sections.hook) {
    if (sections.hook.length > 125) {
      errors.push(`hook length ${sections.hook.length} exceeds 125 characters`);
    }
    if (sections.hook.includes('\n')) {
      errors.push('hook must not contain newline characters');
    }
  }

  if (Array.isArray(sections.hashtags)) {
    const lowerSeen = new Set();
    for (const tag of sections.hashtags) {
      if (!tag.startsWith('#')) {
        errors.push(`hashtag does not start with #: "${tag}"`);
      }
      if (/\s/.test(tag)) {
        errors.push(`hashtag contains whitespace: "${tag}"`);
      }
      if (tag.length < 2) {
        errors.push(`hashtag too short: "${tag}"`);
      }
      const lower = tag.toLowerCase();
      if (lowerSeen.has(lower)) {
        errors.push(`duplicate hashtag: "${lower}"`);
      } else {
        lowerSeen.add(lower);
      }
    }
  }

  const proseText = [
    sections.hook || '',
    Array.isArray(sections.paragraphs) ? sections.paragraphs.join(' ') : '',
    sections.cta || '',
  ].join(' ');
  const totalWords = countWords(proseText);
  if (totalWords < 80) {
    errors.push(`prose word count ${totalWords} is below minimum 80`);
  }
  if (totalWords > 220) {
    errors.push(`prose word count ${totalWords} exceeds maximum 220`);
  }

  const assembledForDashCheck = [
    sections.hook || '',
    Array.isArray(sections.paragraphs) ? sections.paragraphs.join('\n') : '',
    sections.cta || '',
  ].join('\n');
  if (/[—–]/.test(assembledForDashCheck)) {
    errors.push('caption contains em-dash or en-dash');
  }

  const proseAssembledLower = proseText.toLowerCase();
  for (const term of (contentProfile.forbiddenTerms || [])) {
    if (proseAssembledLower.includes(term.toLowerCase())) {
      errors.push(`forbidden term found: "${term}"`);
    }
  }
  for (const topic of (contentProfile.forbiddenTopics || [])) {
    if (proseAssembledLower.includes(topic.toLowerCase())) {
      errors.push(`forbidden topic found: "${topic}"`);
    }
  }

  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}

// ── assembleSections ──────────────────────────────────────────────────────────

function assembleSections(sections) {
  const parts = [sections.hook];

  for (const para of sections.paragraphs) {
    parts.push('');
    parts.push(para);
  }

  parts.push('');
  parts.push(sections.cta);
  parts.push('');
  parts.push(sections.hashtags.join(' '));

  return parts.join('\n');
}

// ── renderInstagramCaption ────────────────────────────────────────────────────

async function renderInstagramCaption({ angle, contentProfile, reelScript, opts = {} }) {
  validateInputs({ angle, contentProfile, reelScript });

  const { system, user } = buildInstagramCaptionPrompt({ angle, contentProfile, reelScript });
  const callRawFn = opts.callRaw != null ? opts.callRaw : claude.callRaw;
  const maxTokens = opts.maxTokens != null ? opts.maxTokens : 1500;

  async function attempt() {
    const raw = await callRawFn({ system, user, model: MODELS.SONNET, maxTokens });
    const cleaned = stripDashes(raw);
    const sections = parseSections(cleaned);
    if (!sections) {
      return { sections: null, parseError: true, validationErrors: null };
    }
    const result = validateInstagramCaption(sections, { angle, contentProfile });
    if (!result.valid) {
      return { sections: null, parseError: false, validationErrors: result.errors };
    }
    return { sections, parseError: false, validationErrors: null };
  }

  let result = await attempt();

  if (!result.sections) {
    result = await attempt();
  }

  if (!result.sections) {
    const errOpts = {};
    if (result.parseError) {
      errOpts.cause = new Error('Response could not be parsed into required sections');
    }
    if (result.validationErrors) {
      errOpts.validationErrors = result.validationErrors;
    }
    throw new InstagramCaptionGenerationError(
      'Instagram caption generation failed after 2 attempts',
      errOpts
    );
  }

  const text = assembleSections(result.sections);

  return {
    text,
    sections: result.sections,
    model: MODELS.SONNET,
    generatedAt: new Date().toISOString(),
  };
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  renderInstagramCaption,
  InstagramCaptionGenerationError,
  _internal: {
    buildInstagramCaptionPrompt,
    validateInstagramCaption,
    parseSections,
    assembleSections,
  },
};
