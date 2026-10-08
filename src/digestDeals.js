'use strict';

// Plaintext and HTML renderers for the daily brief's "Deals needing you"
// section (docs/designs/done-verb.md's commit-4 recon). Pure and
// synchronous: collectDealAlerts' own output in, two strings out. No disk,
// no clock, no sending. One block per deal, not one row per alert: a deal
// with several alerts states its address once and lists each alert's own
// text and actions underneath, with the two context links (Emails about,
// Drive folder) given once per deal at the end of its block, not once per
// alert.
//
// T (the style tokens) is received as a field on ctx, the same way
// digest.js's calledAffordanceHtml receives T as a parameter: digest.js's
// own STYLE_TOKENS is not exported for production use (only exposed on
// digest.js's _internal, a test-only escape hatch), and its sectionHeader
// and esc helpers are not exported at all, so this module cannot reach any
// of the three directly and rebuilds the same visual shapes locally from
// whatever T the caller passes in.

const { escapeHtml } = require('./plainTextHtml');
const { buildDoneMailtoHref, buildReceiptMailtoHref, catalogItemLabel } = require('./transactions/tapLinks');
const { driveFolderUrl, gmailSearchUrl, fellThroughMailtoHref } = require('./transactions/dealLinks');

// The closed vocabulary (rules/conditions.js CONDITION_NAMES) read badly in
// a sentence as raw ids: 'sale_of_property condition passed...'. Every name
// but one reads fine with a plain underscore-to-space swap; well_septic
// does not ('well septic condition...') and is overridden to match the
// catalog's own label wording ("Well and septic inspection condition...").
// A condition name added to the closed list later gets the generic
// underscore-to-space treatment unless it earns its own override here.
const CONDITION_DISPLAY_OVERRIDES = { well_septic: 'well and septic' };

function conditionDisplayName(condition) {
  return CONDITION_DISPLAY_OVERRIDES[condition] || condition.replace(/_/g, ' ');
}

function dayWord(n) {
  return n === 1 ? 'day' : 'days';
}

function daysPhrase(n) {
  return `${n} ${dayWord(n)}`;
}

