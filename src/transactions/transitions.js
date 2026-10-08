'use strict';

const store     = require('./store');
const states    = require('./states');
const events    = require('./events');
const checklist = require('./checklist');

function transitionTransaction(agentId, transactionId, toState, opts = {}) {
  const { at, actor, baseDir, now, reason } = opts;

  if (typeof at !== 'string' || at.trim() === '') {
    throw new Error('transitionTransaction: at is required');
  }
  if (typeof actor !== 'string' || actor.trim() === '') {
    throw new Error('transitionTransaction: actor is required');
  }

  const previous = store.readTransaction(agentId, transactionId, { baseDir });
  if (previous === null) {
    throw new Error(`transitionTransaction: no transaction ${transactionId} for agent ${agentId}`);
  }

  const check = states.canTransition(previous.type, previous.state, toState);
  if (!check.valid) {
    return { valid: false, reason: check.reason };
  }

  const fromState = previous.state;
  let patch = { state: toState };
  let outgoingEvents = previous.events;

  if (toState === 'closed') {
    const resolvedItems = checklist.resolveChecklistForTransaction(previous);
    const payload = events.buildCloseOutstandingPayload(resolvedItems);
    if (payload.outstandingCount > 0 || payload.indeterminateCount > 0) {
      const closeEvent = events.makeEvent({
        at,
        actor,
        kind: 'closed_with_items_outstanding',
        payload,
      });
      outgoingEvents = events.appendEvent(outgoingEvents, closeEvent);
    }
  }

  const transitionEvent = events.makeEvent({
    at,
    actor,
    kind: 'state_transitioned',
    payload: { fromState, toState, reason: reason === undefined ? null : reason },
  });
  outgoingEvents = events.appendEvent(outgoingEvents, transitionEvent);
  patch = { ...patch, events: outgoingEvents };

  const next = { ...previous, ...patch };
  const written = store.writeTransaction(agentId, next, { baseDir, now });

  return { valid: true, transaction: written };
}

module.exports = { transitionTransaction };
