/** Self-contained authentication pages aligned with the Harness design system. */

export function renderLoginPage(opts: { loginPath: string; error?: string }): string {
  const errorHtml = opts.error
    ? `<div class="alert" role="alert"><span class="alert-dot" aria-hidden="true"></span>${escapeHtml(opts.error)}</div>`
    : ''

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light dark">
  <title>Sign in · DeepSeek Harness</title>
  <style>${pageStyles()}</style>
</head>
<body>
  <main class="shell">
    <section class="auth-card" aria-labelledby="auth-title">
      <header class="brand">
        <span class="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" focusable="false"><path d="M6.2 6.75h11.6A2.2 2.2 0 0 1 20 8.95v6.1a2.2 2.2 0 0 1-2.2 2.2h-6.05L7.4 20v-2.75H6.2A2.2 2.2 0 0 1 4 15.05v-6.1a2.2 2.2 0 0 1 2.2-2.2Z"/><path class="brand-eye" d="M8 11.4h1.6v1.6H8zm3.2 0h1.6v1.6h-1.6z"/></svg>
        </span>
        <span class="brand-name">DeepSeek Harness</span>
      </header>

      <div class="heading">
        <h1 id="auth-title">Welcome back</h1>
        <p>Sign in to continue to your workspace.</p>
      </div>

      ${errorHtml}
      <form method="POST" action="${escapeHtml(opts.loginPath)}">
        <div class="field">
          <label for="username">Username</label>
          <input type="text" id="username" name="username" autocomplete="username" spellcheck="false" required autofocus>
        </div>
        <div class="field">
          <label for="password">Password</label>
          <input type="password" id="password" name="password" autocomplete="current-password" required>
        </div>
        <button type="submit">Sign in</button>
      </form>

      <footer>Protected by dsh-auth-gate</footer>
    </section>
  </main>
</body>
</html>`
}

export function renderLogoutPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light dark">
  <title>Signed out · DeepSeek Harness</title>
  <style>${pageStyles()}</style>
</head>
<body>
  <main class="shell">
    <section class="auth-card signed-out" aria-labelledby="logout-title">
      <span class="success-mark" aria-hidden="true">✓</span>
      <div class="heading">
        <h1 id="logout-title">You’re signed out</h1>
        <p>Your browser session has been revoked.</p>
      </div>
      <a class="button-link" href="/auth/login">Sign in again</a>
    </section>
  </main>
</body>
</html>`
}

