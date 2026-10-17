import {FrameLibrary, validatePurchase, validateDownload} from '../assets/js/frame-library-client.mjs';
import {validateAccountConfig} from '../assets/js/service-config.mjs';
import {redirectAccount} from '../assets/js/account-redirect.mjs';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {AccountClient, consumeAccountFragment, validateSession, validatePassword} from '../assets/js/account-client.mjs';
import {initAccount} from '../assets/js/account.mjs';
import {initCommerce} from '../assets/js/frame-commerce.mjs';
import {startCheckout} from '../assets/js/frame-checkout.mjs';

const api = 'https://commerce.example.invalid';
const hex = character => character.repeat(64);
const csrf = hex('a'), token = hex('b'), sessionId = 'cs_live_AccountPurchase1234';
const signed = verified => ({authenticated: true, account: {id: 'ac_' + hex('c'), email: 'buyer@example.invalid', verified}, csrf_token: csrf});
const config = {enabled: true, provider: 'stripe', apiBaseUrl: api, checkoutUrl: '', trialUrl: '', amountMinor: 3000, currency: 'USD', trialHours: 24};
const purchase = {session_id: sessionId, kind: 'paid', status: 'active', amountMinor: 3000, currency: 'USD'};
const download = (id = 'd') => ({version: '0.2.10', target: 'windows-x86_64', variant: 'launcher', filename: 'frame-windows-x86_64.msi',
  sha256: hex('f'), size: 12345678, url: api + '/v1/download/' + hex(id), expires_at: Math.floor(Date.now() / 1000) + 120});
const reply = (value, status = 200) => ({ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(value)});
const settle = () => new Promise(resolve => setImmediate(resolve));

test('cookie sessions bootstrap without CSRF and authenticated requests use an in-memory token', async () => {
  const calls = [];
  const client = new AccountClient({api, fetcher: async (url, options) => {
    calls.push({url, options});
    assert.equal(options.credentials, 'include'); assert.equal(options.redirect, 'error'); assert.equal(options.cache, 'no-store');
    if (url.endsWith('/session')) { assert.ok(!options.headers['X-Site-CSRF']); return reply(signed(true)); }
    assert.equal(options.headers['X-Site-CSRF'], csrf); return reply({purchases: [purchase]});
  }});
  assert.equal((await client.session()).account.verified, true);
  assert.deepEqual(await new FrameLibrary(client).library(), [purchase]);
  assert.equal(client.csrf, csrf); assert.equal(calls.length, 2);
  assert.deepEqual(Object.keys(client).sort(), ['api', 'fetcher', 'now']);
});

test('account validation keeps exact Unicode passwords and rejects malformed sessions and purchases', () => {
  const password = '  ' + '🔑'.repeat(15) + '  ';
  assert.equal(validatePassword(password), password);
  for (const value of ['short', '🔑'.repeat(14), '🔑'.repeat(65), null]) assert.throws(() => validatePassword(value));
  for (const value of [{authenticated: 'yes'}, {...signed(true), csrf_token: '<script>'},
    {...signed(true), account: {...signed(true).account, email: '<script>@example.invalid'}},
    {...signed(true), account: {...signed(true).account, id: '../other'}}]) assert.throws(() => validateSession(value));
  for (const status of ['active', 'pending', 'revoked']) assert.equal(validatePurchase({...purchase, status}).status, status);
  for (const patch of [{status: 'paid'}, {currency: 'EUR'}, {amountMinor: 4000}, {session_id: '<script>'}])
    assert.throws(() => validatePurchase({...purchase, ...patch}));
});

test('verification and reset fragments are removed before any token is processed', () => {
  for (const action of ['verify', 'reset']) {
    let stripped = '';
    const view = {location: {hash: `#action=${action}&token=${token}`, pathname: '/account/', search: ''},
      history: {replaceState: (_state, _title, path) => { stripped = path; }}};
    assert.deepEqual(consumeAccountFragment(view), {action, token});
    assert.equal(stripped, '/account/');
  }
  for (const hash of [`#action=verify&token=${token}&token=${token}`, '#action=other&token=bad', `#action=reset&token=${token}&next=elsewhere`, '#token=bad']) {
    let stripped = false;
    assert.throws(() => consumeAccountFragment({location: {hash, pathname: '/account/', search: ''},
      history: {replaceState: () => { stripped = true; }}}));
    assert.equal(stripped, true);
  }
});

