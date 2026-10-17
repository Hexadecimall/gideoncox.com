import {AccountError} from './account-client.mjs';
const sessionId = /^cs_(?:live|test)_[A-Za-z0-9]{8,240}$/;
const license = /^fr_[a-f0-9]{64}$/;

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

export class FrameLibrary {
  constructor(account) { this.account = account; }
  async library() {
    const result = await this.account.request('library');
    if (!Array.isArray(result.purchases) || result.purchases.length > 1000) throw new AccountError('Invalid purchase response.');
    return result.purchases.map(validatePurchase);
  }
  async license(session) {
    if (!sessionId.test(session ?? '')) throw new AccountError('Invalid purchase.');
    const result = await this.account.request('license', {session_id: session});
    if (result.version !== 1 || !license.test(result.license_key ?? '')) throw new AccountError('Invalid license response.');
    return JSON.stringify({version: 1, license_key: result.license_key}, null, 2) + '\n';
  }
  async downloads() {
    const result = await this.account.request('downloads');
    if (!Array.isArray(result.downloads) || result.downloads.length > 64) throw new AccountError('Invalid download response.');
    return result.downloads.map(value => validateDownload(value, this.account.api, this.account.now()));
  }
}
