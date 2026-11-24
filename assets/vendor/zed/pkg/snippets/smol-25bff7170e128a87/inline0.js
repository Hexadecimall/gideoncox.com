
function host() {
    const host = globalThis.zedHost;
    if (!host?.connected()) throw new Error('Local process connector is disconnected');
    return host;
}
export function hostProcessesConnected() { return !!globalThis.zedHost?.connected(); }
export async function hostProcessOpen(json) { return await host().processOpen(JSON.parse(json)); }
export async function hostProcessRead(id) { return await host().processRead(id); }
export async function hostProcessWrite(id, data) { return await host().processWrite(id, data); }
export async function hostProcessEndInput(id) { return await host().processEndInput(id); }
export async function hostProcessKill(id) { return await host().processKill(id); }
export async function hostProcessClose(id) { return await host().processClose(id); }
