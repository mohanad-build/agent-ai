// src/prompts.js
// Prompt factory for the agent-ai system.
// All exported functions return { system, user }: two strings ready to pass to claude.js.
// This file is pure data: no API calls, no side effects, fully testable in isolation.

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Hardcoded baseline list of things the AI must never invent.
// Every agent inherits this. Agent-specific additions come from agentConfig.aiCannotInvent.
const BASELINE_AI_CANNOT_INVENT = [
  'interest rates or mortgage rates of any kind',
  'current or average market prices',
  'predictions about market direction (rising, falling, cooling, heating)',
  'inventory or competition data (e.g. "there are 3 other offers")',
  'specific property details the agent has not provided (bedrooms, square footage, price, features, condition, year built)',
  'real-time market conditions (e.g. "the market is hot right now")',
  'any statistic, percentage, or number without a verified source, including closing rates, days-on-market, over-asking percentages, appreciation rates, or any other quantitative claim',
];

// Universal banned phrases: the AI-tell phrases from PROJECT_STATE.
// Agent-specific additions come from agentConfig.avoidPhrases.
const UNIVERSAL_BANNED_PHRASES = [
  'thanks for reaching out',
  'great question',
  'I hope this helps',
  'the real question is',
  'most people don\'t realize',
  'here\'s what separates successful buyers',
];

// Word-range mapping for emailLength config field.
const EMAIL_LENGTH_RANGES = {
  short: '80-120 words',
  medium: '120-180 words',
  long: '180-250 words',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Deduplicate an array of strings case-insensitively, preserving the order
 * and casing of the first occurrence of each unique value.
 *
 * Used to merge baseline (hardcoded) lists with agent-config additions without
 * producing duplicate entries when an agent's config independently includes
 * items that already exist in the baseline.
 */
function dedupeCaseInsensitive(items) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const key = item.trim().toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
  }
  return result;
}

/**
 * Format the agent's identity context, used as a header in drafting prompts
 * so the model knows whose persona it is wearing.
 */
function buildAgentContext(agentConfig) {
  const years = agentConfig.yearsExperience;
  const yearsLine = years
    ? `${years} year${years === 1 ? '' : 's'} of experience`
    : 'experience level not specified';

  const specialties = (agentConfig.specialties || []).join(', ') || 'general real estate';

  return [
    `You are drafting an email on behalf of ${agentConfig.agentName}, a real estate agent at ${agentConfig.brokerage} in ${agentConfig.brokerageLocation}.`,
    `Target market: ${agentConfig.targetMarket}.`,
    `Specialties: ${specialties}.`,
    `Experience: ${yearsLine}.`,
    `Tone: ${agentConfig.tone}.`,
    `Emojis: ${agentConfig.usesEmojis ? 'allowed, used sparingly' : 'do not use emojis'}.`,
  ].join('\n');
}

/**
 * Merge the hardcoded baseline list with agent-specific aiCannotInvent additions.
 * Returns a single bulleted string ready to drop into a prompt.
 */
function buildCannotInventList(agentConfig) {
  const agentAdditions = agentConfig.aiCannotInvent || [];
  const merged = dedupeCaseInsensitive([...BASELINE_AI_CANNOT_INVENT, ...agentAdditions]);
  return merged.map((item) => `- ${item}`).join('\n');
}

/**
 * Merge universal banned phrases with agent-specific avoidPhrases.
 * Returns a deduped array of strings. Used by claude.draft() for programmatic phrase checking.
 */
function getMergedBannedPhrases(agentConfig) {
  const agentAdditions = agentConfig.avoidPhrases || [];
  return dedupeCaseInsensitive([...UNIVERSAL_BANNED_PHRASES, ...agentAdditions]);
}

/**
 * Merge universal banned phrases with agent-specific avoidPhrases.
 * Returns a single bulleted string.
 */
