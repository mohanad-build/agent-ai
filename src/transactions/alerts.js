'use strict';

// Pure rules for the daily brief's TC alert section: one deal plus today and
// now in, a list of alert objects out. No disk, no rendering, no sending.
//
// Stateless by design: an alert fires whenever its day count matches, so it
// fires once per threshold with no "already alerted" record to maintain or
// let drift out of sync with the deal. The Monday picture (a later commit)
// is the backstop for a brief that was missed.
//
// The dated rules (conditions, deposits) compare calendar dates with
// calendarDate.daysBetween, because a condition date or an accepted date is
// a day named in an agreement, not an instant. filing_failed instead
// compares instants against a 24h window ending at now: a filing abandoned
// at 3pm has no calendar date of its own to count days against, and tying
// it to the calendar day would mean it never reaches the next morning's
// brief if it was abandoned a few hours earlier the same day.
//
// today is never computed here: the caller passes it, already resolved with
// calendarDate.todayInTimeZone in the agent's own timezone, so the
// evening-rollover behaviour lives in exactly one place.

const checklist = require('./checklist');
const states = require('./states');
const { CONDITION_CLEARING_ITEMS } = require('./rules/conditions');
const deposit = require('./rules/deposit');
const { daysBetween, isCalendarDate } = require('../calendarDate');

// How many days before a condition date condition_heads_up fires.
const HEADS_UP_DAYS_BEFORE = 2;
// How many days after a condition date condition_passed fires.
const CONDITION_PASSED_DAYS_AFTER = Object.freeze([1, 4]);
// How many days after the governing date deposit_overdue and additional_deposit_overdue fire.
const DEPOSIT_OVERDUE_DAYS_AFTER = Object.freeze([2, 7]);
// How far back from now a document_filing_abandoned event still counts as recent.
const FILING_WINDOW_MS = 24 * 60 * 60 * 1000;

const HOLDING_DEPOSIT_CHAIN = deposit.chainEndingAt('brokerage_deposit_receipt_issued');
const PAYING_DEPOSIT_CHAIN = deposit.chainEndingAt('brokerage_deposit_receipt_received');
const HOLDING_ADDITIONAL_DEPOSIT_ID = deposit.chainEndingAt('additional_deposit_receipt_issued')[0];
const PAYING_ADDITIONAL_DEPOSIT_ID = deposit.chainEndingAt('additional_deposit_receipt_received')[0];

function findResolvedItem(resolvedItems, itemId) {
  return resolvedItems.find((item) => item.id === itemId);
}

// A row is "open" when it exists on this deal, resolves required, and is
// not completed.
function isRowOpen(resolvedItems, itemId) {
  const item = findResolvedItem(resolvedItems, itemId);
  return item !== undefined && item.applicability === 'required' && item.completed !== true;
}

function isRowCompleted(resolvedItems, itemId) {
  const item = findResolvedItem(resolvedItems, itemId);
  return item !== undefined && item.completed === true;
}

function alertBase(transaction, kind) {
  const alert = { kind, transactionId: transaction.transactionId, address: transaction.address };
  if (Object.prototype.hasOwnProperty.call(transaction, 'unit')) {
    alert.unit = transaction.unit;
  }
  return alert;
}

function conditionAlerts(transaction, facts, resolvedItems, today) {
  const conditionNames = facts.conditions || [];
  const conditionDates = facts.conditionDates || {};
  const alerts = [];

  conditionNames.forEach((condition) => {
    const date = conditionDates[condition];
    if (date === undefined) {
      return;
    }

    const itemId = CONDITION_CLEARING_ITEMS[condition];
    if (!isRowOpen(resolvedItems, itemId)) {
      return;
    }

    const daysUntil = daysBetween(today, date);
    if (daysUntil === HEADS_UP_DAYS_BEFORE) {
      alerts.push({ ...alertBase(transaction, 'condition_heads_up'), condition, itemId, date, daysUntil });
      return;
    }

    const daysPast = daysBetween(date, today);
    if (CONDITION_PASSED_DAYS_AFTER.includes(daysPast)) {
      alerts.push({ ...alertBase(transaction, 'condition_passed'), condition, itemId, date, daysPast });
    }
  });

  return alerts;
}

