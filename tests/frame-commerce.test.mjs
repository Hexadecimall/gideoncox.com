import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {validateCommerceConfig, validateCheckoutUrl, normalizeDiscountCode, buildCheckoutUrl, formatPrice, resolveConfigUrl, initCommerce} from '../assets/js/frame-commerce.mjs';

const disabled = JSON.parse(await readFile(new URL('../assets/frame/commerce.json', import.meta.url), 'utf8'));
const stripe = {...disabled, enabled: true, provider: 'stripe', checkoutUrl: 'https://buy.stripe.com/Abc123', amountMinor: 1999, currency: 'USD'};
const lemon = {...stripe, provider: 'lemonsqueezy', checkoutUrl: 'https://frame-store.lemonsqueezy.com/checkout/buy/abc-123'};

test('public configuration shows the approved price while checkout remains closed', () => {
  assert.equal(validateCommerceConfig(disabled).enabled, false);
  assert.equal(disabled.provider, 'stripe');
  assert.equal(disabled.amountMinor, 3000);
  assert.equal(disabled.currency, 'USD');
  assert.equal(disabled.checkoutUrl, '');
  assert.equal(disabled.trialUrl, '');
  assert.equal(disabled.trialHours, 24);
  assert.equal(formatPrice(disabled, 'en-US'), '$30.00');
  assert.throws(() => buildCheckoutUrl(disabled), /not open/);
  for (const extra of ['secretKey', 'apiKey', 'clientSecret', 'accessToken', '__proto__']) {
    const input = JSON.parse(JSON.stringify(disabled));
    Object.defineProperty(input, extra, {value: 'not-public', enumerable: true});
    assert.throws(() => validateCommerceConfig(input), /Invalid commerce/);
  }
});

test('configuration requires explicit boolean, valid provider, integer price and currency', () => {
  for (const patch of [{enabled: 'true'}, {provider: 'other'}, {amountMinor: -1}, {amountMinor: 0.1}, {amountMinor: NaN},
    {amountMinor: 1e12}, {currency: 'usd'}, {currency: 'ZZZ'}, {trialHours: 48}, {checkoutUrl: ''}, {provider: ''}, {currency: ''}, {amountMinor: null}])
    assert.throws(() => validateCommerceConfig({...stripe, ...patch}), JSON.stringify(patch));
  for (const value of [null, [], 1, 'checkout']) assert.throws(() => validateCommerceConfig(value));
  assert.equal(validateCommerceConfig(stripe).amountMinor, 1999);
  assert.ok(Object.isFrozen(validateCommerceConfig(stripe)));
});

test('trusted provider URLs reject redirects, credentials, misleading hosts and noncheckout paths', () => {
  for (const address of ['http://buy.stripe.com/Abc123', 'javascript:alert(1)', 'https://buy.stripe.com.evil.example/Abc123',
    'https://buy.stripe.com@evil.example/Abc123', 'https://name:password@buy.stripe.com/Abc123', 'https://buy.stripe.com:444/Abc123',
    'https://buy.stripe.com/Abc123#redirect', 'https://buy.stripe.com/../Abc123?redirect=https://evil.example',
    'https://buy.stripe.com/Abc123?secret_key=hidden', 'https://buy.stripe.com/Abc123?locale=en&locale=de',
    'https://buy.stripe.com/Abc123?prefilled_promo_code=%3Cscript%3E', 'https://buy.stripe.com/Abc123\n', 'https:\\buy.stripe.com/Abc123'])
    assert.throws(() => validateCheckoutUrl(address, 'stripe'), address);
  for (const address of ['https://lemonsqueezy.com/checkout/buy/abc', 'https://evil.example/checkout/buy/abc',
    'https://store.lemonsqueezy.com.evil.example/checkout/buy/abc', 'https://store.lemonsqueezy.com/checkout/?cart=private',
    'https://store.lemonsqueezy.com/checkout/custom/abc?signature=private', 'https://store.lemonsqueezy.com/checkout/buy/abc?test=1'])
    assert.throws(() => validateCheckoutUrl(address, 'lemonsqueezy'), address);
});

