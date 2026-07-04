'use strict';

// Onboarding welcome email. Pure rendering only: no I/O, no send logic.
// Colors mirror src/brandChrome.js ROOT_TOKENS (--violet / --violet-bright).

const VIOLET = '#7C3AED';
const VIOLET_BRIGHT = '#8B5CF6';
const TEXT_COLOR = '#1a1a1a';
const MUTED_COLOR = '#666666';
const FONT_STACK = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

function esc(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderWelcomeEmail({ firstName, sheetLink, mode }) {
  const name = (firstName || '').trim() || 'there';
  const isShadow = mode === 'shadow';

  const modeParagraphText = isShadow
    ? "You're starting in shadow mode. GetKlosed drafts every reply into your Drafts folder and sends nothing on its own, so you can see exactly how it works before anything reaches a lead. When you're comfortable, you can switch to live mode anytime."
    : "You're set to live mode, so GetKlosed will reply to leads automatically in your voice. If you'd rather review before anything sends, you can switch to shadow mode anytime, and you can turn off automation for any single lead the moment you want to take over.";

  const subject = "You're all set with GetKlosed";

  const text = [
    `Hi ${name},`,
    '',
    "You're all set. I'm Mohanad, and I built GetKlosed to take lead follow-up off your plate.",
    '',
    `Your Gmail is now connected, and I've created a Google Sheet in your Drive that acts as your lead tracker. You can open it here: ${sheetLink}`,
    '',
    "Here's what happens now. GetKlosed watches your inbox for lead replies, drafts responses in your voice, and logs every lead and conversation to that sheet.",
    '',
    modeParagraphText,
    '',
    "One handy thing: you can email assistant@getklosed.ca in plain language to run quick actions, like asking for your daily digest. It's there whenever you want a fast check-in without opening the sheet.",
    '',
    'And for anything at all, questions, changes, or if something looks off, just reply to this email. It comes straight to me.',
    '',
    'Talk soon,',
    'Mohanad',
    'GetKlosed',
  ].join('\n');

  const escName = esc(name);
  const escLink = esc(sheetLink);
  const modeParagraphHtml = esc(modeParagraphText);

  const html =
    `<div style="background-color:#ffffff;padding:32px 16px;font-family:${FONT_STACK};color:${TEXT_COLOR};font-size:16px;line-height:1.6;">` +
    `<div style="max-width:520px;margin:0 auto;">` +
    `<div style="margin-bottom:28px;">` +
    `<span style="font-size:20px;font-weight:700;letter-spacing:-0.02em;color:${TEXT_COLOR};">Get<span style="color:${VIOLET_BRIGHT};">Klosed</span></span>` +
    `</div>` +
    `<p style="margin:0 0 16px 0;">Hi ${escName},</p>` +
    `<p style="margin:0 0 16px 0;">You're all set. I'm Mohanad, and I built GetKlosed to take lead follow-up off your plate.</p>` +
    `<p style="margin:0 0 16px 0;">Your Gmail is now connected, and I've created a Google Sheet in your Drive that acts as your lead tracker.</p>` +
    `<div style="margin:24px 0;">` +
    `<a href="${escLink}" style="display:inline-block;padding:12px 20px;background:${VIOLET};color:#ffffff;border-radius:6px;font-weight:600;text-decoration:none;font-family:${FONT_STACK};font-size:16px;">Open Your Leads Sheet</a>` +
    `</div>` +
    `<p style="margin:0 0 16px 0;">Here's what happens now. GetKlosed watches your inbox for lead replies, drafts responses in your voice, and logs every lead and conversation to that sheet.</p>` +
    `<p style="margin:0 0 16px 0;">${modeParagraphHtml}</p>` +
    `<p style="margin:0 0 16px 0;">One handy thing: you can email assistant@getklosed.ca in plain language to run quick actions, like asking for your daily digest. It's there whenever you want a fast check-in without opening the sheet.</p>` +
    `<p style="margin:0 0 16px 0;">And for anything at all, questions, changes, or if something looks off, just reply to this email. It comes straight to me.</p>` +
    `<p style="margin:24px 0 0 0;color:${MUTED_COLOR};">Talk soon,<br>Mohanad<br>GetKlosed</p>` +
    `</div>` +
    `</div>`;

  return { subject, text, html };
}

module.exports = { renderWelcomeEmail };
