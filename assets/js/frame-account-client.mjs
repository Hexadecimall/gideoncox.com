import {resolveCheckoutApi} from './frame-checkout.mjs';

const sessionId = /^cs_(?:live|test)_[A-Za-z0-9]{8,240}$/;
const secret = /^[a-f0-9]{64}$/;
const license = /^fr_[a-f0-9]{64}$/;

export class AccountError extends Error {
  constructor(message, status = 0) { super(message); this.name = 'AccountError'; this.status = status; }
}

export function validateEmail(value) {
  if (typeof value !== 'string' || value.length > 254 || !/^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/.test(value.trim()))
    throw new AccountError('Enter a valid email address.');
  return value.trim();
}

export function validatePassword(value) {
  const size = typeof value === 'string' ? new TextEncoder().encode(value).length : 0;
  if (typeof value !== 'string' || [...value].length < 15 || size > 256)
    throw new AccountError('Use at least 15 characters and no more than 256 UTF-8 bytes.');
  return value;
}

export function validateSession(value) {
  if (!value || typeof value.authenticated !== 'boolean') throw new AccountError('Invalid account response.');
  if (!value.authenticated) return Object.freeze({authenticated: false});
  const account = value.account;
  if (!account || !/^ac_[a-f0-9]{64}$/.test(account.id ?? '') ||
      typeof account.verified !== 'boolean' || !secret.test(value.csrf_token ?? ''))
    throw new AccountError('Invalid account response.');
  return Object.freeze({authenticated: true,
    account: Object.freeze({id: account.id, email: validateEmail(account.email), verified: account.verified}),
    csrf_token: value.csrf_token});
}

export function consumeAccountFragment(view) {
  const fragment = view.location.hash || '';
  if (!fragment) return null;
  view.history.replaceState(null, '', view.location.pathname + view.location.search);
  if (fragment.length > 1024) throw new AccountError('This account link is invalid.');
  const params = new URLSearchParams(fragment.slice(1));
  if (params.getAll('action').length !== 1 || params.getAll('token').length !== 1 ||
      [...params.keys()].some(key => !['action', 'token'].includes(key)) ||
      !['verify', 'reset'].includes(params.get('action')) || !secret.test(params.get('token') ?? ''))
    throw new AccountError('This account link is invalid.');
  return Object.freeze({action: params.get('action'), token: params.get('token')});
}

export function validatePurchase(value) {
  if (!value || !sessionId.test(value.session_id ?? '') || value.kind !== 'paid' ||
      !['active', 'revoked', 'pending'].includes(value.status) || value.currency !== 'USD' ||
      !Number.isSafeInteger(value.amountMinor) || value.amountMinor < 0 || value.amountMinor > 3000)
    throw new AccountError('Invalid purchase response.');
  return Object.freeze({session_id: value.session_id, kind: 'paid', status: value.status,
    amountMinor: value.amountMinor, currency: value.currency});
}

export function validateDownload(value, api, now = Date.now()) {
  if (!value || typeof value.url !== 'string' || value.url.length > 4096 ||
      /[\s\\\u0000-\u001f\u007f]/.test(value.url) ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(value.target ?? '') ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(value.variant ?? '') ||
      !/^[A-Za-z0-9][A-Za-z0-9._+-]{0,79}$/.test(value.version ?? '') ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(value.filename ?? '') || value.filename.includes('..') ||
      !/\.(?:exe|msi|zip|dmg|pkg|deb|rpm|AppImage|tar\.gz|tar\.xz)$/.test(value.filename) ||
      !/^[a-f0-9]{64}$/.test(value.sha256 ?? '') || !Number.isSafeInteger(value.size) ||
      value.size <= 0 || value.size > 8 * 1024 ** 3 || !Number.isSafeInteger(value.expires_at) ||
      value.expires_at <= Math.floor(now / 1000) || value.expires_at > Math.floor(now / 1000) + 120)
    throw new AccountError('Invalid download response.');
  let url;
  try { url = new URL(value.url); } catch { throw new AccountError('Invalid download URL.'); }
  const service = new URL(api);
  const prefix = service.pathname.replace(/\/$/, '') + '/v1/download/';
  if (url.protocol !== 'https:' || url.origin !== service.origin || url.username || url.password || url.hash ||
      !url.pathname.startsWith(prefix) || !/^[a-f0-9]{64}$/.test(url.pathname.slice(prefix.length)) ||
      url.search || /%|\.\./.test(url.pathname)) throw new AccountError('Invalid download URL.');
  return Object.freeze({...value, url: url.href});
}

