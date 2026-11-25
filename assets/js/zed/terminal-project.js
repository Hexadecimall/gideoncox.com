import { createProjectChannel, projectChannel, RESPONSE_BYTES } from '../terminal/project-ipc.js?v=1';
import { patternMatch } from '../terminal/shell.js?v=project-fs-1';
import { pack } from '../terminal/wasm.js?v=project-fs-1';
import { BROWSER_ROOT, isBrowserProject } from './paths.js';

function within(root, path) {
  return typeof path === 'string' && (path === root || path.startsWith(`${root}/`));
}

export class BrowserTerminalProject {
  constructor(zed) {
    this.zed = zed;
    this.queue = Promise.resolve();
  }

  mount(cwd) {
    const root = globalThis.zedLocalFolders?.rootFor(cwd) ?? BROWSER_ROOT;
    const directory = within(root, cwd) && (root !== BROWSER_ROOT || isBrowserProject(cwd)) ? cwd : root;
    return { root, cwd: directory, buffer: createProjectChannel() };
  }

  async fs(root, operation, args) {
    if (root !== BROWSER_ROOT && globalThis.zedLocalFolders?.rootFor(root) !== root) {
      throw new Error('The browser folder is disconnected.');
    }
    if (!within(root, args[0])) throw new Error('Path is outside the open project.');
    if (operation === 'paths') return this.glob(root, args[0]);
    return JSON.parse(await this.zed.terminal_project_fs(root, operation, JSON.stringify(args)));
  }

  async glob(root, pattern) {
    if (pattern === root) return [root];
    const segments = pattern.slice(root.length + 1).split('/');
    let directories = [root];
    for (const [index, segment] of segments.entries()) {
      const entries = [];
      for (const directory of directories) {
        const children = await this.fs(root, 'list', [directory, segment.startsWith('.') ? '1' : '0']);
        for (let i = 0; i < children.length; i += 2) {
          const candidate = children[i];
          if (children[i + 1] !== 'd' && index < segments.length - 1) continue;
          if (patternMatch(segment, candidate.slice(directory.length + 1))) entries.push(candidate);
          if (entries.length > 8192) throw new Error('Too many matching files.');
        }
      }
      directories = entries;
      if (!directories.length) break;
    }
    return directories;
  }

  reply(mount, operation, args, active) {
    const channel = projectChannel(mount.buffer);
    this.queue = this.queue.then(async () => {
      if (!active()) return;
      let response;
      try {
        response = pack(['0', ...await this.fs(mount.root, operation, args)]);
        if (response.length > RESPONSE_BYTES) throw new Error('Project filesystem response is too large.');
      } catch (error) {
        response = pack(['1', `${error?.message ?? error}`.slice(0, 4096)]);
      }
      if (active()) channel.reply(response);
    });
  }

  open(mount, path) {
    if (!within(mount.root, path)) throw new Error('Path is outside the open project.');
    return this.zed.open_file(path);
  }
}
