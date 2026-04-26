// Stores and exports prompt templates used with the Claude API.
// The main export is buildClassificationPrompt(agentConfig, emailText) — a
// function that constructs the system + user prompt by injecting values from
// the agentConfig object (name, brokerage, tone, neverDiscuss, etc.) as
// template variables. No agent identity is hardcoded here.
// Returns a structured JSON response with the category (one of:
// answer_general, answer_property_specific, hot_signal, stop_signal,
// needs_review) and a brief rationale.