function daysAgoPhrase(daysPast) {
  return daysPast === 1 ? 'yesterday' : `${daysPhrase(daysPast)} ago`;
}

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Timezone-free: a calendar date (YYYY-MM-DD) names a day, not an instant,
// so the weekday is read back from the same UTC fields it was built from
// (calendarDate.js's own Date.UTC convention), never from the server's
// local clock.
function weekdayForCalendarDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return WEEKDAY_NAMES[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

function displayAddress(alert) {
  return alert.unit ? `${alert.address}, unit ${alert.unit}` : alert.address;
}

function capitalizeFirst(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// Groups collected.alerts by transactionId, keeping the incoming
// (already danger-sorted) order: a deal's position is wherever its FIRST
// alert sat in the input, and the alerts inside a deal keep their own
// incoming order too. Does not sort anything -- collectDealAlerts already
// did that, and this must not disagree with it just because a deal's other
// alerts landed elsewhere in the list.
function groupAlertsByDeal(alerts) {
  const order = [];
  const byDeal = new Map();

  alerts.forEach((alert) => {
    if (!byDeal.has(alert.transactionId)) {
      byDeal.set(alert.transactionId, []);
      order.push(alert.transactionId);
    }
    byDeal.get(alert.transactionId).push(alert);
  });

  return order.map((transactionId) => byDeal.get(transactionId));
}

// One shape, shared by both renderers: the text lines for one alert (no
// address in them any more -- that is the deal block's job, once), plus
// the primary (button) and secondary (quiet link) actions, or null when a
// kind has none. An alert kind digestDeals.js was never told how to render
// is a programmer error, the same stance alerts.js's own rankForAlert
// takes on an unranked kind -- collectDealAlerts already ranks every alert
// it returns, so this is unreachable through that path, and only reachable
// here if a test (or a future caller) hands this module a kind it never
// went through collectDealAlerts at all.
function rowContent(alert, ctx) {
  switch (alert.kind) {
    case 'condition_passed': {
      const condition = conditionDisplayName(alert.condition);
      return {
        textLines: [
          capitalizeFirst(`${condition} condition passed ${daysAgoPhrase(alert.daysPast)}, not marked waived or fulfilled.`),
          "If it wasn't waived in time, the deal may have ended. Check today.",
        ],
        primary: { label: 'Waived or fulfilled', url: buildDoneMailtoHref(alert.transactionId, alert.itemId) },
        secondary: {
          label: 'It fell through',
          url: fellThroughMailtoHref({ address: alert.address, transactionId: alert.transactionId, operatorEmail: ctx.operatorEmail }),
        },
      };
    }

    case 'condition_heads_up': {
      const condition = conditionDisplayName(alert.condition);
      const weekday = weekdayForCalendarDate(alert.date);
      return {
        textLines: [capitalizeFirst(`${condition} condition is due ${weekday} (in ${daysPhrase(alert.daysUntil)}).`)],
        primary: { label: 'Waived or fulfilled', url: buildDoneMailtoHref(alert.transactionId, alert.itemId) },
        secondary: null,
      };
    }

    case 'deposit_overdue': {
      const stuckLabel = catalogItemLabel(alert.type, alert.stuckAt);
      return {
        textLines: [capitalizeFirst(`deposit not confirmed, ${daysPhrase(alert.daysPast)} after acceptance. Waiting on: ${stuckLabel}.`)],
        primary: { label: 'Receipt in hand', url: buildReceiptMailtoHref(alert.transactionId, alert.itemId) },
        secondary: { label: stuckLabel, url: buildDoneMailtoHref(alert.transactionId, alert.stuckAt) },
      };
    }

    case 'additional_deposit_overdue': {
      return {
        textLines: [capitalizeFirst(`additional deposit is ${daysPhrase(alert.daysPast)} overdue.`)],
        primary: { label: 'Deposit received', url: buildDoneMailtoHref(alert.transactionId, alert.itemId) },
        secondary: null,
      };
    }

    case 'filing_failed': {
      return {
        textLines: [capitalizeFirst(`a document (${alert.filename}) couldn't be filed to Drive.`)],
        primary: null,
        secondary: null,
      };
    }

    default:
      throw new Error(`digestDeals: unknown alert kind '${alert.kind}'`);
  }
}

function emailsLinkFor(alert, ctx) {
  return { label: `Emails about ${alert.address}`, url: gmailSearchUrl(alert.address, ctx.gmailAddress) };
}

function driveLinkFor(alert) {
  const url = driveFolderUrl(alert.driveFolderId);
  return url ? { label: 'Drive folder', url } : null;
}

function unreadableLine(unreadable) {
  return unreadable.length === 1
    ? "One of your deal files couldn't be read this morning. Mo has been told."
    : `${unreadable.length} of your deal files couldn't be read this morning. Mo has been told.`;
}

const SECTION_TITLE = 'Deals needing you';

// -- plaintext ----------------------------------------------------------------------

function renderDealBlockPlain(dealAlerts, ctx) {
  const first = dealAlerts[0];
  const lines = [displayAddress(first)];

  dealAlerts.forEach((alert) => {
    const content = rowContent(alert, ctx);
    lines.push(...content.textLines);
    if (content.primary) lines.push(`→ ${content.primary.label}: ${content.primary.url}`);
    if (content.secondary) lines.push(`→ ${content.secondary.label}: ${content.secondary.url}`);
  });

  const emailsLink = emailsLinkFor(first, ctx);
  lines.push(`→ ${emailsLink.label}: ${emailsLink.url}`);

  const driveLink = driveLinkFor(first);
  if (driveLink) lines.push(`→ ${driveLink.label}: ${driveLink.url}`);

  return lines.join('\n');
}

function renderDealsPlain(collected, ctx) {
  const { alerts, activeCount, unreadable } = collected;

  if (alerts.length === 0 && activeCount === 0 && unreadable.length === 0) {
    return '';
  }

  const sections = [];

  if (alerts.length > 0) {
    const deals = groupAlertsByDeal(alerts);
    sections.push(deals.map((dealAlerts) => renderDealBlockPlain(dealAlerts, ctx)).join('\n\n'));
  } else if (activeCount > 0) {
    sections.push(`Deals: ${activeCount} active, nothing needs you today.`);
  }

  if (unreadable.length > 0) {
    sections.push(unreadableLine(unreadable));
  }

  return `-- ${SECTION_TITLE} --\n\n${sections.join('\n\n')}`;
}

// -- HTML -----------------------------------------------------------------------

function renderDealsHtml(collected, ctx) {
  const { alerts, activeCount, unreadable } = collected;

  if (alerts.length === 0 && activeCount === 0 && unreadable.length === 0) {
    return '';
  }

  const T = ctx.T;

  function sectionHeader(title) {
    return `<div style="margin-top:24px;margin-bottom:12px;padding-bottom:8px;` +
      `border-bottom:1px solid ${T.sectionDividerColor};` +
      `font-weight:${T.buttonFontWeight};color:${T.bodyTextColor};">` +
      `${escapeHtml(title)}</div>`;
  }

  function button(link) {
    if (!link) return '';
    return `<div style="margin-top:8px;">` +
      `<a href="${escapeHtml(link.url)}" ` +
      `style="display:inline-block;padding:${T.buttonPadding};background:${T.buttonBackground};` +
      `color:${T.buttonTextColor};border-radius:${T.buttonBorderRadius};` +
      `font-weight:${T.buttonFontWeight};text-decoration:none;` +
      `font-family:${T.fontStack};font-size:${T.fontSize};">` +
      `${escapeHtml(link.label)}</a>` +
      `</div>`;
  }

  function quietLinksLine(links) {
    const present = links.filter(Boolean);
    if (present.length === 0) return '';
    const joined = present
      .map((l) => `<a href="${escapeHtml(l.url)}" style="color:${T.mutedTextColor};">${escapeHtml(l.label)}</a>`)
      .join(' | ');
    return `<div style="margin-top:4px;color:${T.mutedTextColor};font-size:${T.fontSize};">${joined}</div>`;
  }

  function renderDealBlockHtml(dealAlerts) {
    const first = dealAlerts[0];
    const addressHtml = `<div style="font-weight:${T.buttonFontWeight};">${escapeHtml(displayAddress(first))}</div>`;

    const alertsHtml = dealAlerts.map((alert) => {
      const content = rowContent(alert, ctx);
      const textHtml = content.textLines.map((line) => `<div>${escapeHtml(line)}</div>`).join('');
      const buttonHtml = button(content.primary);
      const secondaryHtml = quietLinksLine([content.secondary]);
      return textHtml + buttonHtml + secondaryHtml;
    }).join('');

    const contextHtml = quietLinksLine([emailsLinkFor(first, ctx), driveLinkFor(first)]);

    return `<div style="margin-bottom:16px;">${addressHtml}${alertsHtml}${contextHtml}</div>`;
  }

  const bodyHtml = alerts.length > 0
    ? groupAlertsByDeal(alerts).map(renderDealBlockHtml).join('')
    : (activeCount > 0 ? `<div>${escapeHtml(`Deals: ${activeCount} active, nothing needs you today.`)}</div>` : '');

  const unreadableHtml = unreadable.length > 0
    ? `<div>${escapeHtml(unreadableLine(unreadable))}</div>`
    : '';

  return sectionHeader(SECTION_TITLE) + bodyHtml + unreadableHtml;
}

module.exports = { renderDealsPlain, renderDealsHtml };

module.exports._internal = { CONDITION_DISPLAY_OVERRIDES, rowContent };
