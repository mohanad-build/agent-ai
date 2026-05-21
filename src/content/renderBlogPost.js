'use strict';

const claude = require('../claude');

const { MODELS, stripDashes } = claude;

// ── Constants ─────────────────────────────────────────────────────────────────

const { RATE_DISCLAIMER_BLOCK } = require('./_shared');

// ── Error class ───────────────────────────────────────────────────────────────

class BlogPostGenerationError extends Error {
  constructor(message, { cause, validationErrors } = {}) {
    super(message);
    this.name = 'BlogPostGenerationError';
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
  if (typeof angle.sourceFooter !== 'string' || angle.sourceFooter.trim() === '') {
    throw new TypeError('angle.sourceFooter must be a non-empty string');
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

// ── buildBlogPostPrompt ───────────────────────────────────────────────────────

function buildBlogPostPrompt({ angle, contentProfile }) {
  const forbiddenTermsList = contentProfile.forbiddenTerms.join(', ');
  const forbiddenTopicsList = contentProfile.forbiddenTopics.join(', ');

  const system = [
    'You are a real estate blog writer producing 600-800 word posts for a Canadian real estate agent. The post will be published on the agent\'s blog or newsletter (Substack, Beehiiv, WordPress, Ghost). It is informed by the agent\'s voice but written as publishable long-form prose, not a transcript.',
    '',
    'VOICE:',
    'The agent\'s voice descriptor informs tone, register, and recurring framings. It does NOT dictate sentence cadence -- write as a blog post, not a transcript. Avoid spoken-cadence patterns: very short sentence fragments, repeated paragraph openers, asides written as if speaking (\'look,\' \'here\'s the thing,\'), or one-line standalone paragraphs that work only when read aloud.',
    '',
    contentProfile.voiceDescriptor,
    '',
    'FORMAT -- exact Markdown structure required:',
    '',
    '# <Title -- sentence case, max 80 chars; write the most natural, content-driven headline for the post>',
    '',
    '<Hook paragraph -- pulls reader in, no cliches, no AI tells>',
    '',
    '## <H2 heading 1>',
    '',
    '<2-3 paragraphs>',
    '',
    '## <H2 heading 2>',
    '',
    '<2-3 paragraphs>',
    '',
    '## <H2 heading 3: what this means for you>',
    '',
    '<takeaways for buyers/sellers, ends with CTA>',
    '',
    '---',
    '',
    '**Sources:**',
    '- [Source Name](URL) — as of YYYY-MM-DD',
    '- [Source Name](URL) — as of YYYY-MM-DD',
    '',
    'META: <metaDescription, MUST be 100-160 characters total; Google truncates at 160, so >160 gets cut off; count characters before returning>',
    'KEYWORD: <targetKeyword phrase, 2-4 words; the SEO topic this post targets; does NOT need to appear in the title>',
    '',
    'LENGTH:',
    'Target 600-800 body words counted across all prose: hook paragraph plus H2 section paragraphs. Title, H2 headings, sources block, and META/KEYWORD lines are not counted.',
    '',
    'H2 STRUCTURE:',
    '2 to 4 H2 sections (target 3). Each H2 has 1-3 paragraphs.',
    '',
    'WRITTEN FOR THE READER (not the ear, unlike the Reel):',
    '- Full sentences, comfortable cadence.',
    '- No semicolons.',
    '- No em-dashes or en-dashes anywhere. No double-hyphen `--` substitute either (renders as en-dash on Substack, Beehiiv, Ghost, WordPress). Use commas or periods only.',
    '- At least one Markdown link in the body to a primary source for a major stat (inline citation, e.g., `the [Bank of Canada\'s overnight rate](https://www.bankofcanada.ca/...)`).',
    '- No tri-colon listicles ("X, Y, Z all matter").',
    '- Banned phrases: "in conclusion", "it\'s important to note that", "it\'s worth noting", "navigating the market", "navigating the [anything] market" (pattern), "in today\'s market", "ever-changing", "ever-evolving".',
    '',
    'CITATIONS:',
    '- Inline: prose attribution for flow, plus at least one Markdown link per major stat.',
    '- Sources block (bottom): full attribution. Format each entry as: `- [Source Name](URL) — as of YYYY-MM-DD`.',
    '- At least 1 sources entry required.',
    '',
    'CONSTRAINTS:',
    '- Every factual claim traces to a dataPoint in the source angle.',
    '- The thesis is ground truth -- restate in agent\'s voice, do not rewrite.',
    '- Do not attribute quotes to real people.',
    `- Hard exclusions -- Terms: ${forbiddenTermsList}; Topics: ${forbiddenTopicsList}`,
    '',
    'META DESCRIPTION + TARGET KEYWORD:',
    '- Meta description: 140-160 chars, summarizes the post for SERP/preview.',
    '- Target keyword: short phrase (2-5 words) the title and body should naturally support.',
    '',
    'OUTPUT FORMAT:',
    'Return ONLY the Markdown document followed by the META and KEYWORD lines. No preamble. No JSON. No code fences. Begin with `# ` on the first line.',
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
    'Source footer (use verbatim in the SOURCES block):',
    angle.sourceFooter,
    '',
    'Write the blog post.',
  ].join('\n');

  return { system, user };
}

// ── parseSections ─────────────────────────────────────────────────────────────

function parseSections(rawText) {
  const lines = rawText.split('\n');

  // Find title: first line starting with '# '
  let titleIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trimEnd().startsWith('# ')) {
      titleIdx = i;
      break;
    }
  }
  if (titleIdx === -1) return null;

  const title = lines[titleIdx].trimEnd().replace(/^#\s+/, '').trim();
  if (!title) return null;

  let i = titleIdx + 1;

  // Collect hook lines: everything before the first '## ' or '---'
  const hookLines = [];
  while (i < lines.length) {
    const trimmed = lines[i].trimEnd();
    if (/^##\s/.test(trimmed) || trimmed.trim() === '---') break;
    hookLines.push(trimmed);
    i++;
  }

  const hook = hookLines.join('\n').trim();
  if (!hook) return null;

  // Parse body sections: each '## ' block until '---'
  const body = [];
  while (i < lines.length) {
    const trimmed = lines[i].trimEnd();
    if (trimmed.trim() === '---') break;
    if (/^##\s/.test(trimmed)) {
      const heading = trimmed.replace(/^##\s+/, '').trim();
      i++;
      const paragraphLines = [];
      while (i < lines.length) {
        const next = lines[i].trimEnd();
        if (/^##\s/.test(next) || next.trim() === '---') break;
        paragraphLines.push(next);
        i++;
      }
      const paragraphs = paragraphLines
        .join('\n')
        .split(/\n\s*\n/)
        .map(p => p.trim())
        .filter(p => p.length > 0);
      body.push({ heading, paragraphs });
    } else {
      i++;
    }
  }

  if (body.length === 0) return null;
  if (i >= lines.length || lines[i].trim() !== '---') return null;

  // Parse after '---'
  const afterSep = lines.slice(i + 1);

  // Find '**Sources:**' (case-insensitive)
  let sourcesIdx = -1;
  for (let j = 0; j < afterSep.length; j++) {
    if (/^\*\*sources:\*\*\s*$/i.test(afterSep[j].trim())) {
      sourcesIdx = j;
      break;
    }
  }
  if (sourcesIdx === -1) return null;

  // Parse source entries: - [Name](URL) -- as of YYYY-MM-DD
  const sources = [];
  for (let j = sourcesIdx + 1; j < afterSep.length; j++) {
    const line = afterSep[j].trim();
    if (!line) continue;
    if (/^(meta|keyword)\s*:/i.test(line)) break;
    const m = line.match(/^-\s*\[([^\]]+)\]\(([^)]+)\)\s*(?:--|—|–)\s*as\s+of\s+(.+)$/i);
    if (m) {
      sources.push({ name: m[1].trim(), url: m[2].trim(), asOfDate: m[3].trim() });
    }
  }
  if (sources.length === 0) return null;

  // Parse META and KEYWORD (anywhere after ---)
  let metaDescription = null;
  let targetKeyword = null;
  for (const line of afterSep) {
    const trimmed = line.trim();
    const metaMatch = trimmed.match(/^meta\s*:\s*(.+)$/i);
    if (metaMatch) metaDescription = metaMatch[1].trim();
    const kwMatch = trimmed.match(/^keyword\s*:\s*(.+)$/i);
    if (kwMatch) targetKeyword = kwMatch[1].trim();
  }

  if (!metaDescription) return null;
  if (!targetKeyword) return null;

  return { title, hook, body, sources, metaDescription, targetKeyword };
}

// ── validateBlogPost ──────────────────────────────────────────────────────────

function countWords(text) {
  return text.trim().split(/\s+/).filter(w => w.length > 0).length;
}

const BANNED_PHRASES = [
  'in conclusion',
  "it's important to note that",
  "it's worth noting",
  'navigating the market',
  "in today's market",
  'ever-changing',
  'ever-evolving',
];

const BANNED_REGEX = /navigating the [a-z]+ market/i;

function validateBlogPost(sections, { angle, contentProfile }) {
  const errors = [];

  const allBodyParagraphs = sections.body.flatMap(s => s.paragraphs);

  // 1. Word count: hook + all body paragraphs, 550-850 inclusive
  const proseText = [sections.hook, ...allBodyParagraphs].join(' ');
  const wc = countWords(proseText);
  if (wc < 550) errors.push(`body prose word count ${wc} is below minimum 550`);
  if (wc > 850) errors.push(`body prose word count ${wc} exceeds maximum 850`);

  const assembled = [
    sections.hook || '',
    ...allBodyParagraphs,
  ].join('\n');

  // 2. No em-dash (U+2014)
  if (/—/.test(assembled)) errors.push('post contains em-dash');

  // 3. No en-dash (U+2013)
  if (/–/.test(assembled)) errors.push('post contains en-dash');

  // 4. No double-hyphen (renders as en-dash on Substack, Beehiiv, Ghost, WordPress)
  if (/--/.test(assembled)) errors.push('post contains double-hyphen (renders as en-dash on common platforms)');

  const lowerAssembled = assembled.toLowerCase();

  // 4. No forbidden terms
  for (const term of (contentProfile.forbiddenTerms || [])) {
    if (lowerAssembled.includes(term.toLowerCase())) {
      errors.push(`forbidden term found: "${term}"`);
    }
  }

  // 5. No forbidden topics
  for (const topic of (contentProfile.forbiddenTopics || [])) {
    if (lowerAssembled.includes(topic.toLowerCase())) {
      errors.push(`forbidden topic found: "${topic}"`);
    }
  }

  // 6. No banned AI-tell phrases
  for (const phrase of BANNED_PHRASES) {
    if (lowerAssembled.includes(phrase.toLowerCase())) {
      errors.push(`banned phrase found: "${phrase}"`);
    }
  }
  if (BANNED_REGEX.test(assembled)) {
    errors.push('banned phrase pattern found: "navigating the [x] market"');
  }

  // 7. Body section count: 2-4 inclusive
  if (sections.body.length < 2) {
    errors.push(`body section count ${sections.body.length} is below minimum 2`);
  }
  if (sections.body.length > 4) {
    errors.push(`body section count ${sections.body.length} exceeds maximum 4`);
  }

  // 8. At least one Markdown link in body prose
  if (!/\[[^\]]+\]\(https?:\/\/[^)]+\)/.test(assembled)) {
    errors.push('body contains no Markdown link');
  }

  // 9. Sources block: at least 1 entry, each parseable
  if (!Array.isArray(sections.sources) || sections.sources.length === 0) {
    errors.push('sources block is empty');
  } else {
    for (const src of sections.sources) {
      if (!src.name || !src.url || !src.asOfDate) {
        errors.push('source entry missing name, url, or asOfDate');
      }
    }
  }

  // 10. Title: non-empty, <=80 chars (Unicode-safe)
  if (!sections.title || sections.title.trim() === '') {
    errors.push('title is empty');
  } else {
    if ([...sections.title].length > 80) {
      errors.push(`title length ${[...sections.title].length} exceeds 80 characters`);
    }
  }

  // 11. Meta description: 140-160 chars inclusive
  if (!sections.metaDescription || sections.metaDescription.trim() === '') {
    errors.push('metaDescription is empty');
  } else {
    const mdLen = sections.metaDescription.length;
    if (mdLen < 100) errors.push(`metaDescription length ${mdLen} is below minimum 100`);
    if (mdLen > 160) errors.push(`metaDescription length ${mdLen} exceeds maximum 160`);
  }

  // 12. Target keyword: non-empty
  if (!sections.targetKeyword || sections.targetKeyword.trim() === '') {
    errors.push('targetKeyword is empty');
  }

  // 13. Rate disclaimer present when forbidsRateAdvice is true
  if (angle && angle.forbidsRateAdvice === true) {
    const finalText = assembleSections(sections, { forbidsRateAdvice: true });
    if (!finalText.includes(RATE_DISCLAIMER_BLOCK)) {
      errors.push('rate disclaimer block missing when forbidsRateAdvice is true');
    }
  }

  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}

// ── assembleSections ──────────────────────────────────────────────────────────

function assembleSections(sections, { forbidsRateAdvice }) {
  const parts = [
    `# ${sections.title}`,
    '',
    sections.hook,
    '',
  ];

  for (const section of sections.body) {
    parts.push(`## ${section.heading}`);
    parts.push('');
    parts.push(section.paragraphs.join('\n\n'));
    parts.push('');
  }

  if (forbidsRateAdvice === true) {
    parts.push(RATE_DISCLAIMER_BLOCK);
    parts.push('');
  }

  parts.push('---');
  parts.push('');
  parts.push('**Sources:**');
  for (const src of sections.sources) {
    parts.push(`- [${src.name}](${src.url}) — as of ${src.asOfDate}`);
  }

  return parts.join('\n');
}

// ── renderBlogPost ────────────────────────────────────────────────────────────

async function renderBlogPost({ angle, contentProfile, opts = {} }) {
  validateInputs({ angle, contentProfile });

  const { system, user } = buildBlogPostPrompt({ angle, contentProfile });
  const callRawFn = opts.callRaw != null ? opts.callRaw : claude.callRaw;
  const maxTokens = opts.maxTokens != null ? opts.maxTokens : 3000;

  async function attempt() {
    const raw = await callRawFn({ system, user, model: MODELS.SONNET, maxTokens });
    const cleaned = stripDashes(raw);
    const sections = parseSections(cleaned);
    if (!sections) {
      return { sections: null, parseError: true, validationErrors: null };
    }
    const result = validateBlogPost(sections, { angle, contentProfile });
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
    throw new BlogPostGenerationError(
      'Blog post generation failed after 2 attempts',
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
  renderBlogPost,
  BlogPostGenerationError,
  _internal: {
    buildBlogPostPrompt,
    validateBlogPost,
    assembleSections,
    parseSections,
  },
};