test('account actions use the contract and reset/logout discard the current CSRF token', async () => {
  const calls = [];
  const client = new AccountClient({api, fetcher: async (url, options) => {
    calls.push({path: url.slice(api.length), body: JSON.parse(options.body), options});
    return reply(url.endsWith('/login') || url.endsWith('/register') || url.endsWith('/session') ? signed(false) : {ok: true});
  }});
  await client.register('buyer@example.invalid', 'a long password here'); await client.resend();
  await client.verify(token); await client.forgot('buyer@example.invalid'); await client.reset(token, 'another long password');
  assert.equal(client.current.authenticated, false); assert.equal(client.csrf, '');
  await assert.rejects(new FrameLibrary(client).library(), /Sign in/);
  await client.login('buyer@example.invalid', 'another long password'); await client.logout();
  assert.equal(client.current.authenticated, false); assert.equal(client.csrf, '');
  assert.deepEqual(calls.find(value => value.path.endsWith('/reset-password')).body, {token, password: 'another long password'});
  assert.ok(!calls.find(value => value.path.endsWith('/reset-password')).options.headers['X-Site-CSRF']);
});

test('purchase recovery is server-owned and does not need browser storage or a checkout proof', async () => {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push(url);
    if (url.endsWith('/session')) return reply(signed(true));
    if (url.endsWith('/library')) return reply({purchases: [purchase]});
    assert.deepEqual(JSON.parse(options.body), {session_id: sessionId});
    return reply({version: 1, license_key: 'fr_' + hex('e')});
  };
  for (let browserRestart = 0; browserRestart < 2; browserRestart++) {
    const client = new AccountClient({api, fetcher}); await client.session();
    assert.deepEqual(await new FrameLibrary(client).library(), [purchase]);
    assert.equal(JSON.parse(await new FrameLibrary(client).license(sessionId)).license_key, 'fr_' + hex('e'));
  }
  assert.equal(calls.filter(value => value.endsWith('/library')).length, 2);
});

test('download validation accepts only bounded HTTPS capabilities on the configured service', () => {
  assert.equal(validateDownload(download(), api).filename, download().filename);
  for (const url of ['javascript:alert(1)', api + '/public/frame.zip', api + '/v1/download/' + hex('d') + '?token=extra',
    api + '/v1/download/' + hex('d') + '#fragment', 'https://other.example.invalid/v1/download/' + hex('d'),
    'http://commerce.example.invalid/v1/download/' + hex('d'), api + '/v1/download/%2e%2e'])
    assert.throws(() => validateDownload({...download(), url}, api), url);
  for (const patch of [{sha256: 'bad'}, {filename: '../frame.exe'}, {size: -1}, {target: '<script>'},
    {expires_at: Math.floor(Date.now() / 1000) - 1}, {expires_at: Math.floor(Date.now() / 1000) + 3601}])
    assert.throws(() => validateDownload({...download(), ...patch}, api));
});

test('server failure bodies and credentials never become account error text', async () => {
  for (const fetcher of [async () => reply({error: 'private-provider-body'}, 500),
    async () => { throw new Error('private-provider-body'); }, async () => ({ok: true, text: async () => 'x'.repeat(65537)})]) {
    const client = new AccountClient({api, fetcher});
    await assert.rejects(client.session(), error => { assert.ok(!error.message.includes('private-provider-body')); return true; });
  }
  const client = new AccountClient({api, fetcher: async () => reply({error: 'private'}, 401)});
  await assert.rejects(client.session(), /Sign in again/); assert.equal(client.csrf, '');
});

class Element {
  constructor(tagName = 'BUTTON') { this.tagName = tagName.toUpperCase(); this.children = []; this.attrs = new Map(); this.events = new Map(); this.textContent = ''; this.value = ''; this.disabled = false; this.hidden = false; }
  setAttribute(key, value) { this.attrs.set(key, String(value)); }
  getAttribute(key) { return this.attrs.get(key) ?? null; }
  removeAttribute(key) { this.attrs.delete(key); }
  addEventListener(name, callback) { this.events.set(name, callback); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = [...children]; }
  emit(name) { const event = {preventDefault() { this.prevented = true; }}; this.events.get(name)?.(event); return event; }
  click() { this.emit('click'); }
}
const walk = element => [element, ...element.children.flatMap(walk)];

