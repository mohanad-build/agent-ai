'use strict';

// Pure rules for the daily brief's TC alert section: one deal plus today and
// now in, a list of alert objects out. No disk, no rendering, no sending.
//
// The deposit and condition-passed rules fire on the first brief on or
// after each threshold, once: a threshold has passed once today's day count
// is at or past it (>=, not ===), and it only produces an alert if its own
// delivery key is still missing from delivered, the per-transaction map the
// caller passes in (recordDeliveredDealAlerts, commit 2). A deal opened
// late, or a brief that was missed on the exact day, still gets the alert
// on the next brief that runs, because the key is still undelivered. When
// several thresholds have passed and neither has been delivered, they
// collapse into one alert carrying the real day count and every undelivered
// key, never one row per threshold. Heads-ups and filing_failed stay
// exact-window (a day-before/day-of count, a 24h instant window) and never
// consult delivered; their deliveryKeys is always empty, so nothing about
// them is ever recorded. The Monday picture remains the backstop for a
// brief that was missed entirely.
//
// deposit_receipt_closing (session 95) is also heads-up style, keyed on
// closingDate rather than acceptedDate: once inside RECEIPT_BEFORE_CLOSING_DAYS
// of closing, it fires every morning, before and after the date, until the
// receipt is recorded or the deal goes terminal. While it is live for a
// chain, the acceptance-based deposit_overdue for that same chain is never
// computed into a pushed alert at all -- the collapse, not a suppression
// flag -- so its own delivery keys are never looked at, never recorded.
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

// Days before a condition date condition_heads_up fires: the day before and the day of.
const CONDITION_HEADS_UP_DAYS_BEFORE = Object.freeze([1, 0]);
// How many days after a condition date condition_passed fires.
const CONDITION_PASSED_DAYS_AFTER = Object.freeze([1, 4]);
// How many days after the governing date deposit_overdue and additional_deposit_overdue fire.
const DEPOSIT_OVERDUE_DAYS_AFTER = Object.freeze([2, 7]);
// How many days before closingDate deposit_receipt_closing starts firing. Heads-up
// style, not threshold style: once inside this window it fires every morning, with
// no upper bound on the far side -- it keeps firing after closing has passed too,
// until the receipt is recorded or the deal reaches a terminal state.
const RECEIPT_BEFORE_CLOSING_DAYS = 7;
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

// Every threshold at or before daysPast has "passed" (>=, not ===), so a
// deal that sails past several thresholds between briefs is not missed.
// delivered is keyed by the full delivery key (kind:governingDate:threshold),
// not the threshold alone, so an amended governing date starts the keys
// fresh: the old date's keys are simply never looked up again.
function passedThresholds(thresholds, daysPast) {
  return thresholds.filter((t) => daysPast >= t);
}

function undeliveredKeys(keys, delivered) {
  return keys.filter((key) => delivered[key] === undefined);
}

function conditionAlerts(transaction, facts, resolvedItems, today, delivered) {
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
    if (CONDITION_HEADS_UP_DAYS_BEFORE.includes(daysUntil)) {
      alerts.push({ ...alertBase(transaction, 'condition_heads_up'), condition, itemId, date, daysUntil, deliveryKeys: [] });
      return;
    }

    const daysPast = daysBetween(date, today);
    const passed = passedThresholds(CONDITION_PASSED_DAYS_AFTER, daysPast);
    if (passed.length === 0) {
      return;
    }

    const deliveryKeys = undeliveredKeys(passed.map((t) => `condition_passed:${condition}:${date}:${t}`), delivered);
    if (deliveryKeys.length === 0) {
      return;
    }

    alerts.push({ ...alertBase(transaction, 'condition_passed'), condition, itemId, date, daysPast, deliveryKeys });
  });

  return alerts;
}

function depositOverdueAlert(transaction, facts, resolvedItems, today, chain, delivered) {
  const receiptId = chain[chain.length - 1];
  if (!isRowOpen(resolvedItems, receiptId)) {
    return null;
  }

  const date = facts.acceptedDate;
  if (date === undefined) {
    return null;
  }

  const daysPast = daysBetween(date, today);
  const passed = passedThresholds(DEPOSIT_OVERDUE_DAYS_AFTER, daysPast);
  if (passed.length === 0) {
    return null;
  }

  const deliveryKeys = undeliveredKeys(passed.map((t) => `deposit_overdue:${date}:${t}`), delivered);
  if (deliveryKeys.length === 0) {
    return null;
  }

  const stuckAt = chain.find((itemId) => !isRowCompleted(resolvedItems, itemId));

  return { ...alertBase(transaction, 'deposit_overdue'), itemId: receiptId, stuckAt, date, daysPast, deliveryKeys };
}

