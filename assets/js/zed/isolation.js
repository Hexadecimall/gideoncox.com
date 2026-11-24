export async function prepareEditorIsolation() {
  if (crossOriginIsolated || !navigator.serviceWorker || window.top !== window) return false;
  // Only reload before opening the workspace and at most once for this navigation.
  const key = 'zed-isolation-reload';
  if (sessionStorage.getItem(key) === location.href) {
    sessionStorage.removeItem(key);
    return false;
  }
  await navigator.serviceWorker.register('/editor/isolation-worker.js', { scope: '/editor/' });
  let timer;
  const active = await Promise.race([
    navigator.serviceWorker.ready.then(() => true),
    new Promise(resolve => { timer = setTimeout(() => resolve(false), 2500); }),
  ]).finally(() => clearTimeout(timer));
  if (!active) return false;
  sessionStorage.setItem(key, location.href);
  location.reload();
  return true;
}
