const WORKER_PATH = '/editor/isolation-worker.js';
const WORKER_SCOPE = '/editor/';
const RETRY_PARAM = '_zed_isolation';

async function hasActiveWorker(workers, url) {
  const script = new URL(WORKER_PATH, url).href;
  const existing = await workers.getRegistration(url.href);
  if (existing?.active?.scriptURL === script) return true;

  const registration = await workers.register(WORKER_PATH, { scope: WORKER_SCOPE });
  const ready = registration.active ? registration : await workers.ready;
  return ready.active?.scriptURL === script;
}

export async function prepareEditorIsolation() {
  if (window.top !== window) return false;
  const url = new URL(location.href);
  if (url.searchParams.has(RETRY_PARAM)) {
    url.searchParams.delete(RETRY_PARAM);
    history.replaceState(history.state, '', url.href);
    return false;
  }
  if (crossOriginIsolated || !navigator.serviceWorker) return false;

  let timer;
  const active = await Promise.race([
    hasActiveWorker(navigator.serviceWorker, url),
    new Promise(resolve => { timer = setTimeout(() => resolve(false), 2500); }),
  ]).finally(() => clearTimeout(timer));
  if (!active) return false;

  // A hard refresh bypasses the worker. A distinct URL makes this a normal
  // navigation, and the marker prevents another retry if isolation is unavailable.
  url.searchParams.set(RETRY_PARAM, '1');
  location.replace(url.href);
  return true;
}
