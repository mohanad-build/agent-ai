'use strict';

// ── Design tokens ─────────────────────────────────────────────────────────────

// Visually identical to digest.js STYLE_TOKENS by design.
// Intentionally duplicated (not imported) so review email visuals can diverge
// from digest visuals in future without coupling. Do not import from digest.js.
const STYLE_TOKENS = {
  buttonBackground:    '#1a1a1a',
  buttonTextColor:     '#ffffff',
  buttonBorderRadius:  '6px',
  buttonPadding:       '12px 20px',
  buttonFontWeight:    '600',
  containerMaxWidth:   '560px',
  containerPadding:    '24px',
  fontStack:           '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  bodyTextColor:       '#1a1a1a',
  mutedTextColor:      '#666666',
  sectionDividerColor: '#e0e0e0',
  bodyBackground:      '#ffffff',
  fontSize:            '16px',
  lineHeight:          '1.5',
};

// ── Input validation ──────────────────────────────────────────────────────────

function validateInputs(batch) {
  if (batch == null || typeof batch !== 'object' || Array.isArray(batch)) {
    throw new TypeError('batch must be a non-null object');
  }
  if (typeof batch.weekIso !== 'string' || batch.weekIso.trim() === '') {
    throw new TypeError('batch.weekIso must be a non-empty string');
  }
  if (!Array.isArray(batch.pieces) || batch.pieces.length < 1 || batch.pieces.length > 3) {
    throw new TypeError('batch.pieces must be an array of length 1, 2, or 3');
  }
  for (const piece of batch.pieces) {
    if (!piece.id || !piece.type || !piece.angle) {
      throw new TypeError('each piece must have id, type, and angle');
    }
    if (piece.type === 'reel') {
      if (!piece.reel || !piece.reel.script || !piece.reel.script.text ||
          !piece.reel.caption || !piece.reel.caption.text) {
        throw new TypeError('reel piece must have reel.script.text and reel.caption.text');
      }
    }
    if (piece.type === 'blog') {
      if (!piece.blog || !piece.blog.text) {
        throw new TypeError('blog piece must have blog.text');
      }
    }
  }
  if (!Array.isArray(batch.otherAngles)) {
    throw new TypeError('batch.otherAngles must be an array');
  }
  if (!Array.isArray(batch.headsUp)) {
    throw new TypeError('batch.headsUp must be an array');
  }
}

// ── buildSubject ──────────────────────────────────────────────────────────────

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS   = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function buildSubject({ pieceCount, now }) {
  const weekday = WEEKDAYS[now.getUTCDay()];
  const month   = MONTHS[now.getUTCMonth()];
  const day     = now.getUTCDate();
  const s       = pieceCount === 1 ? '' : 's';
  const suffix  = pieceCount === 1 ? ' (light news week)' : '';
  return `Your content batch -- ${weekday}, ${month} ${day} -- ${pieceCount} piece${s} ready${suffix}`;
}

// ── buildOpener ───────────────────────────────────────────────────────────────

function buildOpener(pieceCount) {
  if (pieceCount === 3) return 'Solid news week -- 3 pieces ready.';
  if (pieceCount === 2) return 'Decent week -- 2 pieces ready.';
  return "Light news week. Here's one strong angle.";
}

// ── buildWhyThisOne ───────────────────────────────────────────────────────────

function buildWhyThisOne(angle) {
  const tag         = angle.themeTag.replace(/-/g, ' ');
  const capitalized = tag.charAt(0).toUpperCase() + tag.slice(1);

  const parts       = angle.thesis.split('. ');
  let firstSentence = parts[0];

  if (!/[.!?]$/.test(firstSentence)) {
    firstSentence += '.';
  }

  return `${capitalized}: ${firstSentence}`;
}

// ── buildActionMailto ─────────────────────────────────────────────────────────

function buildActionMailto(agentEmail, action, pieceId) {
  const to = agentEmail || '';
  return `mailto:${to}?subject=${encodeURIComponent(action + ' ' + pieceId)}`;
}

// ── escape ────────────────────────────────────────────────────────────────────