// Heads-up style like conditionAlerts' condition_heads_up branch: no
// delivered check, no deliveryKeys, fires fresh every qualifying morning.
// daysUntilClosing is signed (daysBetween(today, closingDate)): positive
// while closing is ahead, 0 on closing day, negative once it has passed.
// Only an upper bound gates it (the window has not opened yet); there is no
// lower bound, so once inside the window it keeps firing after closing has
// passed too, until the receipt is recorded (isRowOpen false) or the deal
// reaches a terminal state (the caller's own top-of-function guard).
function depositReceiptClosingAlert(transaction, facts, resolvedItems, today, chain) {
  const receiptId = chain[chain.length - 1];
  if (!isRowOpen(resolvedItems, receiptId)) {
    return null;
  }

  const date = facts.closingDate;
  if (date === undefined) {
    return null;
  }

  const daysUntilClosing = daysBetween(today, date);
  if (daysUntilClosing > RECEIPT_BEFORE_CLOSING_DAYS) {
    return null;
  }

  const stuckAt = chain.find((itemId) => !isRowCompleted(resolvedItems, itemId));

  return { ...alertBase(transaction, 'deposit_receipt_closing'), itemId: receiptId, stuckAt, date, daysUntilClosing, deliveryKeys: [] };
}

function additionalDepositOverdueAlert(transaction, facts, resolvedItems, today, itemId, delivered) {
  if (!isRowOpen(resolvedItems, itemId)) {
    return null;
  }

  const dueDates = facts.additionalDepositDueDates;
  if (!Array.isArray(dueDates) || dueDates.length === 0) {
    return null;
  }

  const date = dueDates[0];
  const daysPast = daysBetween(date, today);
  const passed = passedThresholds(DEPOSIT_OVERDUE_DAYS_AFTER, daysPast);
  if (passed.length === 0) {
    return null;
  }

  const deliveryKeys = undeliveredKeys(passed.map((t) => `additional_deposit_overdue:${date}:${t}`), delivered);
  if (deliveryKeys.length === 0) {
    return null;
  }

  return { ...alertBase(transaction, 'additional_deposit_overdue'), itemId, date, daysPast, deliveryKeys };
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
      deliveryKeys: [],
    });
  });

  return alerts;
}

function alertsForTransaction(transaction, { today, now, delivered }) {
  if (!isCalendarDate(today)) {
    throw new Error('alertsForTransaction: today must be a calendar date (YYYY-MM-DD)');
  }
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new Error('alertsForTransaction: now must be a valid Date');
  }
  if (delivered === null || typeof delivered !== 'object' || Array.isArray(delivered)) {
    throw new Error('alertsForTransaction: delivered must be a plain object');
  }

  if (states.isTerminal(transaction.type, transaction.state)) {
    return [];
  }

  const facts = transaction.facts || {};
  const resolvedItems = checklist.resolveChecklistForTransaction(transaction);

  const alerts = [];

  alerts.push(...conditionAlerts(transaction, facts, resolvedItems, today, delivered));

  // Collapse: while deposit_receipt_closing is live for a chain, the
  // acceptance-based deposit_overdue for that same chain is never computed
  // into a pushed alert, so its deliveryKeys (even freshly-undelivered
  // ones) never reach collectDealAlerts' deliveries list and are never
  // recorded -- not consumed, just never looked at this morning.
  const holdingClosing = depositReceiptClosingAlert(transaction, facts, resolvedItems, today, HOLDING_DEPOSIT_CHAIN);
  if (holdingClosing) {
    alerts.push(holdingClosing);
  } else {
    const holdingDeposit = depositOverdueAlert(transaction, facts, resolvedItems, today, HOLDING_DEPOSIT_CHAIN, delivered);
    if (holdingDeposit) alerts.push(holdingDeposit);
  }
  const payingClosing = depositReceiptClosingAlert(transaction, facts, resolvedItems, today, PAYING_DEPOSIT_CHAIN);
  if (payingClosing) {
    alerts.push(payingClosing);
  } else {
    const payingDeposit = depositOverdueAlert(transaction, facts, resolvedItems, today, PAYING_DEPOSIT_CHAIN, delivered);
    if (payingDeposit) alerts.push(payingDeposit);
  }

  const holdingAdditional = additionalDepositOverdueAlert(transaction, facts, resolvedItems, today, HOLDING_ADDITIONAL_DEPOSIT_ID, delivered);
  if (holdingAdditional) alerts.push(holdingAdditional);
  const payingAdditional = additionalDepositOverdueAlert(transaction, facts, resolvedItems, today, PAYING_ADDITIONAL_DEPOSIT_ID, delivered);
  if (payingAdditional) alerts.push(payingAdditional);

  alerts.push(...filingAlerts(transaction, now));

  return alerts;
}

module.exports = { alertsForTransaction };