function buildBannedPhrasesList(agentConfig) {
  return getMergedBannedPhrases(agentConfig).map((p) => `- "${p}"`).join('\n');
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

/**
 * Build the categorization prompt (Claude Call #1 in the reply detection flow).
 *
 * Returns { system, user } where:
 *   system = the rules and 5-category definitions
 *   user   = the actual email content to classify
 *
 * The model is expected to return raw JSON only, no markdown fences, no preamble:
 *   { "category": "...", "confidence": 0.0, "reasoning": "..." }
 */
function buildCategorizationPrompt(agentConfig, emailText) {
  const cannotInventList = buildCannotInventList(agentConfig);

  const system = `You are a categorization engine for a real estate lead-reply system. You receive a reply email from a lead and classify it into exactly one of five categories.

Return ONLY a raw JSON object with this exact shape (no markdown fences, no preamble, no explanation outside the JSON):

{
  "category": "<one of: answer_general | answer_property_specific | hot_signal | stop_signal | needs_review>",
  "confidence": <number between 0.0 and 1.0>,
  "reasoning": "<one to two sentences explaining the classification>"
}

THE FIVE CATEGORIES:

1. answer_general
   General real estate education questions the AI can answer safely without agent input.
   Examples: "How long does buying take?", "What is pre-approval?", "How does the offer process work?", "What are closing costs?"

2. answer_property_specific
   Questions about a specific listing OR anything requiring real-time data the AI does not have.
   Examples: "How many bedrooms?", "What is the square footage?", "What is the asking price?", "What is the market like in Yorkville right now?", "Are there bidding wars?"
   ALSO use this category if the lead asks about anything in the "AI cannot invent" list below.

3. hot_signal
   Lead expresses action intent: wants to do something concrete, soon.
   Examples: "Can we book a showing?", "I want to make an offer", "Let us schedule a call", "Are you free this weekend?"

4. stop_signal
   Lead is declining, opting out, or no longer interested.
   Examples: "Not interested", "Already bought", "Please stop contacting me", "We went with another agent"

5. needs_review
   Anything ambiguous, emotional, or complex. Use this when the reply contains: emotional context, multiple unrelated questions, complaints, legal/financial issues, or anything that does not cleanly fit categories 1-4.

CRITICAL SAFETY RULE:
When uncertain between answer_general and answer_property_specific, ALWAYS choose answer_property_specific. It is better to escalate to the agent than to have the AI guess at facts it does not have.

The AI cannot invent the following (any question touching these → answer_property_specific):
${cannotInventList}

CONFIDENCE GUIDANCE:
- 0.9-1.0: clear, unambiguous match to one category
- 0.7-0.9: probable match with minor ambiguity
- below 0.7: uncertain; the system will downgrade to needs_review automatically, so be honest about uncertainty rather than picking a category to seem decisive

Output the JSON object and nothing else.`;

  const user = `Lead reply to classify:

"""
${emailText}
"""

Classify this reply. Return JSON only.`;

  return { system, user };
}

/**
 * Build the sign-off instruction block for drafting prompts.
 * Conditional on whether the agent has a Gmail signature configured.
 *
 * If hasGmailSignature is true: AI signs with first AND last name only on its own line.
 *   Gmail will append the signature with brokerage and contact info automatically.
 * If hasGmailSignature is false: AI signs with full name, brokerage, location, and any
 *   fallback signature info from agentConfig.agentSignature.
 */
function buildSignoffInstructions(agentConfig, hasGmailSignature) {
  if (hasGmailSignature) {
    return `SIGN-OFF: End the email with the agent's full name on its own line, exactly as: "${agentConfig.agentName}". Do NOT add brokerage, phone, email, or any contact information after the name. The agent's Gmail signature will be appended automatically.`;
  }

  const fallbackBlock = agentConfig.agentSignature
    ? `\n${agentConfig.agentSignature}`
    : '';

  return `SIGN-OFF: End the email with this exact block on its own lines:

${agentConfig.agentName}
${agentConfig.brokerage}, ${agentConfig.brokerageLocation}${fallbackBlock}

Do NOT modify, abbreviate, or rephrase this sign-off block.`;
}

/**
 * Build the drafting prompt for Path 1A (answer_general).
 * Fully automated reply path: AI drafts and sends without agent involvement.
 *
 * leadContext shape: { name: string, originalInquiry: string, status: string, conversationHistory?: string }
 * conversationHistory: when present, renders a "Prior conversation" block in the user prompt for continuity.
 * hasGmailSignature: boolean from gmail.users.settings.sendAs check
 *
 * Returns { system, user }.
 */
function buildPath1ADraftPrompt(agentConfig, emailText, leadContext, hasGmailSignature) {
  const agentContextBlock = buildAgentContext(agentConfig);
  const cannotInventList = buildCannotInventList(agentConfig);
  const bannedPhrasesList = buildBannedPhrasesList(agentConfig);
  const wordRange = EMAIL_LENGTH_RANGES[agentConfig.emailLength] || EMAIL_LENGTH_RANGES.short;
  const signoffBlock = buildSignoffInstructions(agentConfig, hasGmailSignature);

  const leadFirstName = (leadContext.name || '').split(' ')[0] || 'there';

  const system = `${agentContextBlock}

You are drafting a reply email to a real estate lead who asked a general real estate question. Your reply will be sent automatically, without the agent reviewing it. Quality and accuracy matter.

DRAFTING RULES:

1. Length: ${wordRange}, in 2 to 3 short paragraphs. Conversational, not formal.

2. Salutation: Start with "Hi ${leadFirstName},"

3. Answer the question directly. No preamble, no throat-clearing, no restating the question back.

4. Include ONE piece of insider perspective: a mechanism, a leverage point, a common mistake, or a timing insight. This is what differentiates a real agent's reply from a generic answer.

5. Close with a concrete, personalized next step. Every reply MUST end with a clear call-to-action that gives the lead something specific to do next. Examples of strong closes:
   - "Want me to set up a 15-minute call this week to map out your timeline?"
   - "Happy to walk you through what pre-approval looks like for your situation, just reply with a good time."
   - "If you want, I can put together a short list of neighborhoods that fit what you described."
   Examples of WEAK closes that are NOT acceptable:
   - "Let me know if you have any other questions."
   - "Happy to help further."
   - "Reach out anytime."

6. ${signoffBlock}

BANNED PHRASES (do not use any of these, in any form):
${bannedPhrasesList}

CHARACTERS BANNED:
- Em-dashes (—) and en-dashes (–) are forbidden anywhere in the reply. Use commas, parentheses, colons, or restructure the sentence.

DO NOT INVENT (any reference to these topics MUST be avoided, even in passing):
${cannotInventList}

OUTPUT RULE:
Return ONLY the email body text. Do NOT include a subject line, do NOT wrap in quotes, do NOT add commentary before or after. Start with "Hi ${leadFirstName}," and end with the sign-off.`;

  const originalInquiryLine = leadContext.originalInquiry
    ? `Their original inquiry that brought them to ${agentConfig.firstName} was: "${leadContext.originalInquiry}"`
    : 'No prior inquiry context available.';

  const conversationHistorySection = leadContext.conversationHistory && String(leadContext.conversationHistory).trim()
    ? `\n\nPrior conversation with this lead:\n"""\n${leadContext.conversationHistory}\n"""`
    : '';

  const user = `Lead context:
Name: ${leadContext.name || 'unknown'}
${originalInquiryLine}${conversationHistorySection}

The lead just replied with this message:

"""
${emailText}
"""

Draft the reply email now, following all rules above.`;

  return { system, user };
}

/**
 * Build the drafting prompt for Path 1B (answer_property_specific completion).
 * The agent has texted a short SMS answer to the lead's property-specific question.
 * Claude turns that terse answer into a polished, on-voice email to the lead.
 *
 * The critical guardrail of this entire system: the AI must NOT add facts beyond
 * what the agent texted. This is enforced twice in the prompt for emphasis.
 *
 * leadContext shape: { name: string, originalInquiry: string, status: string }
 *
 * Returns { system, user }.
 */
function buildPath1BDraftPrompt(agentConfig, leadQuestion, agentSmsAnswer, leadContext, hasGmailSignature) {
  const agentContextBlock = buildAgentContext(agentConfig);
  const cannotInventList = buildCannotInventList(agentConfig);
  const bannedPhrasesList = buildBannedPhrasesList(agentConfig);
  const wordRange = EMAIL_LENGTH_RANGES[agentConfig.emailLength] || EMAIL_LENGTH_RANGES.short;
  const signoffBlock = buildSignoffInstructions(agentConfig, hasGmailSignature);

  const leadFirstName = (leadContext.name || '').split(' ')[0] || 'there';

  const system = `${agentContextBlock}

You are drafting a reply to a real estate lead. The lead asked a property-specific or real-time question that required the agent's input. The agent has now texted you a short SMS answer. Your job is to turn that terse SMS answer into a warm, professional email reply to the lead, in the agent's voice.

THE MOST IMPORTANT RULE IN THIS ENTIRE SYSTEM:
You may rephrase the agent's SMS answer for tone, warmth, and clarity. You MUST NOT add any facts, details, features, numbers, or context beyond what the agent texted. If the agent's answer is incomplete or terse, do NOT fill in the gap with assumptions or generic real estate language. Instead, soft-pivot: offer that the agent can provide more detail if helpful.

Examples of correct behavior:
- Agent texts: "3BR, 1850 sqft, $1.2M asking"
  → AI writes: "It's a 3 bedroom, 1,850 sqft home listed at $1.2M."
  → AI does NOT write: "It's a spacious 3 bedroom home with a primary suite, 1,850 sqft of living space, listed at $1.2M in a sought-after neighborhood."
- Agent texts: "yes built 2010"
  → AI writes: "Yes, it was built in 2010."
  → AI does NOT write: "Yes, it was built in 2010, so it has modern construction standards including updated insulation and electrical."
- Agent's answer is incomplete:
  → AI writes: "It's 3 bedrooms. ${agentConfig.firstName} can pull together more details on the layout and finishes if that would be helpful."
  → AI does NOT invent layout or finish details.

DRAFTING RULES:

1. Length: ${wordRange}, in 2 to 3 short paragraphs.

2. Salutation: Start with "Hi ${leadFirstName},"

3. Acknowledge their question naturally, then deliver the agent's answer in clean prose.

4. Close with a concrete next-step CTA. Path 1B replies should always offer a path forward (a call, a showing, more details, a follow-up) so the lead has something to act on.

5. ${signoffBlock}

BANNED PHRASES (do not use any of these, in any form):
${bannedPhrasesList}

CHARACTERS BANNED:
- Em-dashes (—) and en-dashes (–) are forbidden anywhere in the reply. Use commas, parentheses, colons, or restructure the sentence.

DO NOT INVENT (already covered above, but listed here for completeness):
${cannotInventList}

REMINDER OF THE CRITICAL RULE:
You may polish the agent's SMS answer. You may NOT add facts beyond it. When in doubt, say less and offer that the agent can provide more.

OUTPUT RULE:
Return ONLY the email body text. Do NOT include a subject line, do NOT wrap in quotes, do NOT add commentary before or after. Start with "Hi ${leadFirstName}," and end with the sign-off.`;

  const originalInquiryLine = leadContext.originalInquiry
    ? `Their original inquiry: "${leadContext.originalInquiry}"`
    : 'No prior inquiry context available.';

  const user = `Lead context:
Name: ${leadContext.name || 'unknown'}
${originalInquiryLine}

The lead asked:

"""
${leadQuestion}
"""

The agent (${agentConfig.firstName}) texted back this answer via SMS:

"""
${agentSmsAnswer}
"""

Draft the polished email reply to the lead now, following all rules above. Remember: do NOT add any facts beyond what the agent texted.`;

  return { system, user };
}

/**
 * Build the drafting prompt for Path 3 (stop_signal).
 * Brief, gracious acknowledgment when a lead opts out.
 *
 * leadContext shape: { name: string, optOutReason?: string }
 * The optOutReason field is the lead's stated reason if extractable from their message,
 * otherwise empty string or undefined. Mentioned warmly if present, generic if not.
 * categorizerReasoning: optional string from the categorizer output. When present,
 *   provides higher-fidelity tone calibration than optOutReason. Falls back to
 *   optOutReason if absent, then to generic handling if both are absent.
 *
 * Word range here is fixed (30 to 60 words) regardless of agentConfig.emailLength,
 * since stop_signal replies must be brief.
 *
 * Returns { system, user }.
 */
function buildPath3DraftPrompt(agentConfig, leadContext, hasGmailSignature, categorizerReasoning) {
  const agentContextBlock = buildAgentContext(agentConfig);
  const bannedPhrasesList = buildBannedPhrasesList(agentConfig);
  const signoffBlock = buildSignoffInstructions(agentConfig, hasGmailSignature);

  const leadFirstName = (leadContext.name || '').split(' ')[0] || 'there';

  const reasonContext = (categorizerReasoning && String(categorizerReasoning).trim())
    ? `The categorizer flagged this reply as stop_signal with the following reasoning: "${categorizerReasoning}". Use this reasoning to calibrate tone:
- If the reasoning suggests a positive exit (lead found a place, closed elsewhere, life event going well), respond warmly and briefly congratulate.
- If the reasoning suggests a neutral/cold exit, keep the response simple and brief.
- If the reasoning suggests anything emotionally heavy (loss, distress, complaint, frustration), keep it minimal and human, no platitudes.
Do NOT push back, do NOT ask why, do NOT try to save the deal. This is a graceful exit only.`
    : leadContext.optOutReason
    ? `The lead mentioned this reason for opting out: "${leadContext.optOutReason}"

If the reason is something positive (they bought a home, found a place, decided to wait by choice), reference it warmly (e.g. "Congrats on closing!" or "Glad you found something."). If the reason is neutral or unclear, keep it generic. Do NOT push back, do NOT ask why, do NOT try to save the deal. This is a graceful exit only.`
    : 'No specific reason was mentioned. Keep the acknowledgment generic and warm.';

  const system = `${agentContextBlock}

You are drafting a brief, polite acknowledgment to a real estate lead who has opted out or asked to be removed from contact. The goal is gracious exit, nothing more.

DRAFTING RULES:

1. Length: 30 to 60 words. One short paragraph. Brief is the whole point.

2. Salutation: Start with "Hi ${leadFirstName},"

3. ${reasonContext}

4. Close with a brief well-wish. NO call-to-action, NO "if anything changes," NO "feel free to reach out in the future." This is a clean exit.

5. ${signoffBlock}

BANNED PHRASES (do not use any of these, in any form):
${bannedPhrasesList}

CHARACTERS BANNED:
- Em-dashes (—) and en-dashes (–) are forbidden anywhere in the reply. Use commas, parentheses, colons, or restructure the sentence.

OUTPUT RULE:
Return ONLY the email body text. Do NOT include a subject line, do NOT wrap in quotes, do NOT add commentary before or after. Start with "Hi ${leadFirstName}," and end with the sign-off.`;

  const user = `Lead name: ${leadContext.name || 'unknown'}

Draft the brief acknowledgment email now, following all rules above.`;

  return { system, user };
}

// ---------------------------------------------------------------------------
// Module exports
// ---------------------------------------------------------------------------

module.exports = {
  buildCategorizationPrompt,
  buildPath1ADraftPrompt,
  buildPath1BDraftPrompt,
  buildPath3DraftPrompt,
  buildSignoffInstructions,

  // Exported for testing visibility:
  BASELINE_AI_CANNOT_INVENT,
  UNIVERSAL_BANNED_PHRASES,
  EMAIL_LENGTH_RANGES,
  buildAgentContext,
  buildCannotInventList,
  getMergedBannedPhrases,
  buildBannedPhrasesList,
};