function fixture({session = {authenticated: false}, hash = '', overrides = {}, configured = true} = {}) {
  const fields = new Map();
  for (const name of ['account-status', 'account-auth', 'account-forgot', 'account-reset', 'account-signed-in', 'auth-title',
    'auth-submit', 'auth-password', 'auth-email', 'forgot-email', 'reset-password', 'account-email', 'account-verified',
    'resend-verification', 'account-library', 'account-purchases', 'account-downloads', 'account-logout', 'refresh-library']) {
    fields.set(name, new Element(name.endsWith('password') || name.endsWith('email') ? 'INPUT' :
      ['auth-submit', 'resend-verification', 'account-logout', 'refresh-library'].includes(name) ? 'BUTTON' : 'DIV'));
  }
  const modes = ['login', 'register', 'forgot', 'login'].map(mode => { const element = new Element(); element.setAttribute('data-account-mode', mode); return element; });
  const calls = [], navigation = [], stripped = [];
  const view = {location: {href: 'https://example.invalid/account/' + hash,
    pathname: '/account/', search: '', hash, assign: url => navigation.push(url)},
    history: {replaceState: (_state, _title, path) => { stripped.push(path); view.location.hash = ''; view.location.href = 'https://example.invalid' + path; }},
    URL: {createObjectURL: () => 'blob:license', revokeObjectURL() {}}, setTimeout() {}};
  const document = {defaultView: view, createElement: name => new Element(name)};
  const root = {ownerDocument: document, getAttribute: () => '../assets/account.json',
    querySelector: selector => fields.get(selector.slice(6, -1)),
    querySelectorAll: selector => selector === '[data-account-mode]' ? modes :
      [...fields.values(), ...modes].flatMap(walk).filter(value => ['BUTTON', 'INPUT'].includes(value.tagName))};
  const fetcher = async (url, options) => {
    assert.equal(view.location.hash, '', 'Account fragment must be stripped before fetching');
    calls.push({url, options});
    if (options.method !== 'POST') return reply({enabled: configured, apiBaseUrl: configured ? api : ''});
    const operation = url.split('/').at(-1);
    if (overrides[operation]) return overrides[operation](url, options);
    if (['session', 'login'].includes(operation)) return reply(session);
    if (operation === 'register') return reply(signed(false));
    if (operation === 'library') return reply({purchases: []});
    if (operation === 'downloads') return reply({downloads: []});
    return reply({ok: true});
  };
  return {root, fields, modes, calls, view, fetcher, navigation, stripped};
}

test('unconfigured account page remains honest and all submissions stay disabled', async () => {
  const f = fixture({configured: false});
  assert.equal(await initAccount(f.root, {fetcher: f.fetcher}), null);
  assert.equal(f.fields.get('auth-submit').disabled, true);
  assert.match(f.fields.get('account-status').textContent, /not available yet/);
  assert.equal(f.calls.length, 1);
  f.fields.get('account-auth').emit('submit'); await settle(); assert.equal(f.calls.length, 1);
});

test('account UI handles anonymous, unverified and verified sessions without fake purchases', async () => {
  for (const session of [{authenticated: false}, signed(false), signed(true)]) {
    const f = fixture({session}); await initAccount(f.root, {fetcher: f.fetcher});
    assert.equal(f.fields.get('account-auth').hidden, session.authenticated);
    assert.equal(f.fields.get('account-signed-in').hidden, !session.authenticated);
    assert.equal(f.calls.some(value => value.url.endsWith('/library')), !!session.account?.verified);
    if (session.account?.verified) assert.equal(f.fields.get('account-purchases').children[0].textContent, 'No purchases yet.');
  }
});

test('verification processes only the stripped fragment token and reset revokes the local session', async () => {
  const verified = fixture({hash: '#action=verify&token=' + token, session: signed(true)});
  await initAccount(verified.root, {fetcher: verified.fetcher});
  assert.equal(verified.stripped.length, 1);
  assert.equal(JSON.parse(verified.calls.find(value => value.url.endsWith('/verify')).options.body).token, token);
  const reset = fixture({hash: '#action=reset&token=' + token, session: signed(true)});
  const client = await initAccount(reset.root, {fetcher: reset.fetcher});
  assert.equal(reset.fields.get('account-reset').hidden, false);
  reset.fields.get('reset-password').value = 'the new password here'; reset.fields.get('account-reset').emit('submit'); await settle();
  assert.equal(client.current.authenticated, false); assert.equal(reset.fields.get('reset-password').value, '');
  assert.equal(reset.fields.get('account-auth').hidden, false);
});

