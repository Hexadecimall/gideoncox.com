export function resolveApiUrl(reference, baseUrl) {
  if (typeof reference !== 'string' || !reference || reference.length > 2048 || /[\\\s\u0000-\u001f\u007f]/.test(reference))
    throw new Error('Service is not configured.');
  if (!reference.startsWith('https://') && !/^\/(?!\/)/.test(reference))
    throw new Error('Service requires HTTPS.');
  const base = new URL(baseUrl);
  const url = new URL(reference, base);
  if (url.username || url.password || url.search || url.hash || /%|\.\./.test(url.pathname) ||
      (url.protocol !== 'https:' && !(url.origin === base.origin && base.protocol === 'http:' &&
        ['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname))))
    throw new Error('Service requires a valid HTTPS endpoint.');
  return url.href.replace(/\/$/, '');
}

export function resolveConfigUrl(reference, base) {
  if (typeof reference !== 'string' || !reference || reference.length > 1024 ||
      /^[a-z][a-z0-9+.-]*:/i.test(reference) || reference.startsWith('//') || /[\\\s\u0000-\u001f]/.test(reference))
    throw new Error('Service configuration must use a local URL.');
  const origin = new URL(base);
  const url = new URL(reference, origin);
  if (url.origin !== origin.origin || !/^https?:$/.test(url.protocol) || url.hash || url.search || !url.pathname.endsWith('.json'))
    throw new Error('Service configuration must use a local JSON file.');
  return url.href;
}

export function validateAccountConfig(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).some(key => !['enabled', 'apiBaseUrl'].includes(key)) ||
      typeof input.enabled !== 'boolean' || typeof input.apiBaseUrl !== 'string')
    throw new Error('Invalid account configuration.');
  if (input.apiBaseUrl) resolveApiUrl(input.apiBaseUrl, 'https://example.invalid/');
  if (input.enabled && !input.apiBaseUrl) throw new Error('Account service is not configured.');
  return Object.freeze({...input});
}