function pageStyles(): string {
  return `
    :root {
      color-scheme: light dark;
      --bg: #f9fafb;
      --surface: #ffffff;
      --surface-subtle: #f5f6f7;
      --text: #0f1115;
      --text-secondary: #61666b;
      --text-tertiary: #81858c;
      --border: rgba(15, 17, 21, 0.10);
      --border-strong: rgba(15, 17, 21, 0.16);
      --brand: #4176e6;
      --brand-hover: #5686fe;
      --focus: rgba(65, 118, 230, 0.18);
      --danger: #ec1313;
      --danger-bg: #fef2f2;
      --danger-border: rgba(236, 19, 19, 0.18);
      --shadow: 0 20px 55px rgba(15, 17, 21, 0.08), 0 2px 8px rgba(15, 17, 21, 0.04);
      --font: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Helvetica Neue', Arial, sans-serif;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #151517;
        --surface: #232324;
        --surface-subtle: #2c2c2e;
        --text: #f1f3f5;
        --text-secondary: #adb2b8;
        --text-tertiary: #81858c;
        --border: rgba(255, 255, 255, 0.12);
        --border-strong: rgba(255, 255, 255, 0.20);
        --brand: #679efe;
        --brand-hover: #86b1ff;
        --focus: rgba(103, 158, 254, 0.22);
        --danger: #f25a5a;
        --danger-bg: rgba(242, 90, 90, 0.10);
        --danger-border: rgba(242, 90, 90, 0.22);
        --shadow: 0 22px 64px rgba(0, 0, 0, 0.32), 0 2px 10px rgba(0, 0, 0, 0.20);
      }
    }
    * { box-sizing: border-box; }
    html, body { min-height: 100%; margin: 0; }
    body {
      min-width: 280px;
      font-family: var(--font);
      -webkit-font-smoothing: antialiased;
      color: var(--text);
      background: var(--bg);
    }
    button, input { font: inherit; }
    .shell {
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 32px 20px;
      background:
        radial-gradient(circle at 50% -20%, rgba(65, 118, 230, 0.09), transparent 38%),
        var(--bg);
    }
    .auth-card {
      width: min(100%, 400px);
      padding: 30px;
      border: 1px solid var(--border);
      border-radius: 16px;
      background: var(--surface);
      box-shadow: var(--shadow);
    }
    .brand { display: flex; align-items: center; gap: 10px; margin-bottom: 34px; }
    .brand-mark {
      width: 30px; height: 30px; display: grid; place-items: center;
      color: white; background: var(--brand); border-radius: 9px;
      box-shadow: 0 5px 14px rgba(65, 118, 230, 0.24);
    }
    .brand-mark svg { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linejoin: round; }
    .brand-mark .brand-eye { fill: currentColor; stroke: none; }
    .brand-name { font-size: 14px; line-height: 22px; font-weight: 600; letter-spacing: -0.01em; }
    .heading { margin-bottom: 25px; }
    h1 { margin: 0 0 7px; font-size: 24px; line-height: 32px; font-weight: 600; letter-spacing: -0.025em; }
    .heading p { margin: 0; color: var(--text-secondary); font-size: 14px; line-height: 22px; }
    .alert {
      display: flex; align-items: center; gap: 9px; margin: -5px 0 20px; padding: 10px 12px;
      border: 1px solid var(--danger-border); border-radius: 9px; color: var(--danger);
      background: var(--danger-bg); font-size: 13px; line-height: 20px;
    }
    .alert-dot { width: 6px; height: 6px; flex: 0 0 auto; border-radius: 50%; background: currentColor; }
    form { display: grid; gap: 18px; }
    .field { display: grid; gap: 7px; }
    label { font-size: 13px; line-height: 20px; font-weight: 500; }
    input {
      width: 100%; height: 42px; padding: 0 12px; border: 1px solid var(--border-strong);
      border-radius: 9px; outline: none; color: var(--text); background: var(--surface);
      font-size: 14px; transition: border-color .15s ease, box-shadow .15s ease, background .15s ease;
    }
    input:hover { background: var(--surface-subtle); }
    input:focus { background: var(--surface); border-color: var(--brand); box-shadow: 0 0 0 3px var(--focus); }
    button, .button-link {
      width: 100%; min-height: 42px; display: inline-flex; align-items: center; justify-content: center;
      border: 0; border-radius: 9px; color: #fff; background: var(--brand); font-size: 14px;
      font-weight: 500; text-decoration: none; cursor: pointer; transition: background .15s ease, transform .1s ease;
    }
    button { margin-top: 3px; }
    button:hover, .button-link:hover { background: var(--brand-hover); }
    button:active, .button-link:active { transform: translateY(1px); }
    button:focus-visible, .button-link:focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; }
    footer { margin-top: 25px; color: var(--text-tertiary); font-size: 11px; line-height: 16px; text-align: center; }
    .signed-out { text-align: center; }
    .signed-out .heading { margin-bottom: 24px; }
    .success-mark {
      width: 42px; height: 42px; display: grid; place-items: center; margin: 0 auto 22px;
      border-radius: 50%; color: var(--brand); background: var(--focus); font-size: 20px; font-weight: 600;
    }
    @media (max-width: 480px) {
      .shell { padding: 0; background: var(--surface); }
      .auth-card { width: 100%; min-height: 100vh; padding: 28px 22px; border: 0; border-radius: 0; box-shadow: none; }
    }
  `
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
