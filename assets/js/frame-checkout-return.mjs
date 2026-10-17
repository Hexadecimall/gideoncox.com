import {validateCommerceConfig, resolveConfigUrl} from './frame-commerce.mjs';
import {AccountClient} from './frame-account-client.mjs';

export async function initCheckoutReturn(root, {fetcher = globalThis.fetch, view = root.ownerDocument.defaultView} = {}) {
  const status = root.querySelector('[data-payment-status]');
  const check = root.querySelector('[data-check-payment]');
  const download = root.querySelector('[data-download-license]');
  let license = '', busy = false;
  download.disabled = true;
  const run = async () => {
    if (busy) return;
    busy = true; check.disabled = true; download.disabled = true;
    status.textContent = 'Checking payment…';
    try {
      const response = await fetcher(resolveConfigUrl(root.getAttribute('data-frame-checkout'), view.location.href),
        {credentials: 'omit', redirect: 'error', cache: 'no-cache'});
      if (!response.ok) throw new Error('Checkout is unavailable.');
      const text = await response.text();
      if (text.length > 16384) throw new Error('Checkout configuration is invalid.');
      const config = validateCommerceConfig(JSON.parse(text));
      if (!config.enabled || !config.apiBaseUrl) throw new Error('Sales are not open yet.');
      const query = new URL(view.location.href).searchParams;
      if (query.getAll('session_id').length !== 1) throw new Error('This checkout session is invalid.');
      const account = new AccountClient({api: config.apiBaseUrl, baseUrl: view.location.href, fetcher});
      const session = await account.session();
      if (!session.authenticated) throw new Error('Sign in to your Frame account to recover this purchase.');
      if (!session.account.verified) throw new Error('Verify your email before recovering this purchase.');
      license = await account.license(query.get('session_id'));
      status.textContent = 'Payment confirmed. Your license is ready and saved in your account.';
      download.disabled = false;
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : 'Payment could not be checked.';
    } finally { busy = false; check.disabled = false; }
  };
  check.addEventListener('click', () => { void run(); });
  download.addEventListener('click', () => {
    if (!license || download.disabled) return;
    const url = view.URL.createObjectURL(new Blob([license], {type: 'application/json'}));
    const link = root.ownerDocument.createElement('a');
    link.href = url; link.download = 'Frame.frame-license'; link.click();
    view.setTimeout(() => view.URL.revokeObjectURL(url), 1000);
  });
  await run();
}

if (typeof document !== 'undefined') {
  const start = () => document.querySelectorAll('[data-frame-checkout]').forEach(root => { void initCheckoutReturn(root); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once: true});
  else start();
}
