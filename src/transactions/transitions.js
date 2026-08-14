'use strict';

const store     = require('./store');
const states    = require('./states');
const events    = require('./events');
const checklist = require('./checklist');

function transitionTransaction(agentId, transactionId, toState, opts = {}) {
  const { at, actor, baseDir, now } = opts;

  const previous = store.readTransaction(agentId, transactionId, { baseDir });
  if (previous === null) {
    throw new Error(`transitionTransaction: no transaction ${transactionId} for agent ${agentId}`);
  }

  const check = states.canTransition(previous.type, previous.state, toState);
  if (!check.valid) {
    return { valid: false, reason: check.reason };
  }

  let patch = { state: toState };

  if (toState === 'closed') {
    const resolvedItems = checklist.resolveChecklistForTransaction(previous);
    const payload = events.buildCloseOutstandingPayload(resolvedItems);
    if (payload.outstandingCount > 0 || payload.indeterminateCount > 0) {
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
