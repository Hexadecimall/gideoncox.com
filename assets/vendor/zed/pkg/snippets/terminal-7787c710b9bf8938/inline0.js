
function bridge() {
    const value = globalThis.zedNativeTerminal;
    if (!value) throw new Error('Native terminal connector is not available');
    return value;
}
export async function zed_terminal_open(columns, rows) { return await bridge().open({columns, rows}); }
export async function zed_terminal_read(id) { return await bridge().read(id); }
export async function zed_terminal_write(id, bytes) { await bridge().write(id, bytes); }
export async function zed_terminal_resize(id, columns, rows) { await bridge().resize(id, {columns, rows}); }
export async function zed_terminal_close(id) { await bridge().close(id); }
