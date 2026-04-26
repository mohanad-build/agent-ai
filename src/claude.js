// Handles all interactions with the Anthropic Claude API.
// Exports a classifyReply(emailText, agentConfig) function that passes both
// the email body and the loaded agent config to the prompt builder, then sends
// the resulting prompt to Claude. The agentConfig scopes Claude's behavior to
// the correct agent identity, tone, and safety rules at runtime.
// Returns one of the five structured categories:
// answer_general, answer_property_specific, hot_signal, stop_signal, needs_review.
