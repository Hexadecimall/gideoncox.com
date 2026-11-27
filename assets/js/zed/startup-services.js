import { installFileDialogs } from './dialogs.js?v=workspace-controls-1';
import { installNativeTerminal } from './native-terminal.js?v=python-argv-1';
import { installNativeHost } from './native-host.js?v=git-remotes-1';
import { BrowserPython } from './browser-python.js?v=workspace-ready-1';
import { BrowserClangd } from './browser-clangd.js?v=clang-project-options-1';
import { BrowserRust } from './browser-rust.js?v=quickfix-1';
import { BrowserRunBridge } from './browser-run.js?v=clang-project-options-1';
import { BrowserGit } from './browser-git.js?v=git-stash-1';
import { openBrowserDatabase } from './browser-database.js?v=history-1';

async function prepareDatabase(notify) {
  try {
    globalThis.zedDatabase = await openBrowserDatabase(notify);
  } catch (error) {
    console.warn('Could not open Zed database storage.', error);
    notify('Zed could not open browser storage for its history.');
  }
}

async function prepareLma(zed) {
  try {
    const { BrowserLma } = await import('/editor/runtime/lma/client.js?v=qwen35-mtp-1');
    if (typeof zed.lma_worker_event === 'function') {
      globalThis.zedLma = new BrowserLma(
        zed.lma_worker_event, undefined, message => zed.show_database_notice(message),
      );
    }
  } catch (error) {
    console.warn('LMA provider could not load.', error);
  }
}

export async function prepareEditorServices(zed, notifyDatabase) {
  const rust = new BrowserRust(zed, undefined, (root, path) => builds.scheduleRustCheck(root, path));
  const builds = new BrowserRunBridge(zed, undefined, (root, result) => rust.publishCargo(root, result));
  globalThis.zedBrowserGit = new BrowserGit();
  const terminal = installNativeTerminal(builds, zed);
  const host = installNativeHost(terminal, new BrowserPython(zed), new BrowserClangd(zed), rust);
  installFileDialogs(zed, host);

  const [folder] = await Promise.all([
    host.restoreLocalFolder().catch(() => undefined),
    prepareDatabase(notifyDatabase),
    prepareLma(zed),
  ]);
  globalThis.zedInitialFolder = folder;
}
