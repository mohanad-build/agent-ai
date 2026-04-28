// src/email.js
//
// Provider-agnostic email dispatcher. Every email and Sheet operation
// the rest of the system performs goes through this file. Internally,
// each function looks at agentConfig.provider and delegates to the
// appropriate provider implementation (gmail.js today, outlook.js future).
//
// Why this layer exists:
//   - Adding Outlook support later means writing outlook.js and adding one
//     branch per function here. No caller in the orchestrator changes.
//   - Centralized place to log/trace email operations, regardless of provider.
//   - Single seam for testing: mock email.js to unit-test the orchestrator
//     without touching real Gmail.
//
// Why this layer is THIN:
//   - All actual logic (auth, retries, rate handling, MIME building, Sheet
//     A1-notation, etc.) lives in the provider implementation. This file is
//     just a switch statement. If you find yourself adding logic here,
//     it probably belongs in gmail.js.

const gmail = require('./gmail');

/**
 * Resolve the provider implementation module for an agent.
 * Defaults to 'gmail' if not set (matches schema default).
 * Throws on unknown providers so we never silently no-op.
 */
function getProvider(agentConfig) {
  const provider = agentConfig.provider || 'gmail';
  switch (provider) {
    case 'gmail':
      return gmail;
    // case 'outlook':
    //   return require('./outlook');  // future
    default:
      throw new Error(
        `Unknown email provider "${provider}" for agent "${agentConfig.agentId}". ` +
        `Supported: 'gmail'.`
      );
  }
}

// ---------------------------------------------------------------------------
// Email read operations
// ---------------------------------------------------------------------------

async function fetchUnreadReplies(agentConfig) {
  return getProvider(agentConfig).fetchUnreadReplies(agentConfig);
}

async function getMessage(agentConfig, messageId) {
  return getProvider(agentConfig).getMessage(agentConfig, messageId);
}

async function getThreadHistory(agentConfig, threadId) {
  return getProvider(agentConfig).getThreadHistory(agentConfig, threadId);
}

async function searchEmails(agentConfig, query) {
  return getProvider(agentConfig).searchEmails(agentConfig, query);
}

// ---------------------------------------------------------------------------
// Email write operations
// ---------------------------------------------------------------------------

async function sendReply(agentConfig, options) {
  return getProvider(agentConfig).sendReply(agentConfig, options);
}

async function sendNewEmail(agentConfig, options) {
  return getProvider(agentConfig).sendNewEmail(agentConfig, options);
}

async function markRead(agentConfig, messageId) {
  return getProvider(agentConfig).markRead(agentConfig, messageId);
}

async function getSignaturePresence(agentConfig) {
  return getProvider(agentConfig).getSignaturePresence(agentConfig);
}

// ---------------------------------------------------------------------------
// Sheet operations
// ---------------------------------------------------------------------------

async function readSheetRows(agentConfig) {
  return getProvider(agentConfig).readSheetRows(agentConfig);
}

async function updateSheetRow(agentConfig, rowIndex, updates) {
  return getProvider(agentConfig).updateSheetRow(agentConfig, rowIndex, updates);
}

async function appendSheetRow(agentConfig, rowData) {
  return getProvider(agentConfig).appendSheetRow(agentConfig, rowData);
}

async function appendToConversationHistory(agentConfig, rowIndex, entry) {
  return getProvider(agentConfig).appendToConversationHistory(agentConfig, rowIndex, entry);
}

module.exports = {
  fetchUnreadReplies,
  getMessage,
  getThreadHistory,
  searchEmails,
  sendReply,
  sendNewEmail,
  markRead,
  getSignaturePresence,
  readSheetRows,
  updateSheetRow,
  appendSheetRow,
  appendToConversationHistory,
};
