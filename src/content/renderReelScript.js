'use strict';

const claude = require('../claude');

const { MODELS, stripDashes } = claude;

// ── Constants ─────────────────────────────────────────────────────────────────

const { RATE_DISCLAIMER_BLOCK } = require('./_shared');

// ── Error class ───────────────────────────────────────────────────────────────

class ReelScriptGenerationError extends Error {
  constructor(message, { cause, validationErrors } = {}) {
    super(message);
    this.name = 'ReelScriptGenerationError';
    if (cause) this.cause = cause;
    if (validationErrors) this.validationErrors = validationErrors;
  }
}

// ── Input validation ──────────────────────────────────────────────────────────

function validateInputs({ angle, contentProfile }) {
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
  if (angle.sourceFooter !== null) {
    if (typeof angle.sourceFooter !== 'string' || angle.sourceFooter.trim() === '') {
      throw new TypeError('angle.sourceFooter must be a non-empty string or null');
    }
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
}

// ── buildReelScriptPrompt ─────────────────────────────────────────────────────

function buildReelScriptPrompt({ angle, contentProfile }) {
  const forbiddenTermsList = contentProfile.forbiddenTerms.join(', ');
  const forbiddenTopicsList = contentProfile.forbiddenTopics.join(', ');
  const hasSource = angle.sourceFooter !== null;

  const system = [
    'You are a professional video script writer producing 60-90 second talking-head Reels for a Canadian real estate agent. The script will be filmed on a phone in vertical format. The agent reads it aloud while looking at the camera.',
    '',
    'VOICE -- non-negotiable:',
    'The agent\'s voice descriptor is the load-bearing context for this script. It dominates any generic "reel script" tone. If the voice descriptor and the source angle\'s tone conflict, voice descriptor wins. Do not soften the agent\'s distinctive voice toward neutral.',
    '',
    contentProfile.voiceDescriptor,
    '',
    'FORMAT -- exact structure required:',
    'Produce a script with five labeled sections. Each section header must appear on its own line exactly as shown:',
    '',
    'HOOK (0-5s):',
    '<one short line, written for the ear, must work without context>',
    '',
    'BODY (5s-60s):',
    '<BODY is the evidence layer for the HOOK. Sentence one must introduce new information that proves the hook — a specific number, a contrast, a fact the viewer did not know. Do NOT restate the hook. Do NOT open with preamble like "here is something you may not realize" or "what most people don\'t see."',
    'After sentence one, develop in three beats: what happened, why it matters for the viewer, what to do about it.',
    'Conversational, second person, short sentences.>',
    '',
    'CTA (60-75s):',
    '<one or two short lines, the agent\'s signature next-step ask>',
    '',
    'B-ROLL SUGGESTIONS:',
    '- <suggestion 1>',
    '- <suggestion 2>',
    '',
    ...(hasSource ? ['SOURCES:', '<source footer verbatim from the input angle>', ''] : []),
    'LENGTH:',
    'Target the BODY section at 110-200 words for natural delivery at conversational pace. Hook is one line. CTA is one or two short lines. B-roll is 2-3 bullet suggestions. Tight beats long. If you find yourself padding to hit the word floor, the angle is thinner than 110 words and the script should land closer to the floor.',
    '',
    'WRITTEN FOR THE EAR:',
    '- No semicolons. Use periods.',
    '- No em-dashes or en-dashes anywhere. Use commas or periods.',
    '- Short sentences. Read the script aloud in your head as you write each line.',
    '- No tri-colon listicles ("X, Y, Z all matter"). Pick one and develop it.',
    '- No "navigating," "landscape," "journey," "in conclusion," "it\'s important to note." These read as AI tells when spoken.',
    '',
    'CONSTRAINTS:',
    '- Every factual claim must trace to a dataPoint in the source angle. Do not introduce historical comparisons, neutral-range claims, easing-cycle framing, or other context not present in the angle.',
    '- The thesis of the angle is your ground truth. Restate it in the agent\'s voice; do not rewrite it.',
    '- Do not attribute quotes to real people (bank economists, journalists, analysts).',
    '- Hard exclusions -- never use these terms or topics in the script:',
    `  Terms: ${forbiddenTermsList}`,
    `  Topics: ${forbiddenTopicsList}`,
    '',
    'OUTPUT FORMAT:',
    'Return ONLY the five labeled sections in plain text. No preamble. No JSON. No code fences. No explanation. Begin with "HOOK (0-5s):" on the first line.',
  ].join('\n');

  const dpLines = angle.dataPoints.map(dp => {
    const asOf = dp.asOf ? dp.asOf.slice(0, 10) : '';
    return `- ${dp.metric} (as of ${asOf})`;
  }).join('\n');

  const bestSuitedFor = Array.isArray(angle.bestSuitedFor)
    ? angle.bestSuitedFor.join(', ')
    : '';

  const user = [
    'Source angle:',
    '',
    `Headline: ${angle.headline}`,
    `Thesis: ${angle.thesis}`,
    `Theme: ${angle.themeTag || ''}`,
    `Audience focus: ${angle.audienceFocus || ''}`,
    `Best suited for: ${bestSuitedFor}`,
    '',
    'Data points referenced:',
    dpLines,
    '',
    ...(hasSource ? ['Source footer (use verbatim in the SOURCES section):', angle.sourceFooter, ''] : []),
    'Write the Reel script.',
  ].join('\n');

  return { system, user };
}

// ── parseSections ─────────────────────────────────────────────────────────────

const SECTION_HEADERS = [
  { key: 'hook',    pattern: /^hook\s*\(0-5s\)\s*:$/i },
  { key: 'body',    pattern: /^body\s*\(5s-60s\)\s*:$/i },
  { key: 'cta',     pattern: /^cta\s*\(60-75s\)\s*:$/i },
  { key: 'bRoll',   pattern: /^b-roll suggestions\s*:$/i },
  { key: 'sources', pattern: /^sources\s*:$/i },
];

function parseSections(rawText, hasSource = true) {
  const lines = rawText.split('\n');
  const buffers = { hook: [], body: [], cta: [], bRoll: [], sources: [] };
  let currentKey = null;

  for (const line of lines) {
    const stripped = line.trimEnd();
    const normalized = stripped.trim();
    let matched = false;
    for (const { key, pattern } of SECTION_HEADERS) {
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

  const sections = {};

  for (const key of ['hook', 'body', 'cta', 'sources']) {
    sections[key] = buffers[key].join('\n').trim();
  }

  const bRollEntries = buffers.bRoll
    .map(l => l.trim())
    .filter(l => l.startsWith('-'))
    .map(l => l.replace(/^-\s*/, '').trim())
    .filter(l => l.length > 0);

  sections.bRoll = bRollEntries;

  for (const key of ['hook', 'body', 'cta', ...(hasSource ? ['sources'] : [])]) {
    if (!sections[key] || sections[key] === '') return null;
  }
  if (sections.bRoll.length === 0) return null;

  return sections;
}

// ── validateReelScript ────────────────────────────────────────────────────────

function countWords(text) {
  return text.trim().split(/\s+/).filter(w => w.length > 0).length;
}

function validateReelScript(sections, { angle, contentProfile }) {
  const errors = [];
  const hasSource = angle.sourceFooter !== null;

  if (!sections.hook || sections.hook.trim() === '') errors.push('hook is empty');
  if (!sections.body || sections.body.trim() === '') errors.push('body is empty');
  if (!sections.cta  || sections.cta.trim()  === '') errors.push('cta is empty');
  if (hasSource && (!sections.sources || sections.sources.trim() === '')) errors.push('sources is empty');
  if (!Array.isArray(sections.bRoll) || sections.bRoll.length === 0) {
    errors.push('bRoll must have at least 1 entry');
  }

  if (sections.body && sections.body.trim() !== '') {
    const wc = countWords(sections.body);
    if (wc < 90)  errors.push(`body word count ${wc} is below minimum 90`);
    if (wc > 240) errors.push(`body word count ${wc} exceeds maximum 240`);
  }

  const assembled = [
    sections.hook    || '',
    sections.body    || '',
    sections.cta     || '',
    (sections.bRoll  || []).join(' '),
    sections.sources || '',
  ].join('\n');

  // Check for em-dash (U+2014) and en-dash (U+2013)
  if (/[—–]/.test(assembled)) {
    errors.push('script contains em-dash or en-dash');
  }

  const lowerAssembled = assembled.toLowerCase();

  for (const term of (contentProfile.forbiddenTerms || [])) {
    if (lowerAssembled.includes(term.toLowerCase())) {
      errors.push(`forbidden term found: "${term}"`);
    }
  }

  for (const topic of (contentProfile.forbiddenTopics || [])) {
    if (lowerAssembled.includes(topic.toLowerCase())) {
      errors.push(`forbidden topic found: "${topic}"`);
    }
  }

  if (hasSource && sections.sources) {
    if (!sections.sources.includes(angle.sourceFooter)) {
      errors.push('SOURCES section does not contain angle.sourceFooter verbatim');
    }
  }

  if (sections.hook && sections.hook.trim().includes('\n')) {
    errors.push('hook must be a single line');
  }

  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}

// ── assembleSections ──────────────────────────────────────────────────────────

function assembleSections(sections, { forbidsRateAdvice }) {
  const bRollLines = (sections.bRoll || []).map(entry => `- ${entry}`).join('\n');

  const parts = [
    'HOOK (0-5s):',
    sections.hook,
    '',
    'BODY (5s-60s):',
    sections.body,
    '',
    'CTA (60-75s):',
    sections.cta,
    '',
    'B-ROLL SUGGESTIONS:',
    bRollLines,
    '',
    'SOURCES:',
    sections.sources,
  ];

  let text = parts.join('\n');

  if (forbidsRateAdvice === true) {
    text += '\n\n' + RATE_DISCLAIMER_BLOCK;
  }

  return text;
}

// ── renderReelScript ──────────────────────────────────────────────────────────

async function renderReelScript({ angle, contentProfile, opts = {} }) {
  validateInputs({ angle, contentProfile });

  const { system, user } = buildReelScriptPrompt({ angle, contentProfile });
  const callRawFn = opts.callRaw != null ? opts.callRaw : claude.callRaw;
  const maxTokens = opts.maxTokens != null ? opts.maxTokens : 1500;

  async function attempt() {
    const raw = await callRawFn({ system, user, model: MODELS.SONNET, maxTokens });
    const cleaned = stripDashes(raw);
    const hasSource = angle.sourceFooter !== null;
    const sections = parseSections(cleaned, hasSource);
    if (!sections) {
      return { sections: null, parseError: true, validationErrors: null };
    }
    const result = validateReelScript(sections, { angle, contentProfile });
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
    throw new ReelScriptGenerationError(
      'Reel script generation failed after 2 attempts',
      errOpts
    );
  }

  const text = assembleSections(result.sections, { forbidsRateAdvice: angle.forbidsRateAdvice });

  return {
    text,
    sections: result.sections,
    model: MODELS.SONNET,
    generatedAt: new Date().toISOString(),
  };
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  renderReelScript,
  ReelScriptGenerationError,
  _internal: {
    buildReelScriptPrompt,
    validateReelScript,
    assembleSections,
    parseSections,
  },
};
