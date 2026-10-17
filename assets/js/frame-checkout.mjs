import {resolveApiUrl} from './service-config.mjs';
const storageKey = 'frame.checkout.v1';
const proofPattern = /^[a-f0-9]{64}$/;
const sessionPattern = /^cs_(?:live|test)_[A-Za-z0-9]{8,240}$/;
const licensePattern = /^fr_[a-f0-9]{64}$/;

export class CheckoutError extends Error {
  constructor(message, status = 0) { super(message); this.name = 'CheckoutError'; this.status = status; }
}

export function resolveCheckoutApi(reference, baseUrl) {
  try { return resolveApiUrl(reference, baseUrl); }
  catch (error) { throw new CheckoutError(error.message); }
}

async function request(api, path, body, fetcher, csrf) {
  if (!/^[a-f0-9]{64}$/.test(csrf ?? '')) throw new CheckoutError('Sign in with a verified account before checkout.', 401);
  let response;
  try {
    response = await fetcher(api + path, {
      method: 'POST', credentials: 'include', redirect: 'error', cache: 'no-store',
      headers: {'Content-Type': 'application/json', 'X-Site-CSRF': csrf}, body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000)
    });
  } catch { throw new CheckoutError('Checkout could not be reached. Try again.'); }
  if (!response.ok) {
    if (response.status === 401) throw new CheckoutError('Sign in to continue with checkout.', 401);
    if (response.status === 403) throw new CheckoutError('Verify your email or sign in again before checkout.', 403);
    if ([402, 409].includes(response.status)) throw new CheckoutError('Payment is still processing. Check again shortly.', response.status);
    if (response.status === 429) throw new CheckoutError('Too many requests. Try again shortly.', 429);
    if (response.status === 400) throw new CheckoutError('Checkout details were not accepted. Check the discount code and try again.', 400);
    throw new CheckoutError('Checkout is unavailable. Try again.', response.status);
  }
  const text = await response.text();
  if (text.length > 16384) throw new CheckoutError('Checkout returned an invalid response.');
  try {
    const result = JSON.parse(text);
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error();
    return result;
  } catch { throw new CheckoutError('Checkout returned an invalid response.'); }
}

function readPending(storage) {
  let value;
  try { value = JSON.parse(storage.getItem(storageKey) || 'null'); }
  catch { throw new CheckoutError('Checkout needs session storage in this tab.'); }
  if (value === null) return null;
  if (!value || value.version !== 1 || !proofPattern.test(value.proof) ||
      !Number.isSafeInteger(value.createdAt) || typeof value.discount !== 'string' ||
      value.discount.length > 64 || (value.sessionId !== undefined && !sessionPattern.test(value.sessionId)))
    throw new CheckoutError('Saved checkout details are invalid. Start a new checkout.');
  return value;
}

function savePending(storage, pending) {
  try { storage.setItem(storageKey, JSON.stringify(pending)); }
  catch { throw new CheckoutError('Checkout needs session storage in this tab.'); }
}

export async function startCheckout({api, csrf, discount = '', storage, crypto = globalThis.crypto,
  fetcher = globalThis.fetch, now = Date.now}) {
  if (!/^[a-f0-9]{64}$/.test(csrf ?? '')) throw new CheckoutError('Sign in with a verified account before checkout.', 401);
  if (!/^[A-Za-z0-9]{0,64}$/.test(discount)) throw new CheckoutError('Use letters and numbers for the discount code.');
  let pending = readPending(storage);
  const time = now();
  if (!pending || pending.discount !== discount || pending.claimed ||
      time < pending.createdAt || time - pending.createdAt >= 3600000) {
    const proof = [...crypto.getRandomValues(new Uint8Array(32))].map(value => value.toString(16).padStart(2, '0')).join('');
    pending = {version: 1, proof, discount, createdAt: time};
    savePending(storage, pending);
  }
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pending.proof));
  const claimHash = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
  const result = await request(api, '/v1/checkout', {claim_hash: claimHash, discount_code: discount || null}, fetcher, csrf);
  if (!sessionPattern.test(result.session_id) || typeof result.checkout_url !== 'string')
    throw new CheckoutError('Checkout returned an invalid session.');
  let destination;
  try { destination = new URL(result.checkout_url); } catch { throw new CheckoutError('Checkout returned an invalid destination.'); }
  if (destination.protocol !== 'https:' || destination.hostname !== 'checkout.stripe.com' || destination.port ||
      destination.username || destination.password || !/^\/c\/pay\/cs_live_[A-Za-z0-9]+$/.test(destination.pathname) ||
      !result.session_id.startsWith('cs_live_') || !destination.pathname.endsWith('/' + result.session_id) ||
      destination.search || /[\s\\\u0000-\u001f\u007f]/.test(result.checkout_url))
    throw new CheckoutError('Checkout returned an invalid Stripe destination.');
  pending.sessionId = result.session_id;
  savePending(storage, pending);
  return destination.href;
}

export async function claimCheckout({api, csrf, sessionId, storage, fetcher = globalThis.fetch}) {
  if (!sessionPattern.test(sessionId) || !sessionId.startsWith('cs_live_'))
    throw new CheckoutError('This checkout session is invalid.');
  const pending = readPending(storage);
  if (!pending || pending.sessionId !== sessionId)
    throw new CheckoutError('Open checkout in the same tab used for this purchase.');
  const result = await request(api, '/v1/checkout/claim', {session_id: sessionId, proof: pending.proof}, fetcher, csrf);
  if (!licensePattern.test(result.license_key)) throw new CheckoutError('Checkout returned an invalid license.');
  pending.claimed = true;
  savePending(storage, pending);
  return JSON.stringify({version: 1, license_key: result.license_key}, null, 2) + '\n';
}
