'use strict';

const SHARED_HEAD_LINKS = `
  <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet" />`;

const SHARED_HEADER = `
  <header class="site-header">
    <div class="shell-narrow">
      <a class="logo" href="https://getklosed.ca">
        <span class="logo-mark">
          <svg viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="5.7" r="2.8" fill="none" stroke="#fff" stroke-width="2.3"></circle>
            <path d="M12 8.5 V20.2" fill="none" stroke="#fff" stroke-width="2.7" stroke-linecap="round"></path>
            <path d="M12 14.7 L17 11.2" fill="none" stroke="#fff" stroke-width="2.7" stroke-linecap="round"></path>
            <path d="M12 14.7 L17 18.2" fill="none" stroke="#fff" stroke-width="2.7" stroke-linecap="round"></path>
          </svg>
        </span>
        <span class="logo-word">Get<span class="k">Klosed</span></span>
      </a>
    </div>
  </header>`;

const SHARED_FOOTER = `
  <footer class="site-footer">
    <div class="shell-narrow">
      <span class="footer-copy">© 2026 Mohanad Mohamed. All rights reserved.</span>
      <div class="footer-links">
        <a href="https://getklosed.ca/privacy.html">Privacy Policy</a>
        <a href="https://getklosed.ca/terms.html">Terms of Service</a>
        <a href="mailto:mohanad@getklosed.ca">Contact</a>
      </div>
    </div>
  </footer>`;

const ARROW_SVG = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8h10M9 4l4 4-4 4" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const ROOT_TOKENS = `
    :root {
      --bg:            #0a0a0a;
      --surface:       #111111;
      --surface-2:     #181818;
      --border:        rgba(255,255,255,0.08);
      --border-strong: rgba(255,255,255,0.14);
      --violet:        #7C3AED;
      --violet-bright: #8B5CF6;
      --violet-soft:   rgba(124,58,237,0.13);
      --text:          #FAFAFA;
      --muted:         #8b8b93;
      --muted-2:       #65656d;
      --font:          'Hanken Grotesk', -apple-system, BlinkMacSystemFont, sans-serif;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { background: var(--bg); color: var(--text); font-family: var(--font); -webkit-font-smoothing: antialiased; }
    body { min-height: 100vh; padding-bottom: 64px; }
    .shell-narrow { max-width: 680px; margin: 0 auto; padding: 0 24px; }
    .site-header { border-bottom: 1px solid var(--border); }
    .site-header .shell-narrow { display: flex; align-items: center; height: 72px; }
    .logo { display: inline-flex; align-items: center; gap: 11px; text-decoration: none; user-select: none; }
    .logo-mark { width: 31px; height: 31px; border-radius: 9px; background: var(--violet); display: grid; place-items: center; box-shadow: 0 2px 10px rgba(124,58,237,0.4), inset 0 1px 0 rgba(255,255,255,0.22); }
    .logo-mark svg { width: 19px; height: 19px; }
    .logo-word { font-size: 20px; font-weight: 700; letter-spacing: -0.02em; color: var(--text); }
    .logo-word .k { color: var(--violet-bright); }
    .btn-primary { display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 13px 20px; background: var(--violet); color: #fff; border: none; border-radius: 10px; font-family: var(--font); font-size: 15px; font-weight: 600; cursor: pointer; transition: background 0.15s, transform 0.12s, box-shadow 0.15s; box-shadow: 0 6px 22px rgba(124,58,237,0.36); text-decoration: none; }
    .btn-primary:hover { background: var(--violet-bright); transform: translateY(-1px); box-shadow: 0 10px 30px rgba(124,58,237,0.46); }
    .btn-primary:active { transform: translateY(0); }
    .site-footer { margin-top: 64px; padding: 24px 0; border-top: 1px solid var(--border); }
    .site-footer .shell-narrow { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; }
    .footer-copy { font-size: 13px; color: var(--muted-2); }
    .footer-links { display: flex; gap: 20px; }
    .footer-links a { font-size: 13px; color: var(--muted); text-decoration: none; transition: color 0.15s; }
    .footer-links a:hover { color: var(--text); }`;

function renderErrorPage(title, message, retryLink) {
  const btnHtml = retryLink
    ? `<a href="${retryLink.href}" class="btn-primary" style="margin-top:24px;">${retryLink.label} ${ARROW_SVG}</a>`
    : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>GetKlosed: Something went wrong</title>${SHARED_HEAD_LINKS}
  <style>${ROOT_TOKENS}
    .error-card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 40px 32px; margin-top: 48px; }
    .error-card h1 { font-size: 22px; font-weight: 700; margin-bottom: 14px; letter-spacing: -0.01em; }
    .error-card p { font-size: 15px; color: var(--muted); line-height: 1.65; }
  </style>
</head>
<body>
${SHARED_HEADER}
  <main>
    <div class="shell-narrow">
      <div class="error-card">
        <h1>${title}</h1>
        <p>${message}</p>
        ${btnHtml}
      </div>
    </div>
  </main>
${SHARED_FOOTER}
</body>
</html>`;
}

exports.ROOT_TOKENS = ROOT_TOKENS;
exports.SHARED_HEAD_LINKS = SHARED_HEAD_LINKS;
exports.SHARED_HEADER = SHARED_HEADER;
exports.SHARED_FOOTER = SHARED_FOOTER;
exports.ARROW_SVG = ARROW_SVG;
exports.renderErrorPage = renderErrorPage;
