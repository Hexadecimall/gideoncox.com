
export async function zed_open_paths(files, directories, multiple, prompt) {
    if (!globalThis.zedBrowserDialogs) throw new Error('Browser file dialogs are unavailable');
    return globalThis.zedBrowserDialogs.openPaths({ files, directories, multiple, prompt });
}
export async function zed_save_path(directory, suggestedName) {
    if (!globalThis.zedBrowserDialogs) throw new Error('Browser file dialogs are unavailable');
    return globalThis.zedBrowserDialogs.savePath(directory, suggestedName);
}
export function zed_go_home() { globalThis.top.location.assign('/'); }
