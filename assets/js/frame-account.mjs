import {AccountClient, AccountError, consumeAccountFragment} from './frame-account-client.mjs';
import {validateCommerceConfig, resolveConfigUrl} from './frame-commerce.mjs';

const initialized = new WeakMap();

export function saveLicenseFile(document, view, content) {
  const url = view.URL.createObjectURL(new Blob([content], {type: 'application/json'}));
  const link = document.createElement('a');
  link.href = url; link.download = 'Frame.frame-license'; link.rel = 'noreferrer'; link.click();
  view.setTimeout(() => view.URL.revokeObjectURL(url), 1000);
}

export async function initAccount(root, {fetcher = globalThis.fetch, view = root.ownerDocument.defaultView} = {}) {
  if (initialized.has(root)) return initialized.get(root);
  const task = (async () => {
    const document = root.ownerDocument;
    const find = name => root.querySelector(`[data-${name}]`);
    const status = text => { find('account-status').textContent = text; };
    let client, sessionReady = false, busy = true, mode = 'login', fragment;
    const enable = () => {
      root.querySelectorAll('button, input').forEach(control => { control.disabled = !client || busy; });
      if (client?.current.account?.verified) find('resend-verification').disabled = true;
    };
    const showMode = next => {
      mode = next;
      const signedIn = !!client?.current.authenticated && mode !== 'reset';
      find('account-auth').hidden = signedIn || ['forgot', 'reset'].includes(mode);
      find('account-forgot').hidden = mode !== 'forgot';
      find('account-reset').hidden = mode !== 'reset';
      find('account-signed-in').hidden = !signedIn;
      find('auth-title').textContent = mode === 'register' ? 'Create an account' : 'Sign in';
      find('auth-submit').textContent = mode === 'register' ? 'Create account' : 'Sign in';
      find('auth-password').autocomplete = mode === 'register' ? 'new-password' : 'current-password';
      for (const button of root.querySelectorAll('[data-account-mode]'))
        button.setAttribute('aria-pressed', String(button.getAttribute('data-account-mode') === mode));
    };
    const render = () => {
      showMode(mode);
      const account = client?.current.account;
      if (!account) { find('account-purchases').replaceChildren(); find('account-downloads').replaceChildren(); return; }
      find('account-email').textContent = account.email;
      find('account-verified').textContent = account.verified ? 'Email verified' : 'Verify your email to purchase and download Frame.';
      find('resend-verification').hidden = account.verified;
      find('account-library').hidden = !account.verified;
    };
    const action = async (work, message = '', reload = false) => {
      if (!client || busy) return;
      busy = true; enable();
      try {
        await work(); render();
        if (reload && client.current.account?.verified) await loadLibrary();
        if (message) status(message);
      } catch (error) {
        render(); status(error instanceof AccountError ? error.message : 'The account service is unavailable. Try again.');
      } finally { busy = false; enable(); }
    };
    const loadLibrary = async () => {
      const purchases = await client.library();
      const list = find('account-purchases'); list.replaceChildren();
      if (!purchases.length) {
        const empty = document.createElement('p'); empty.textContent = 'No purchases yet.'; list.append(empty);
      }
      for (const purchase of purchases) {
        const card = document.createElement('article'); card.className = 'frame-library-item';
        const heading = document.createElement('h3'); heading.textContent = 'Frame';
        const detail = document.createElement('p');
        const state = {active: 'One-time purchase', revoked: 'Access revoked', pending: 'Payment pending'}[purchase.status];
        detail.textContent = `${new Intl.NumberFormat(undefined, {style: 'currency', currency: purchase.currency}).format(purchase.amountMinor / 100)} · ${state}`;
        card.append(heading, detail);
        if (purchase.status !== 'revoked') {
          const button = document.createElement('button'); button.type = 'button'; button.className = 'frame-button';
          button.textContent = purchase.status === 'pending' ? 'Check payment' : 'Download license';
          button.addEventListener('click', () => action(async () => {
            saveLicenseFile(document, view, await client.license(purchase.session_id));
          }, 'License downloaded. Keep this file private.', true));
          card.append(button);
        }
        list.append(card);
      }
      const installers = find('account-downloads'); installers.replaceChildren();
      let downloads = [];
      if (purchases.some(value => value.status === 'active')) {
        try { downloads = await client.downloads(); }
        catch (error) {
          if (error instanceof AccountError && error.status === 401) throw error;
          const unavailable = document.createElement('p');
          unavailable.textContent = 'Installer downloads are unavailable. Refresh your library to try again.';
          installers.append(unavailable); return;
        }
      }
      if (!downloads.length) {
        const empty = document.createElement('p'); empty.textContent = 'No installer downloads are available.'; installers.append(empty);
      }
      for (const download of downloads) {
        const row = document.createElement('article'); row.className = 'frame-library-item';
        const title = document.createElement('h3'); title.textContent = `${download.target} · ${download.variant}`;
        const detail = document.createElement('p'); detail.textContent = `${download.version} · ${(download.size / 1024 ** 2).toFixed(1)} MB`;
        const filename = document.createElement('p'); filename.className = 'frame-installer-filename'; filename.textContent = download.filename;
        const link = document.createElement('button'); link.type = 'button'; link.className = 'frame-button';
        const format = download.filename.endsWith('.tar.gz') ? 'TAR.GZ' : download.filename.split('.').at(-1).toUpperCase();
        link.textContent = `Download ${format}`;
        link.addEventListener('click', () => action(async () => {
          const fresh = (await client.downloads()).find(item => item.filename === download.filename &&
            item.target === download.target && item.variant === download.variant && item.version === download.version &&
            item.sha256 === download.sha256 && item.size === download.size);
          if (!fresh) throw new AccountError('This installer changed. Refresh your library.');
          view.location.assign(fresh.url);
        }, 'Download started.'));
        const hash = document.createElement('details');
        const summary = document.createElement('summary'); summary.textContent = 'SHA-256';
        const code = document.createElement('code'); code.textContent = download.sha256;
        hash.append(summary, code); row.append(title, detail, filename, link, hash); installers.append(row);
      }
    };
    try { fragment = consumeAccountFragment(view); }
    catch (error) { status(error.message); busy = false; enable(); return null; }
    enable();
    root.querySelectorAll('[data-account-mode]').forEach(button => button.addEventListener('click', () => {
      if (!busy) { showMode(button.getAttribute('data-account-mode')); status(''); }
    }));
    find('account-auth').addEventListener('submit', event => {
      event.preventDefault();
      void action(async () => {
        const password = find('auth-password');
        try { await client[mode === 'register' ? 'register' : 'login'](find('auth-email').value, password.value); }
        finally { password.value = ''; }
        mode = 'login';
      }, mode === 'register' ? 'Check your email to verify your account.' : 'Signed in.', true);
    });
    find('account-forgot').addEventListener('submit', event => {
      event.preventDefault(); void action(() => client.forgot(find('forgot-email').value),
        'If this email has an account, a password reset link will arrive shortly.');
    });
    find('account-reset').addEventListener('submit', event => {
      event.preventDefault(); void action(async () => {
        const password = find('reset-password');
        try { await client.reset(fragment?.token, password.value); }
        finally { password.value = ''; }
        fragment = null; mode = 'login';
      }, 'Password changed. Sign in with your new password.');
    });
    find('account-logout').addEventListener('click', () => action(() => client.logout(), 'Signed out.'));
    find('resend-verification').addEventListener('click', () => action(() => client.resend(), 'Check your email for a verification link.'));
    find('refresh-library').addEventListener('click', () => action(async () => { await client.session(); }, 'Library refreshed.', true));
    try {
      const response = await fetcher(resolveConfigUrl(root.getAttribute('data-frame-account'), view.location.href),
        {credentials: 'omit', redirect: 'error', cache: 'no-cache'});
      if (!response.ok) throw new AccountError('Accounts are not available yet.');
      const text = await response.text();
      if (text.length > 16384) throw new AccountError('Accounts are not available yet.');
      const config = validateCommerceConfig(JSON.parse(text));
      if (!config.apiBaseUrl) throw new AccountError('Accounts are not available yet.');
      client = new AccountClient({api: config.apiBaseUrl, baseUrl: view.location.href, fetcher});
      await client.session();
      sessionReady = true;
      if (fragment?.action === 'verify') {
        try { await client.verify(fragment.token); status('Email verified.'); }
        catch (error) { status(error instanceof AccountError ? error.message : 'This verification link could not be used.'); }
        fragment = null;
      } else if (fragment?.action === 'reset') { mode = 'reset'; status('Choose a new password.'); }
      else status(client.current.authenticated ? '' : 'Sign in or create an account.');
      render();
      if (client.current.account?.verified && mode !== 'reset') await loadLibrary();
    } catch (error) {
      if (!sessionReady && !(error instanceof AccountError && error.status === 401)) client = null;
      render(); status(error instanceof AccountError ? error.message : 'Accounts are not available yet.');
    } finally { busy = false; enable(); }
    return client;
  })();
  initialized.set(root, task);
  return task;
}

if (typeof document !== 'undefined') {
  const start = () => document.querySelectorAll('[data-frame-account]').forEach(root => { void initAccount(root); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once: true});
  else start();
}