function depositOverdueAlert(transaction, facts, resolvedItems, today, chain) {
  const receiptId = chain[chain.length - 1];
  if (!isRowOpen(resolvedItems, receiptId)) {
    return null;
  }

  const date = facts.acceptedDate;
  if (date === undefined) {
    return null;
  }

  const daysPast = daysBetween(date, today);
  if (!DEPOSIT_OVERDUE_DAYS_AFTER.includes(daysPast)) {
    return null;
  }

  const stuckAt = chain.find((itemId) => !isRowCompleted(resolvedItems, itemId));

  return { ...alertBase(transaction, 'deposit_overdue'), itemId: receiptId, stuckAt, date, daysPast };
}

function additionalDepositOverdueAlert(transaction, facts, resolvedItems, today, itemId) {
  if (!isRowOpen(resolvedItems, itemId)) {
    return null;
  }

  const dueDates = facts.additionalDepositDueDates;
  if (!Array.isArray(dueDates) || dueDates.length === 0) {
    return null;
  }

  const date = dueDates[0];
  const daysPast = daysBetween(date, today);
  if (!DEPOSIT_OVERDUE_DAYS_AFTER.includes(daysPast)) {
    return null;
  }

  return { ...alertBase(transaction, 'additional_deposit_overdue'), itemId, date, daysPast };
}

function filingAlerts(transaction, now) {
  const events = transaction.events || [];
  const filings = transaction.filings || {};
  const nowMs = now.getTime();
  const alerts = [];

  events.forEach((event) => {
    if (event.kind !== 'document_filing_abandoned') {
      return;
    }

    const atMs = new Date(event.at).getTime();
    if (!(atMs > nowMs - FILING_WINDOW_MS && atMs <= nowMs)) {
      return;
    }

    const filingKey = event.payload.key;
    const record = filings[filingKey];

    alerts.push({
      ...alertBase(transaction, 'filing_failed'),
      filingKey,
      filename: record ? record.filename : event.payload.filename,
      threadId: record ? record.threadId : null,
      abandonedAt: event.at,
      lastError: record ? record.lastError : event.payload.lastError,
    });
  });

  return alerts;
}

function alertsForTransaction(transaction, { today, now }) {
  if (!isCalendarDate(today)) {
    throw new Error('alertsForTransaction: today must be a calendar date (YYYY-MM-DD)');
  }
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new Error('alertsForTransaction: now must be a valid Date');
  }

  if (states.isTerminal(transaction.type, transaction.state)) {
    return [];
  }

  const facts = transaction.facts || {};
  const resolvedItems = checklist.resolveChecklistForTransaction(transaction);

  const alerts = [];

  alerts.push(...conditionAlerts(transaction, facts, resolvedItems, today));

  const holdingDeposit = depositOverdueAlert(transaction, facts, resolvedItems, today, HOLDING_DEPOSIT_CHAIN);
  if (holdingDeposit) alerts.push(holdingDeposit);
  const payingDeposit = depositOverdueAlert(transaction, facts, resolvedItems, today, PAYING_DEPOSIT_CHAIN);
  if (payingDeposit) alerts.push(payingDeposit);

  const holdingAdditional = additionalDepositOverdueAlert(transaction, facts, resolvedItems, today, HOLDING_ADDITIONAL_DEPOSIT_ID);
  if (holdingAdditional) alerts.push(holdingAdditional);
  const payingAdditional = additionalDepositOverdueAlert(transaction, facts, resolvedItems, today, PAYING_ADDITIONAL_DEPOSIT_ID);
  if (payingAdditional) alerts.push(payingAdditional);

  alerts.push(...filingAlerts(transaction, now));

  return alerts;
}

module.exports = { alertsForTransaction };
