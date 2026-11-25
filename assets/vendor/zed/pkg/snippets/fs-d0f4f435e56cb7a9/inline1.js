
export function mountedHostRoot() { return globalThis.zedHost?.root() ?? null; }
export async function hostFsRequest(operation, json) {
    const host = globalThis.zedHost;
    if (!host?.connected()) throw new Error('Local project is disconnected');
    const args = JSON.parse(json);
    if (operation === 'write') args.data = new Uint8Array(args.data);
    const result = await host.fs(operation, args);
    return JSON.stringify(result instanceof Uint8Array ? Array.from(result) : (result ?? null));
}