test('enabled live Stripe purchase and trial reject test payment links', () => {
  const trialUrl = 'https://buy.stripe.com/test_Abc123';
  assert.throws(() => validateCommerceConfig({...stripe, checkoutUrl: trialUrl}), /test Payment/);
  assert.throws(() => validateCommerceConfig({...stripe, trialUrl}), /test Payment/);
  assert.equal(validateCommerceConfig({...stripe, enabled: false, checkoutUrl: trialUrl}).enabled, false);
});

test('discount is only a provider prefill, encoded once and preserves approved merchant parameters', () => {
  const url = new URL(buildCheckoutUrl({...stripe, checkoutUrl: stripe.checkoutUrl + '?locale=en&utm_source=site'}, 'SAVE20'));
  assert.equal(url.searchParams.get('prefilled_promo_code'), 'SAVE20');
  assert.equal(url.searchParams.get('locale'), 'en');
  assert.equal(url.searchParams.get('utm_source'), 'site');
  const lemonUrl = buildCheckoutUrl(lemon, 'SAVE_20-OFF');
  assert.ok(lemonUrl.includes('checkout%5Bdiscount_code%5D=SAVE_20-OFF'));
  assert.equal(new URL(lemonUrl).searchParams.get('checkout[discount_code]'), 'SAVE_20-OFF');
  assert.equal(normalizeDiscountCode(' SAVE20 ', 'stripe'), 'SAVE20');
  for (const code of ['x'.repeat(65), 'SAVE&redirect=evil', '<script>', 'A B', '%26', '\u0000'])
    assert.throws(() => buildCheckoutUrl(lemon, code));
  assert.throws(() => buildCheckoutUrl(stripe, 'SAVE_20'), /Stripe/);
  assert.equal(normalizeDiscountCode('x'.repeat(64), 'lemonsqueezy').length, 64);
  assert.equal(new URL(buildCheckoutUrl({...stripe, checkoutUrl: stripe.checkoutUrl + '?prefilled_promo_code=MERCHANT'})).searchParams.get('prefilled_promo_code'), 'MERCHANT');
});

test('trial requires a separate configured hosted URL and never invents local entitlements', () => {
  assert.throws(() => buildCheckoutUrl(stripe, '', true), /Trial checkout/);
  const trial = {...stripe, trialUrl: 'https://buy.stripe.com/Trial123'};
  assert.equal(new URL(buildCheckoutUrl(trial, 'SAVE20', true)).pathname, '/Trial123');
  assert.equal(new URL(buildCheckoutUrl(trial)).pathname, '/Abc123');
});

test('price handles actual minor units for two-, zero- and three-decimal currencies', () => {
  assert.equal(formatPrice(stripe, 'en-US'), '$19.99');
  assert.equal(formatPrice({...stripe, currency: 'JPY', amountMinor: 1999}, 'en-US'), '¥1,999');
  assert.match(formatPrice({...stripe, currency: 'KWD', amountMinor: 1999}, 'en-US'), /1\.999/);
  assert.equal(formatPrice({...disabled, amountMinor: null, currency: ''}, 'en-US'), 'Price to be announced');
});

test('product page displays the one-time price without enabling purchases in static markup', async () => {
  const html = await readFile(new URL('../projects/frame/index.html', import.meta.url), 'utf8');
  assert.match(html, /data-commerce-price>\$30\.00<\/span>/);
  assert.match(html, /class="frame-billing">One-time purchase<\/span>/);
  assert.match(html, /data-buy-now aria-disabled="true" tabindex="-1"/);
});

test('configuration fetch is same-origin JSON only, with no query credentials or redirects', () => {
  const base = 'https://example.com/projects/frame/';
  assert.equal(resolveConfigUrl('/assets/frame/commerce.json', base), 'https://example.com/assets/frame/commerce.json');
  for (const reference of ['https://evil.example/config.json', '//evil.example/config.json', 'javascript:alert(1)',
    '/config.json?key=secret', '/config.json#code', '/not-json.html', '\\evil.example\\config.json', '', '/config.json\n'])
    assert.throws(() => resolveConfigUrl(reference, base), reference);
});

