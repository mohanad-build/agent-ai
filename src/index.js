// Entry point for the Reply Detection automation.
// Orchestrates the full pipeline: fetches unread reply emails from Gmail,
// passes each through Claude for categorization, then routes to the appropriate
// action handler (log to Sheet, send SMS via Twilio, flag for review, etc.)
// based on the returned category:
//   answer_general | answer_property_specific | hot_signal | stop_signal | needs_review