export class AccountClient {
  #csrf = '';
  #current = Object.freeze({authenticated: false});
  constructor({api, baseUrl = 'https://example.invalid/', fetcher = globalThis.fetch, now = Date.now}) {
    this.api = resolveCheckoutApi(api, baseUrl); this.fetcher = fetcher; this.now = now;
  }
  get current() { return this.#current; }
  get csrf() { return this.#csrf; }
  async request(operation, body = {}, authenticated = true) {
    if (!/^[a-z-]+$/.test(operation)) throw new AccountError('Invalid account request.');
    if (authenticated && (!this.#current.authenticated || !this.#csrf))
      throw new AccountError('Sign in to continue.', 401);
    const headers = {'Content-Type': 'application/json'};
    if (authenticated) headers['X-Frame-CSRF'] = this.#csrf;
    let response;
    try {
      response = await this.fetcher(this.api + '/v1/account/' + operation, {
        method: 'POST', credentials: 'include', redirect: 'error', cache: 'no-store', headers,
        body: JSON.stringify(body), signal: AbortSignal.timeout(30000)
      });
    } catch { throw new AccountError('The account service could not be reached. Try again.'); }
    if (!response.ok) {
      if (response.status === 401) {
        this.#csrf = ''; this.#current = Object.freeze({authenticated: false});
        throw new AccountError('Your session ended. Sign in again.', 401);
      }
      if (response.status === 403) throw new AccountError('This action is not available. Verify your email or sign in again.', 403);
      if (response.status === 409) throw new AccountError(operation === 'license' ?
        'Payment is still processing. Check again shortly.' : 'These details could not be used. Sign in or reset your password.', 409);
      if (response.status === 429) throw new AccountError('Too many requests. Try again shortly.', 429);
      if (response.status === 400) throw new AccountError('The account details were not accepted. Check the fields and try again.', 400);
      throw new AccountError('The account service is unavailable. Try again.', response.status);
    }
    const text = await response.text();
    if (text.length > 65536) throw new AccountError('Invalid account response.');
    try {
      const result = JSON.parse(text);
      if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error();
      return result;
    } catch { throw new AccountError('Invalid account response.'); }
  }
  #setSession(value) {
    this.#current = validateSession(value);
    this.#csrf = this.#current.csrf_token ?? '';
    return this.#current;
  }
  async session() { return this.#setSession(await this.request('session', {}, false)); }
  async login(email, password) {
    return this.#setSession(await this.request('login', {email: validateEmail(email), password: validatePassword(password)}, false));
  }
  async register(email, password) {
    return this.#setSession(await this.request('register', {email: validateEmail(email), password: validatePassword(password)}, false));
  }
  async logout() { await this.request('logout'); this.#csrf = ''; this.#current = Object.freeze({authenticated: false}); }
  async verify(token) {
    if (!secret.test(token ?? '')) throw new AccountError('This verification link is invalid.');
    await this.request('verify', {token}, false); return this.session();
  }
  async forgot(email) { await this.request('forgot-password', {email: validateEmail(email)}, false); }
  async reset(token, password) {
    if (!secret.test(token ?? '')) throw new AccountError('This reset link is invalid.');
    await this.request('reset-password', {token, password: validatePassword(password)}, false);
    this.#csrf = ''; this.#current = Object.freeze({authenticated: false});
  }
  async resend() { await this.request('resend-verification'); }
  async library() {
    const result = await this.request('library');
    if (!Array.isArray(result.purchases) || result.purchases.length > 1000) throw new AccountError('Invalid purchase response.');
    return result.purchases.map(validatePurchase);
  }
  async license(session) {
    if (!sessionId.test(session ?? '')) throw new AccountError('Invalid purchase.');
    const result = await this.request('license', {session_id: session});
    if (result.version !== 1 || !license.test(result.license_key ?? '')) throw new AccountError('Invalid license response.');
    return JSON.stringify({version: 1, license_key: result.license_key}, null, 2) + '\n';
  }
  async downloads() {
    const result = await this.request('downloads');
    if (!Array.isArray(result.downloads) || result.downloads.length > 64) throw new AccountError('Invalid download response.');
    return result.downloads.map(value => validateDownload(value, this.api, this.now()));
  }
}