// & replaced first to prevent double-escaping.
function escape(str) {
  const s = str == null ? '' : String(str);
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── markdownToHtml ────────────────────────────────────────────────────────────

// Strategy: escape all text content first, then apply markdown transforms.
// Inline markers (**, *, [text](url)) are ASCII and survive HTML escaping intact.
// This guarantees no user-provided HTML characters reach the output unescaped.
function markdownToHtml(text) {
  const lines     = escape(text).split('\n');
  const output    = [];
  let inList      = false;
  let paraLines   = [];

  function flushPara() {
    if (paraLines.length > 0) {
      output.push(`<p>${paraLines.join(' ')}</p>`);
      paraLines = [];
    }
  }

  function flushList() {
    if (inList) {
      output.push('</ul>');
      inList = false;
    }
  }

  function applyInline(s) {
    s = s.replace(/\[([^\]]*)\]\(([^)]*)\)/g, '<a href="$2">$1</a>');
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    return s;
  }

  for (const line of lines) {
    if (line === '') {
      flushPara();
      flushList();
    } else if (line.startsWith('# ')) {
      flushPara();
      flushList();
      output.push(`<h1>${applyInline(line.slice(2))}</h1>`);
    } else if (line.startsWith('## ')) {
      flushPara();
      flushList();
      output.push(`<h2>${applyInline(line.slice(3))}</h2>`);
    } else if (line === '---') {
      flushPara();
      flushList();
      output.push('<hr>');
    } else if (line.startsWith('- ')) {
      flushPara();
      if (!inList) {
        output.push('<ul>');
        inList = true;
      }
      output.push(`<li>${applyInline(line.slice(2))}</li>`);
    } else {
      flushList();
      paraLines.push(applyInline(line));
    }
  }

  flushPara();
  flushList();

  return output.join('\n');
}

// ── actionButton ──────────────────────────────────────────────────────────────

function actionButton(label, mailtoUrl) {
  return `<a href="${mailtoUrl}" style="display:inline-block;background:${STYLE_TOKENS.buttonBackground};color:${STYLE_TOKENS.buttonTextColor};padding:${STYLE_TOKENS.buttonPadding};border-radius:${STYLE_TOKENS.buttonBorderRadius};font-weight:${STYLE_TOKENS.buttonFontWeight};text-decoration:none;margin-right:8px;margin-bottom:8px">${label}</a>`;
}

// ── pieceHeader ───────────────────────────────────────────────────────────────

function pieceHeader(piece, index) {
  const pos = index + 1;
  if (piece.type === 'reel') {
    return index === 0
      ? `#${pos} REEL (RECOMMENDED PRIORITY)`
      : `#${pos} REEL`;
  }
  return `#${pos} BLOG / NEWSLETTER POST`;
}

// ── renderText ────────────────────────────────────────────────────────────────

function renderText(batch, now) {
  const agentEmail = batch.agentProfile && batch.agentProfile.email;
  const opener     = buildOpener(batch.pieces.length);

  const parts = [opener, '', "-- This week's batch --", ''];

  batch.pieces.forEach((piece, index) => {
    const header     = pieceHeader(piece, index);
    const whyThisOne = buildWhyThisOne(piece.angle);

    parts.push(header);
    parts.push(`Angle: ${piece.angle.headline}`);
    parts.push(`Why this one: ${whyThisOne}`);
    parts.push('');

    if (piece.type === 'reel') {
      parts.push('[Script]');
      parts.push(piece.reel.script.text);
      parts.push('');
      parts.push('[Instagram caption]');
      parts.push(piece.reel.caption.text);
      parts.push('');
    } else if (piece.type === 'blog') {
      parts.push('[Post]');
      parts.push(piece.blog.text);
      parts.push('');
    }

    parts.push(`Sources: ${piece.angle.sourceFooter}`);
    parts.push('');
    parts.push('Actions:');
    parts.push('→ Approve: reply with "APPROVE ' + piece.id + '"');
    parts.push('→ Regenerate: reply with "REGEN ' + piece.id + '"');
    parts.push('→ Edit by hand: reply with the edited version inline');
    parts.push('→ Swap angle: see "Other angles available" below; reply with "SWAP ' + piece.id + ' TO <angle-id>"');
    parts.push('');
  });

  if (batch.otherAngles.length > 0) {
    parts.push('-- Other angles available this week --');
    parts.push('(use Swap angle on any piece to switch to one of these)');
    for (const angle of batch.otherAngles) {
      parts.push(`- ${angle.headline} (id: ${angle.id}, theme: ${angle.themeTag})`);
    }
    parts.push('');
  }

  if (batch.headsUp.length > 0) {
    parts.push('-- Heads up --');
    for (const note of batch.headsUp) {
      parts.push(`- ${note}`);
    }
    parts.push('');
  }

  return parts.join('\n');
}

// ── renderHtml ────────────────────────────────────────────────────────────────

