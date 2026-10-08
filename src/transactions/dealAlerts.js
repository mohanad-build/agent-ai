'use strict';

// Pure aggregator for the daily brief's "Deals needing you" section: every
// deal an agent has (already read by readAllTransactionsSettled) plus today
// and now in, one danger-ranked alert list out. No disk, no clock, no
// sending -- those stay in the caller.

const states = require('./states');
const { alertsForTransaction } = require('./alerts');

// The four deal types. Listing types (seller_listing, landlord_listing)
// never carry a condition or deposit item (rules/sellerListing.js,
// rules/landlordListing.js have neither), so they can never produce the
// alert kinds this file ranks, and the quiet-morning count is deal-only.
// Not derived from states.TRANSACTION_TYPES, which is all six types with
// no exported subset for "deal, not listing": listingTypeForDeal only
// pairs the two sell-side deal types with their listing type, and says
// nothing about buyer_purchase/tenant_lease, which never pair with one.
const DEAL_TYPES = ['buyer_purchase', 'seller_sale', 'tenant_lease', 'landlord_lease'];

// Danger rank, low number first. deposit_overdue and additional_deposit_overdue
// share one rank: both tie-break the same way (larger daysPast first), so a
// day-count split between them would be a distinction with no observable
// effect (confirmed by mutation testing -- see commit 1's recon), and would
// invite a later reader to think a day-count boundary matters here when it
// does not.
function rankForAlert(alert) {
  switch (alert.kind) {
    case 'condition_passed':
      return 0;
    case 'deposit_overdue':
    case 'additional_deposit_overdue':
      return 1;
    case 'condition_heads_up':
      return 2;
    case 'filing_failed':
      return 3;
    default:
      // A kind alerts.js grew that this file was never told how to rank.
      // Silently sorting it last would hide a new alert kind in the brief
      // instead of forcing a ranking decision.
      throw new Error(`collectDealAlerts: unknown alert kind '${alert.kind}'`);
  }
}

// Within-rank tie-break. Ranks 0-1 are both "bigger daysPast is worse, show
// first"; rank 2 is "fewer days left is worse, show first"; rank 3 is
// "abandoned more recently is worse, show first".
function withinRankCompare(a, b, rank) {
  if (rank === 2) {
    return a.daysUntil - b.daysUntil;
  }
  if (rank === 3) {
    return new Date(b.abandonedAt).getTime() - new Date(a.abandonedAt).getTime();
  }
  return b.daysPast - a.daysPast;
}

function compareRanked(a, b) {
  if (a.rank !== b.rank) {
    return a.rank - b.rank;
  }

  const withinRank = withinRankCompare(a.alert, b.alert, a.rank);
  if (withinRank !== 0) {
    return withinRank;
  }

  const addressCompare = a.alert.address.localeCompare(b.alert.address);
  if (addressCompare !== 0) {
    return addressCompare;
  }

  if (a.alert.transactionId < b.alert.transactionId) return -1;
  if (a.alert.transactionId > b.alert.transactionId) return 1;
  return 0;
}

function collectDealAlerts(settled, { today, now }) {
  if (!settled || !Array.isArray(settled.transactions) || !Array.isArray(settled.unreadable)) {
    throw new Error('collectDealAlerts: settled must have array transactions and array unreadable');
  }

  const alerts = [];
  const unreadable = settled.unreadable.map((entry) => ({ ...entry, stage: 'read' }));
  let activeCount = 0;

  settled.transactions.forEach((transaction) => {
    const isActive = DEAL_TYPES.includes(transaction.type)
      && !states.isTerminal(transaction.type, transaction.state);
    if (isActive) {
      activeCount += 1;
    }

    // One deal's alerts throwing (a malformed fact, an impossible date)
    // must never blank the others, the same reasoning as
    // readAllTransactionsSettled keeping one bad file from hiding the rest.
    try {
      const transactionAlerts = alertsForTransaction(transaction, { today, now });
      transactionAlerts.forEach((alert) => {
        alerts.push({
          ...alert,
          type: transaction.type,
          driveFolderId: transaction.driveFolderId !== undefined ? transaction.driveFolderId : null,
        });
      });
    } catch (err) {
      unreadable.push({ transactionId: transaction.transactionId, error: err.message, stage: 'alerts' });
    }
  });

  // rankForAlert is computed for every alert up front, not inside the sort
  // comparator, so an unknown kind throws even when there is only one
  // alert (a comparator is never called for an array of length 0 or 1).
  const ranked = alerts.map((alert) => ({ alert, rank: rankForAlert(alert) }));
  ranked.sort(compareRanked);

  return { alerts: ranked.map((entry) => entry.alert), activeCount, unreadable };
}

module.exports = { collectDealAlerts };