test('pending account submission blocks duplicate requests and clears password fields', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const f = fixture({session: signed(true), overrides: {login: async () => { await gate; return reply(signed(true)); }}});
  await initAccount(f.root, {fetcher: f.fetcher});
  f.fields.get('auth-email').value = 'buyer@example.invalid'; f.fields.get('auth-password').value = 'the password is long';
  f.fields.get('account-auth').emit('submit'); f.fields.get('account-auth').emit('submit');
  assert.equal(f.calls.filter(value => value.url.endsWith('/login')).length, 1); assert.equal(f.fields.get('auth-submit').disabled, true);
  release(); await settle(); assert.equal(f.fields.get('auth-password').value, '');
});

test('installer buttons renew a capability and match exact installer identity before navigation', async () => {
  let count = 0;
  const f = fixture({session: signed(true), overrides: {library: async () => reply({purchases: [purchase]}),
    downloads: async () => reply({downloads: [download(count++ ? 'e' : 'd')]})}});
  await initAccount(f.root, {fetcher: f.fetcher});
  const row = f.fields.get('account-downloads').children[0];
  const button = row.children.find(value => value.tagName === 'BUTTON');
  assert.equal(button.textContent, 'Download MSI');
  assert.ok(row.children.some(value => value.textContent === download().filename));
  assert.equal(button.getAttribute('href'), null); assert.deepEqual(f.navigation, []);
  button.emit('click'); await settle(); assert.equal(count, 2);
  assert.deepEqual(f.navigation, [api + '/v1/download/' + hex('e')]);
});

test('changed installer and malformed service responses never become executable links', async () => {
  let count = 0;
  const f = fixture({session: signed(true), overrides: {library: async () => reply({purchases: [purchase]}),
    downloads: async () => reply({downloads: [{...download(), sha256: count++ ? hex('a') : hex('f')}]})}});
  await initAccount(f.root, {fetcher: f.fetcher});
  f.fields.get('account-downloads').children[0].children.find(value => value.tagName === 'BUTTON').emit('click'); await settle();
  assert.deepEqual(f.navigation, []); assert.match(f.fields.get('account-status').textContent, /changed/);
  const broken = fixture({overrides: {session: async () => ({ok: true, text: async () => 'x'.repeat(65537)})}});
  assert.equal(await initAccount(broken.root, {fetcher: broken.fetcher}), null);
  assert.equal(broken.fields.get('auth-submit').disabled, true);
});

test('installer service failure keeps purchases, license recovery, refresh and sign-out usable', async () => {
  const f = fixture({session: signed(true), overrides: {library: async () => reply({purchases: [purchase]}),
    downloads: async () => reply({}, 503), license: async () => reply({version: 1, license_key: 'fr_' + hex('e')})}});
  const client = await initAccount(f.root, {fetcher: f.fetcher});
  assert.equal(client.current.authenticated, true);
  assert.equal(f.fields.get('account-logout').disabled, false); assert.equal(f.fields.get('refresh-library').disabled, false);
  const licenseButton = f.fields.get('account-purchases').children[0].children.find(value => value.tagName === 'BUTTON');
  assert.equal(licenseButton.disabled, false);
  assert.match(f.fields.get('account-downloads').children[0].textContent, /downloads are unavailable/);
  licenseButton.emit('click'); await settle();
  assert.ok(f.calls.some(value => value.url.endsWith('/license')));
  assert.equal(f.fields.get('account-logout').disabled, false);
});

test('initial library failure keeps a valid session available for retry or sign-out', async () => {
  const f = fixture({session: signed(true), overrides: {library: async () => reply({}, 503)}});
  const client = await initAccount(f.root, {fetcher: f.fetcher});
  assert.equal(client.current.authenticated, true);
  assert.equal(f.fields.get('account-logout').disabled, false); assert.equal(f.fields.get('refresh-library').disabled, false);
  assert.match(f.fields.get('account-status').textContent, /unavailable/);
});

