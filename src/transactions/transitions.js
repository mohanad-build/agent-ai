'use strict';

const store  = require('./store');
const states = require('./states');
const events = require('./events');

function transitionTransaction(agentId, transactionId, toState, opts = {}) {
  // items here is an ARRAY of fully annotated resolver output (id, label,
  // applicability, completed, ...), passed in transiently by the caller for
  // buildCloseOutstandingPayload. It is NOT the `items` map items.js reads
  // and writes on the transaction record (id -> {completed, completedAt,
  // documents, note}). Same name, different shape, no converter exists.
  const { at, actor, items, baseDir, now } = opts;

  const previous = store.readTransaction(agentId, transactionId, { baseDir });
  if (previous === null) {
    throw new Error(`transitionTransaction: no transaction ${transactionId} for agent ${agentId}`);
  }

  const check = states.canTransition(previous.type, previous.state, toState);
  if (!check.valid) {
    return { valid: false, reason: check.reason };
  }

  let patch = { state: toState };

  if (toState === 'closed' && items !== undefined) {
    const payload = events.buildCloseOutstandingPayload(items);
    if (payload.outstandingCount > 0) {
      const event = events.makeEvent({
        at,
        actor,
        kind: 'closed_with_items_outstanding',
        payload,
      });
      patch = { ...patch, events: events.appendEvent(previous.events, event) };
    }
  }

  const next = { ...previous, ...patch };
  const written = store.writeTransaction(agentId, next, { baseDir, now });

  return { valid: true, transaction: written };
}

module.exports = { transitionTransaction };
