// Hosted checkout only. Pricing, discounts and trial entitlements belong to the
// merchant/provider; this public configuration must never contain API secrets.
// Stripe: https://docs.stripe.com/payment-links/promotions
// Lemon Squeezy: https://docs.lemonsqueezy.com/guides/developer-guide/taking-payments
import {resolveCheckoutApi, startCheckout} from './frame-checkout.mjs';
const fields = new Set(['enabled', 'provider', 'apiBaseUrl', 'checkoutUrl', 'trialUrl', 'amountMinor', 'currency', 'trialHours']);
const providers = new Set(['stripe', 'lemonsqueezy']);
const initialized = new WeakMap();

export function validateCheckoutUrl(value, provider, live = true) {
  if (typeof value !== 'string' || value.length > 2048 || /[\s\\\u0000-\u001f\u007f]/.test(value))
    throw new Error('Invalid hosted checkout URL.');
  let url;
  try { url = new URL(value); } catch { throw new Error('Invalid hosted checkout URL.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash)
    throw new Error('Checkout must use a trusted HTTPS URL.');
  let allowed;
  if (provider === 'stripe') {
    if (url.hostname !== 'buy.stripe.com' || !/^\/(?:test_)?[A-Za-z0-9]+$/.test(url.pathname))
      throw new Error('Use a Stripe Payment Link.');
    if (live && url.pathname.startsWith('/test_')) throw new Error('Live sales cannot use a test Payment Link.');
    allowed = new Set(['locale', 'prefilled_promo_code', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']);
  } else if (provider === 'lemonsqueezy') {
    if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.lemonsqueezy\.com$/.test(url.hostname) ||
        !/^\/checkout\/buy\/[A-Za-z0-9-]+$/.test(url.pathname))
      throw new Error('Use a shareable Lemon Squeezy checkout URL.');
    allowed = new Set(['checkout[discount_code]', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']);
  } else throw new Error('Choose a supported checkout provider.');
  const seen = new Set();
  for (const [key, content] of url.searchParams) {
    if (!allowed.has(key) || seen.has(key) || content.length > 150 || /[\u0000-\u001f\u007f]/.test(content))
      throw new Error('Unsupported checkout URL parameter.');
    seen.add(key);
    if (key === 'prefilled_promo_code' || key === 'checkout[discount_code]') normalizeDiscountCode(content, provider);
  }
  return url.href;
}

export function validateCommerceConfig(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).some(key => !fields.has(key))) throw new Error('Invalid commerce configuration.');
  if (typeof input.enabled !== 'boolean' || input.trialHours !== 24 ||
      !['provider', 'checkoutUrl', 'trialUrl', 'currency'].every(key => typeof input[key] === 'string'))
    throw new Error('Invalid commerce configuration.');
  if (input.provider && !providers.has(input.provider)) throw new Error('Unsupported checkout provider.');
  if (input.amountMinor !== null && (!Number.isSafeInteger(input.amountMinor) || input.amountMinor < 0 || input.amountMinor > 1_000_000_000))
    throw new Error('Invalid price in minor currency units.');
  if (input.currency && !/^[A-Z]{3}$/.test(input.currency)) throw new Error('Invalid currency.');
  if (input.currency && typeof Intl.supportedValuesOf === 'function' && !Intl.supportedValuesOf('currency').includes(input.currency))
    throw new Error('Unsupported currency.');
  const config = {apiBaseUrl: '', ...input};
  if (typeof config.apiBaseUrl !== 'string') throw new Error('Invalid checkout API.');
  if (config.apiBaseUrl) {
    resolveCheckoutApi(config.apiBaseUrl, 'https://example.invalid/');
    if (config.provider !== 'stripe' || config.amountMinor !== 3000 || config.currency !== 'USD')
      throw new Error('Frame checkout requires the USD 30 one-time price.');
  }
  if (config.checkoutUrl) config.checkoutUrl = validateCheckoutUrl(config.checkoutUrl, config.provider, config.enabled);
  if (config.trialUrl) config.trialUrl = validateCheckoutUrl(config.trialUrl, config.provider, config.enabled);
  if (config.enabled && (!providers.has(config.provider) || (!config.checkoutUrl && !config.apiBaseUrl) || config.amountMinor === null || !config.currency))
    throw new Error('Checkout and price must be configured before opening sales.');
  return Object.freeze(config);
}

export function normalizeDiscountCode(value, provider) {
  if (typeof value !== 'string' || value.length > 64) throw new Error('Discount codes must be at most 64 characters.');
  const code = value.trim();
  if (!/^[A-Za-z0-9_-]*$/.test(code)) throw new Error('Use letters, numbers, underscores or hyphens for the discount code.');
  if (provider === 'stripe' && !/^[A-Za-z0-9]*$/.test(code))
    throw new Error('Stripe discount codes use letters and numbers.');
  return code;
}

export function buildCheckoutUrl(input, code = '', trial = false) {
  const config = validateCommerceConfig(input);
  if (!config.enabled) throw new Error('Sales are not open yet.');
  if (config.apiBaseUrl && !trial) throw new Error('Create a checkout session before opening payment.');
  const address = trial ? config.trialUrl : config.checkoutUrl;
  if (!address) throw new Error('Trial checkout is not available yet.');
  const url = new URL(address);
  const discount = normalizeDiscountCode(code, config.provider);
  const parameter = config.provider === 'stripe' ? 'prefilled_promo_code' : 'checkout[discount_code]';
  // Keep a merchant-configured promotion unless the visitor supplied another.
  if (discount) url.searchParams.set(parameter, discount);
  return url.href;
}

export function formatPrice(input, locale = undefined) {
  const config = validateCommerceConfig(input);
  if (config.amountMinor === null || !config.currency) return 'Price to be announced';
  const formatter = new Intl.NumberFormat(locale, {style: 'currency', currency: config.currency});
  const digits = formatter.resolvedOptions().maximumFractionDigits;
  return formatter.format(config.amountMinor / (10 ** digits));
}

export function resolveConfigUrl(reference, base) {
  if (typeof reference !== 'string' || !reference || reference.length > 1024 ||
      /^[a-z][a-z0-9+.-]*:/i.test(reference) || reference.startsWith('//') || /[\\\s\u0000-\u001f]/.test(reference))
    throw new Error('Commerce configuration must use a local URL.');
  const origin = new URL(base);
  const url = new URL(reference, origin);
  if (url.origin !== origin.origin || !/^https?:$/.test(url.protocol) || url.hash || url.search || !url.pathname.endsWith('.json'))
    throw new Error('Commerce configuration must use a local JSON file.');
  return url.href;
}

function activate(element, address) {
  element.setAttribute('aria-disabled', address ? 'false' : 'true');
  if ('disabled' in element) element.disabled = !address;
  if (address) {
    element.setAttribute('href', address);
    element.setAttribute('rel', 'noopener noreferrer');
    element.removeAttribute('tabindex');
  } else {
    element.removeAttribute('href');
    element.setAttribute('tabindex', '-1');
  }
}

export async function initCommerce(root, {fetcher = globalThis.fetch, baseUrl = root.ownerDocument?.baseURI} = {}) {
  if (initialized.has(root)) return initialized.get(root);
  const task = (async () => {
    const buys = [...root.querySelectorAll('[data-buy-now]')];
    const trials = [...root.querySelectorAll('[data-trial]')];
    const input = root.querySelector('[data-discount-code]');
    const statuses = [...root.querySelectorAll('[data-commerce-status]')];
    const status = text => statuses.forEach(element => { element.textContent = text; });
    let config, busy = false;
    const repaint = () => {
      let code = '';
      try { code = normalizeDiscountCode(input?.value ?? '', config?.provider); }
      catch (error) {
        input?.setCustomValidity?.(error.message);
        [...buys, ...trials].forEach(element => activate(element, ''));
        status(error.message);
        return;
      }
      input?.setCustomValidity?.('');
      buys.forEach(element => activate(element, config?.enabled && !busy ?
        (config.apiBaseUrl ? '#purchase' : buildCheckoutUrl(config, code)) : ''));
      trials.forEach(element => activate(element, config?.enabled && config.trialUrl ? buildCheckoutUrl(config, code, true) : ''));
      status(config?.enabled ? 'Discounts are verified at checkout. The checkout page confirms the final price.' : 'Sales are not open yet.');
    };
    [...buys, ...trials].forEach(element => {
      activate(element, '');
      element.addEventListener('click', async event => {
        if (element.getAttribute('aria-disabled') !== 'false') { event.preventDefault(); return; }
        if (config?.apiBaseUrl && buys.includes(element)) {
          event.preventDefault();
          if (busy) return;
          busy = true; repaint();
          if (input) input.disabled = true;
          status('Opening secure checkout…');
          try {
            const view = root.ownerDocument.defaultView;
            const destination = await startCheckout({api: resolveCheckoutApi(config.apiBaseUrl, baseUrl),
              discount: normalizeDiscountCode(input?.value ?? '', config.provider),
              storage: view.sessionStorage, crypto: view.crypto, fetcher});
            view.location.assign(destination);
          } catch (error) {
            busy = false; repaint();
            if (input) input.disabled = false;
            status(error instanceof Error ? error.message : 'Checkout is unavailable.');
          }
          return;
        }
        if (element.tagName !== 'A') {
          event.preventDefault();
          root.ownerDocument.defaultView.location.assign(element.getAttribute('href'));
        }
      });
    });
    if (input) { input.disabled = true; input.maxLength = 64; input.addEventListener('input', repaint); }
    root.querySelectorAll('[data-commerce-price]').forEach(element => {
      if (!element.textContent.trim()) element.textContent = 'Price to be announced';
    });
    status('Sales are not open yet.');
    try {
      const reference = root.getAttribute('data-frame-commerce') || '/assets/frame/commerce.json';
      const response = await fetcher(resolveConfigUrl(reference, baseUrl), {credentials: 'omit', redirect: 'error', cache: 'no-cache'});
      if (!response.ok) throw new Error('Commerce configuration is unavailable.');
      const body = await response.text();
      if (body.length > 16384) throw new Error('Commerce configuration is too large.');
      config = validateCommerceConfig(JSON.parse(body));
      root.querySelectorAll('[data-commerce-price]').forEach(element => { element.textContent = formatPrice(config); });
      if (input) input.disabled = !config.enabled;
      repaint();
      return config;
    } catch {
      config = undefined;
      [...buys, ...trials].forEach(element => activate(element, ''));
      if (input) input.disabled = true;
      status('Checkout is unavailable. Sales are not open yet.');
      return null;
    }
  })();
  initialized.set(root, task);
  return task;
}

if (typeof document !== 'undefined') {
  const start = () => document.querySelectorAll('[data-frame-commerce]').forEach(root => { void initCommerce(root); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once: true});
  else start();
}