test('checkout rejects a missing CSRF session before contacting the server', async () => {
  let requests = 0;
  await assert.rejects(startCheckout({api, storage: {}, fetcher: async () => { requests++; }}), /verified account/);
  assert.equal(requests, 0);
});

test('purchase controls require a verified cookie session and send anonymous users to their account', async () => {
  for (const session of [{authenticated: false}, signed(false), signed(true)]) {
    const buy = new Element('A'), trial = new Element('A'), input = new Element('INPUT'), status = new Element('P'), price = new Element('SPAN');
    const groups = new Map([['[data-buy-now]', [buy]], ['[data-trial]', [trial]], ['[data-discount-code]', [input]],
      ['[data-commerce-status]', [status]], ['[data-commerce-price]', [price]]]);
    const root = {getAttribute: () => '/assets/frame/commerce.json', querySelectorAll: key => groups.get(key) ?? [],
      querySelector: key => groups.get(key)?.[0], ownerDocument: {baseURI: 'https://example.invalid/projects/frame/', defaultView: {}}};
    const fetcher = async (url, options) => {
      if (!options.method) return reply(config);
      assert.equal(url, api + '/v1/account/session'); assert.equal(options.credentials, 'include'); return reply(session);
    };
    await initCommerce(root, {fetcher});
    assert.equal(buy.getAttribute('href'), session.account?.verified ? '#purchase' : 'https://example.invalid/account/');
    assert.equal(input.disabled, !session.account?.verified);
    assert.equal(trial.getAttribute('href'), null);
  }
});

test('failed verification keeps sign-in and resend available instead of disabling the account page', async () => {
  const f = fixture({hash: '#action=verify&token=' + token, session: signed(false), overrides: {verify: async () => reply({}, 400)}});
  assert.ok(await initAccount(f.root, {fetcher: f.fetcher}));
  assert.equal(f.fields.get('resend-verification').disabled, false);
  assert.match(f.fields.get('account-status').textContent, /not accepted/);
});

test('account page keeps the exact shared header, private forms and no public installer or token state', async () => {
  const [html, product, source, client] = await Promise.all(['account/index.html', 'projects/frame/index.html',
    'assets/js/account.mjs', 'assets/js/account-client.mjs'].map(path => readFile(new URL('../' + path, import.meta.url), 'utf8')));
  const header = text => text.match(/<header\b[\s\S]*?<\/header>/)[0].replace(/(?:\.\.\/)+/g, '/');
  assert.equal(header(html), header(product));
  assert.match(html, /name="referrer" content="no-referrer"/); assert.match(html, /name="robots" content="noindex, nofollow"/);
  assert.match(product, /href="\/account\/">Account<\/a>/);
  assert.equal((html.match(/account\.mjs/g) || []).length, 1);
  assert.doesNotMatch(source + client, /localStorage|sessionStorage|innerHTML|document\.cookie/);
  assert.doesNotMatch(html, /href="[^"\s]*\.(?:exe|msi|zip|dmg|pkg|deb)"/);
});

test('site accounts initialize independently of Frame sales, prices and provider settings', async () => {
  assert.deepEqual(validateAccountConfig({enabled: true, apiBaseUrl: api}), {enabled: true, apiBaseUrl: api});
  for (const invalid of [{enabled: true, apiBaseUrl: ''}, {enabled: true, apiBaseUrl: 'http://api.example.invalid'},
      {enabled: true, apiBaseUrl: api, secret: 'not-public'}, {enabled: 'true', apiBaseUrl: api}])
    assert.throws(() => validateAccountConfig(invalid));
  const f = fixture({session: signed(true)});
  const account = await initAccount(f.root, {fetcher: f.fetcher});
  assert.equal(account.current.authenticated, true);
  assert.equal(f.calls[0].url, 'https://example.invalid/assets/account.json');
  assert.ok(f.calls.every(call => !call.url.includes('/frame/commerce.json')));
});

test('old account links keep verification fragments and cannot redirect off-site', () => {
  for (const hash of ['#action=verify&token=' + token, '#action=reset&token=' + token, '']) {
    let redirected;
    redirectAccount({location: {href: 'https://example.invalid/projects/frame/account/?next=https://other.example.invalid',
      hash, replace: value => { redirected = value; }}});
    assert.equal(redirected, 'https://example.invalid/account/' + hash);
  }
});