class Element {
  constructor(tagName = 'A') { this.tagName = tagName; this.attrs = new Map(); this.events = new Map(); this.textContent = ''; this.value = ''; if (tagName !== 'A') this.disabled = false; }
  setAttribute(key, value) { this.attrs.set(key, value); }
  getAttribute(key) { return this.attrs.get(key) ?? null; }
  removeAttribute(key) { this.attrs.delete(key); }
  addEventListener(name, callback) { this.events.set(name, callback); }
  setCustomValidity(text) { this.validationMessage = text; }
  emit(name) { const event = {prevented: false, preventDefault() { this.prevented = true; }}; this.events.get(name)?.(event); return event; }
}
function fixture(config) {
  const buy = new Element(), trial = new Element('BUTTON'), input = new Element('INPUT'), status = new Element('P'), price = new Element('SPAN');
  const groups = new Map([['[data-buy-now]', [buy]], ['[data-trial]', [trial]], ['[data-discount-code]', [input]], ['[data-commerce-status]', [status]], ['[data-commerce-price]', [price]]]);
  const navigation = [];
  const root = {getAttribute: () => '/assets/frame/commerce.json', querySelectorAll: key => groups.get(key) ?? [], querySelector: key => groups.get(key)?.[0], ownerDocument: {baseURI: 'https://example.com/projects/frame/', defaultView: {location: {assign: url => navigation.push(url)}}}};
  let requests = 0;
  const fetcher = async (url, options) => { requests++; assert.equal(url, 'https://example.com/assets/frame/commerce.json'); assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error'); return {ok: true, text: async () => JSON.stringify(config)}; };
  return {root, buy, trial, input, status, price, navigation, fetcher, requests: () => requests};
}

test('closed commerce displays the approved price and disables purchase controls', async () => {
  const f = fixture(disabled);
  await initCommerce(f.root, {fetcher: f.fetcher});
  assert.equal(f.buy.getAttribute('href'), null);
  assert.equal(f.buy.getAttribute('aria-disabled'), 'true');
  assert.equal(f.trial.disabled, true);
  assert.equal(f.input.disabled, true);
  assert.equal(f.price.textContent, '$30.00');
  assert.equal(f.status.textContent, 'Sales are not open yet.');
  assert.equal(f.buy.emit('click').prevented, true);
  await initCommerce(f.root, {fetcher: f.fetcher});
  assert.equal(f.requests(), 1);
  assert.deepEqual(f.navigation, []);
});

test('configured checkout updates real links and blocks malformed input until corrected', async () => {
  const f = fixture({...lemon, trialUrl: 'https://frame-store.lemonsqueezy.com/checkout/buy/trial-123'});
  await initCommerce(f.root, {fetcher: f.fetcher});
  assert.equal(f.buy.getAttribute('aria-disabled'), 'false');
  assert.equal(f.input.disabled, false);
  assert.equal(f.input.maxLength, 64);
  assert.match(f.status.textContent, /verified at checkout/);
  f.input.value = 'A&B'; f.input.emit('input');
  assert.equal(f.buy.getAttribute('href'), null);
  assert.equal(f.trial.disabled, true);
  assert.ok(f.input.validationMessage);
  f.input.value = 'REAL_20'; f.input.emit('input');
  assert.equal(f.input.validationMessage, '');
  assert.equal(new URL(f.buy.getAttribute('href')).searchParams.get('checkout[discount_code]'), 'REAL_20');
  f.trial.emit('click');
  assert.equal(new URL(f.navigation[0]).pathname, '/checkout/buy/trial-123');
});

test('failed, oversized or malicious config stays disabled and never renders attacker markup', async () => {
  for (const fetcher of [async () => { throw new Error('offline'); }, async () => ({ok: false}),
    async () => ({ok: true, text: async () => 'x'.repeat(16385)}),
    async () => ({ok: true, text: async () => JSON.stringify({...stripe, checkoutUrl: 'javascript:alert(1)'})})]) {
    const f = fixture(stripe);
    assert.equal(await initCommerce(f.root, {fetcher}), null);
    assert.equal(f.buy.getAttribute('href'), null);
    assert.equal(f.trial.disabled, true);
    assert.match(f.status.textContent, /unavailable/);
    assert.deepEqual(f.navigation, []);
  }
});
