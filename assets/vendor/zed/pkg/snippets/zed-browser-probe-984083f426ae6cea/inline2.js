
const trustKey = 'zed.worktree-trust.v1';
export function browserTrustedPaths() {
    try { return localStorage.getItem(trustKey) ?? '[]'; } catch { return '[]'; }
}
export function saveBrowserTrustedPaths(value) {
    try {
        const paths = new Set([...JSON.parse(browserTrustedPaths()), ...JSON.parse(value)]);
        localStorage.setItem(trustKey, JSON.stringify([...paths]));
    } catch { /* An unavailable store does not affect the current session. */ }
}
export function clearBrowserTrustedPaths() {
    try { localStorage.removeItem(trustKey); return true; } catch { return false; }
}
export function restoredBrowserFolder() { return globalThis.zedInitialFolder ?? null; }
