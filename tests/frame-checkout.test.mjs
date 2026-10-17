import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {resolveCheckoutApi, startCheckout, claimCheckout} from '../assets/js/frame-checkout.mjs';
import {validateCommerceConfig, buildCheckoutUrl, initCommerce} from '../assets/js/frame-commerce.mjs';
import {initCheckoutReturn} from '../assets/js/frame-checkout-return.mjs';

const api = 'https://commerce.example.invalid';
const csrf = 'a'.repeat(64);
const accountSession = {authenticated: true, account: {id: 'ac_' + 'a'.repeat(64), email: 'buyer@example.invalid', verified: true}, csrf_token: csrf};
const session = 'cs_live_TestCheckout123456';
const destination = `https://checkout.stripe.com/c/pay/${session}#confirmation`;
const licenseKey = 'fr_' + 'b'.repeat(64);
const config = {enabled: true, provider: 'stripe', apiBaseUrl: api, checkoutUrl: '', trialUrl: '', amountMinor: 3000, currency: 'USD', trialHours: 24};
const response = (body, status = 200) => ({ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body)});
function storage() {
  const values = new Map();
  return {getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), saved: () => JSON.parse([...values.values()][0])};
}
const checkoutResponse = () => response({session_id: session, checkout_url: destination});

test('checkout API configuration requires HTTPS and the approved price', () => {
  assert.equal(validateCommerceConfig(config).apiBaseUrl, api);
  assert.equal(resolveCheckoutApi('/commerce/', 'https://example.invalid/projects/frame/'), 'https://example.invalid/commerce');
  assert.equal(resolveCheckoutApi('/commerce', 'http://127.0.0.1/'), 'http://127.0.0.1/commerce');
  for (const address of ['http://commerce.example.invalid', '//evil.example', 'https://name:secret@api.example.invalid',
    'https://api.example.invalid?key=private', 'https://api.example.invalid#private', 'https://api.example.invalid/%2fpath',
    'javascript:alert(1)', 'https://api.example.invalid\n']) assert.throws(() => resolveCheckoutApi(address, 'https://example.invalid/'));
  assert.throws(() => validateCommerceConfig({...config, amountMinor: 4000}));
  assert.throws(() => validateCommerceConfig({...config, provider: 'lemonsqueezy'}));
  assert.throws(() => buildCheckoutUrl(config), /Create a checkout session/);
});

test('checkout saves a random claim proof before contacting the service and retries the same attempt', async () => {
  const saved = storage();
  let calls = 0;
  const fetcher = async (url, options) => {
    calls++;
    assert.equal(url, api + '/v1/checkout');
    assert.equal(options.method, 'POST'); assert.equal(options.credentials, 'include'); assert.equal(options.headers['X-Site-CSRF'], csrf); assert.equal(options.redirect, 'error');
    const body = JSON.parse(options.body), pending = saved.saved();
    assert.match(pending.proof, /^[a-f0-9]{64}$/);
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pending.proof));
    assert.equal(body.claim_hash, Buffer.from(hash).toString('hex'));
    assert.ok(!options.body.includes(pending.proof));
    assert.equal(body.discount_code, 'SAVE5');
    return checkoutResponse();
  };
  assert.equal(await startCheckout({api, csrf, discount: 'SAVE5', storage: saved, fetcher}), destination);
  const proof = saved.saved().proof;
  assert.equal(await startCheckout({api, csrf, discount: 'SAVE5', storage: saved, fetcher}), destination);
  assert.equal(saved.saved().proof, proof); assert.equal(calls, 2);
});

test('checkout refuses unavailable storage before a request and never navigates to an untrusted URL', async () => {
  let requests = 0;
  const broken = {getItem: () => null, setItem: () => { throw new Error('storage disabled'); }};
  await assert.rejects(startCheckout({api, csrf, storage: broken, fetcher: async () => { requests++; }}), /session storage/);
  assert.equal(requests, 0);
  for (const url of ['javascript:alert(1)', 'https://checkout.stripe.com.evil.example/c/pay/' + session,
    'https://name:secret@checkout.stripe.com/c/pay/' + session, 'http://checkout.stripe.com/c/pay/' + session,
    'https://checkout.stripe.com/c/pay/cs_test_Example1234', destination.replace(session, 'cs_live_WrongSession123'),
    destination.replace('#confirmation', '?redirect=elsewhere')]) {
    await assert.rejects(startCheckout({api, csrf, storage: storage(), fetcher: async () => response({session_id: session, checkout_url: url})}), /invalid/);
  }
});

test('only the matching session and proof can request a license and a repeated claim is recoverable', async () => {
  const saved = storage();
  await startCheckout({api, csrf, storage: saved, fetcher: async () => checkoutResponse()});
  const fetcher = async (url, options) => {
    assert.equal(url, api + '/v1/checkout/claim');
    assert.deepEqual(JSON.parse(options.body), {session_id: session, proof: saved.saved().proof});
    return response({license_key: licenseKey});
  };
  const file = await claimCheckout({api, csrf, sessionId: session, storage: saved, fetcher});
  assert.deepEqual(JSON.parse(file), {version: 1, license_key: licenseKey});
  assert.equal(saved.saved().claimed, true);
  assert.equal(await claimCheckout({api, csrf, sessionId: session, storage: saved, fetcher}), file);
  await assert.rejects(claimCheckout({api, csrf, sessionId: 'cs_live_OtherSession1234', storage: saved, fetcher}), /same tab/);
  await assert.rejects(claimCheckout({api, csrf, sessionId: session, storage: storage(), fetcher}), /same tab/);
  const proof = saved.saved().proof;
  await startCheckout({api, csrf, storage: saved, fetcher: async () => checkoutResponse()});
  assert.notEqual(saved.saved().proof, proof);
});