function renderHtml(batch, now) {
  const agentEmail = batch.agentProfile && batch.agentProfile.email;
  const opener     = buildOpener(batch.pieces.length);
  const ST         = STYLE_TOKENS;

  const hrStyle  = `border:0;border-top:1px solid ${ST.sectionDividerColor};margin:24px 0`;
  const h2Style  = `font-size:14px;color:${ST.mutedTextColor};text-transform:uppercase;letter-spacing:0.05em;margin:0 0 16px`;
  const preStyle = `white-space:pre-wrap;font-family:${ST.fontStack};font-size:14px;background:#f7f7f7;padding:12px;border-radius:4px;margin:0 0 16px`;

  let html = `<div style="max-width:${ST.containerMaxWidth};margin:0 auto;padding:${ST.containerPadding};font-family:${ST.fontStack};font-size:${ST.fontSize};line-height:${ST.lineHeight};color:${ST.bodyTextColor};background:${ST.bodyBackground}">`;
  html += `\n<p>${escape(opener)}</p>`;
  html += `\n<hr style="${hrStyle}">`;
  html += `\n<h2 style="${h2Style}">This week&#39;s batch</h2>`;

  for (let i = 0; i < batch.pieces.length; i++) {
    const piece      = batch.pieces[i];
    const header     = pieceHeader(piece, i);
    const whyThisOne = buildWhyThisOne(piece.angle);

    html += `\n<div style="margin-bottom:32px">`;
    html += `\n<h3 style="margin:0 0 8px">${escape(header)}</h3>`;
    html += `\n<p style="margin:0 0 4px"><strong>Angle:</strong> ${escape(piece.angle.headline)}</p>`;
    html += `\n<p style="margin:0 0 16px;color:${ST.mutedTextColor}"><em>Why this one:</em> ${escape(whyThisOne)}</p>`;

    if (piece.type === 'reel') {
      html += `\n<h4 style="margin:0 0 8px">Script</h4>`;
      html += `\n<pre style="${preStyle}">${escape(piece.reel.script.text)}</pre>`;
      html += `\n<h4 style="margin:0 0 8px">Instagram caption</h4>`;
      html += `\n<pre style="${preStyle}">${escape(piece.reel.caption.text)}</pre>`;
    } else if (piece.type === 'blog') {
      html += `\n<h4 style="margin:0 0 8px">Post</h4>`;
      html += `\n<div style="background:#f7f7f7;padding:16px;border-radius:4px;margin:0 0 16px">`;
      html += `\n${markdownToHtml(piece.blog.text)}`;
      html += `\n</div>`;
      html += `\n<p style="margin:0 0 16px;font-size:14px;color:${ST.mutedTextColor}">`;
      html += `<strong>Suggested target keyword:</strong> ${escape(piece.blog.sections && piece.blog.sections.targetKeyword)}<br>`;
      html += `<strong>Suggested meta description:</strong> ${escape(piece.blog.sections && piece.blog.sections.metaDescription)}`;
      html += `</p>`;
    }

    html += `\n<p style="margin:0 0 8px;font-size:14px;color:${ST.mutedTextColor}"><strong>Sources:</strong> ${escape(piece.angle.sourceFooter)}</p>`;
    html += `\n<div style="margin-top:12px">`;
    html += actionButton('Approve',    buildActionMailto(agentEmail, 'APPROVE', piece.id));
    html += actionButton('Regenerate', buildActionMailto(agentEmail, 'REGEN',   piece.id));
    html += actionButton('Edit',       buildActionMailto(agentEmail, 'EDIT',    piece.id));
    html += actionButton('Swap angle', buildActionMailto(agentEmail, 'SWAP',    piece.id));
    html += `\n</div>`;
    html += `\n</div>`;
  }

  if (batch.otherAngles.length > 0) {
    html += `\n<hr style="${hrStyle}">`;
    html += `\n<h2 style="${h2Style}">Other angles available this week</h2>`;
    html += `\n<p style="color:${ST.mutedTextColor}">Use Swap angle on any piece to switch.</p>`;
    html += `\n<ul>`;
    for (const angle of batch.otherAngles) {
      html += `\n<li>${escape(angle.headline)} <span style="color:${ST.mutedTextColor}">(${escape(angle.themeTag)})</span></li>`;
    }
    html += `\n</ul>`;
  }

  if (batch.headsUp.length > 0) {
    html += `\n<hr style="${hrStyle}">`;
    html += `\n<h2 style="${h2Style}">Heads up</h2>`;
    html += `\n<ul>`;
    for (const line of batch.headsUp) {
      html += `\n<li>${escape(line)}</li>`;
    }
    html += `\n</ul>`;
  }

  html += `\n</div>`;

  return html;
}

// ── composeReviewEmail ────────────────────────────────────────────────────────

function composeReviewEmail(batch) {
  validateInputs(batch);
  const now     = batch.now || new Date();
  const subject = buildSubject({ pieceCount: batch.pieces.length, now });
  const text    = renderText(batch, now);
  const html    = renderHtml(batch, now);
  return { subject, text, html };
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  composeReviewEmail,
  _internal: {
    buildSubject,
    buildOpener,
    buildWhyThisOne,
    buildActionMailto,
    renderText,
    renderHtml,
    actionButton,
    markdownToHtml,
    escape,
    validateInputs,
  },
};