test('pending, malformed and oversized replies do not manufacture a paid license or expose provider bodies', async () => {
  const saved = storage();
  await startCheckout({api, csrf, storage: saved, fetcher: async () => checkoutResponse()});
  for (const fetcher of [async () => response({message: 'provider-private-body'}, 402),
    async () => response({license_key: '<script>injected</script>'}),
    async () => ({ok: true, text: async () => 'x'.repeat(16385)}),
    async () => { throw new Error('provider-private-body'); }]) {
    await assert.rejects(claimCheckout({api, csrf, sessionId: session, storage: saved, fetcher}), error => {
      assert.ok(!error.message.includes('provider-private-body')); return true;
    });
  }
  assert.notEqual(saved.saved().claimed, true);
});

class Element {
  constructor(tagName = 'A') { this.tagName = tagName; this.attrs = new Map(); this.events = new Map(); this.textContent = ''; this.value = ''; if (tagName !== 'A') this.disabled = false; }
  setAttribute(key, value) { this.attrs.set(key, value); }
  getAttribute(key) { return this.attrs.get(key) ?? null; }
  removeAttribute(key) { this.attrs.delete(key); }
  addEventListener(name, callback) { this.events.set(name, callback); }
  setCustomValidity(message) { this.validationMessage = message; }
}

test('API purchase controls prevent duplicate clicks while opening a real hosted checkout', async () => {
  const buy = new Element(), trial = new Element(), input = new Element('INPUT'), status = new Element('P'), price = new Element('SPAN');
  const groups = new Map([['[data-buy-now]', [buy]], ['[data-trial]', [trial]], ['[data-discount-code]', [input]], ['[data-commerce-status]', [status]], ['[data-commerce-price]', [price]]]);
  const navigation = [];
  const root = {getAttribute: () => '/assets/frame/commerce.json', querySelectorAll: key => groups.get(key) ?? [], querySelector: key => groups.get(key)?.[0],
    ownerDocument: {baseURI: 'https://example.invalid/projects/frame/', defaultView: {crypto, sessionStorage: storage(), location: {assign: url => navigation.push(url)}}}};
  let postCount = 0, release;
  const gate = new Promise(resolve => { release = resolve; });
  let entered;
  const started = new Promise(resolve => { entered = resolve; });
  const fetcher = async (url, options) => {
    if (options.method !== 'POST') return response(config);
    if (url.endsWith('/v1/account/session')) return response(accountSession);
    postCount++; entered(); await gate; return checkoutResponse();
  };
  await initCommerce(root, {fetcher});
  const click = () => ({preventDefault() { this.prevented = true; }});
  const first = click(), pending = buy.events.get('click')(first);
  await started;
  const second = click(); await buy.events.get('click')(second);
  assert.equal(postCount, 1); assert.equal(second.prevented, true); assert.equal(input.disabled, true);
  release(); await pending;
  assert.deepEqual(navigation, [destination]); assert.equal(first.prevented, true);
});

test('return page keeps license download disabled until the server confirms payment', async () => {
  const status = new Element('P'), check = new Element('BUTTON'), download = new Element('BUTTON'), saved = storage();
  await startCheckout({api, csrf, storage: saved, fetcher: async () => checkoutResponse()});
  const elements = new Map([['[data-payment-status]', status], ['[data-check-payment]', check], ['[data-download-license]', download]]);
  const view = {sessionStorage: saved, location: {href: `https://example.invalid/projects/frame/checkout/?session_id=${session}&paid=true`}};
  const root = {querySelector: key => elements.get(key), getAttribute: () => '/assets/frame/commerce.json', ownerDocument: {defaultView: view}};
  await initCheckoutReturn(root, {view, fetcher: async (url, options) => url.endsWith('/v1/account/session') ? response(accountSession) : options.method === 'POST' ? response({}, 409) : response(config)});
  assert.equal(download.disabled, true); assert.match(status.textContent, /still processing/);
  await initCheckoutReturn(root, {view, fetcher: async (url, options) => url.endsWith('/v1/account/session') ? response(accountSession) : options.method === 'POST' ? response({version: 1, license_key: licenseKey}) : response(config)});
  assert.equal(download.disabled, false); assert.match(status.textContent, /Payment confirmed/);
});

test('purchase return page keeps shared navigation, excludes indexing and starts without a usable download', async () => {
  const html = await readFile(new URL('../projects/frame/checkout/index.html', import.meta.url), 'utf8');
  assert.match(html, /name="robots" content="noindex, nofollow"/);
  assert.match(html, /name="referrer" content="no-referrer"/);
  assert.match(html, /data-download-license disabled/);
  assert.match(html, /href="\/projects\/frame\/"/);
  assert.match(html, /assets\/js\/quote\.js/);
  assert.ok(!/license_key\s*[:=]/.test(html));
});
