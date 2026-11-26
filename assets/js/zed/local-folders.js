import { rememberedFolder, rememberFolder } from './folder-history.js?v=1';
import { FolderWatch, directoryRevision, fileRevision } from './folder-watch.js?v=1';

const PREFIX = '/browser-folders';
const MAX_FILE_BYTES = 32 * 1024 * 1024;
const MAX_GIT_SNAPSHOT_BYTES = 16 * 1024 * 1024;
const MAX_GIT_ENTRIES = 8192;
const UNUSED_GIT_DIRECTORIES = new Set(['hooks', 'logs', 'lfs', 'modules', 'worktrees']);
const GIT_REFRESH_FILES = new Set(['.git/HEAD', '.git/index', '.git/packed-refs', '.git/config']);
const WORKTREE_GIT_FILES = new Set(['.gitignore', '.gitattributes', '.gitmodules']);
const ACCESS = { mode: 'readwrite' };

function safePart(part) {
  return part && part !== '.' && part !== '..' && !/[\\/\x00]/.test(part);
}

async function entryAt(directory, name) {
  try { return await directory.getFileHandle(name); }
  catch (error) {
    if (error.name !== 'TypeMismatchError' && error.name !== 'NotFoundError') throw error;
  }
  try { return await directory.getDirectoryHandle(name); }
  catch (error) {
    if (error.name !== 'NotFoundError') throw error;
    return null;
  }
}

async function replaceFile(handle, bytes) {
  const writer = await handle.createWritable();
  try {
    await writer.write(bytes);
    await writer.close();
  } catch (error) {
    await writer.abort().catch(() => {});
    throw error;
  }
}

/** Local directory handles selected in Chromium's picker. */
export class LocalFolders {
  mounts = new Map();
  changed = new Set();
  inodes = new Map();
  watches = new Map();

  available() { return typeof globalThis.showDirectoryPicker === 'function'; }
  async pick() {
    const folder = await globalThis.showDirectoryPicker({ ...ACCESS, id: 'zed-project-folder' });
    const previous = await this.lastSelected();
    const same = previous && await folder.isSameEntry(previous.handle).catch(() => false);
    const root = await this.mount(folder, same ? previous.root : undefined);
    await rememberFolder(root, folder).catch(() => {});
    return root;
  }

  async lastSelected() {
    if (!this.available()) return undefined;
    const record = await rememberedFolder().catch(() => undefined);
    const name = record?.handle?.name;
    const [, mounts, id, last] = typeof record?.root === 'string' ? record.root.split('/') : [];
    if (record?.handle?.kind === 'directory' && safePart(name) && mounts === PREFIX.slice(1)
        && /^[0-9a-f-]{36}$/i.test(id) && last === name && record.root === `${PREFIX}/${id}/${name}`) return record;
  }

  async restore() {
    const record = await this.lastSelected();
    if (record && await record.handle.queryPermission(ACCESS).catch(() => 'denied') === 'granted') {
      return this.mount(record.handle, record.root);
    }
  }

  async reauthorize(record) {
    // This must be the first awaited action in the click handler so the browser sees user activation.
    if (await record.handle.requestPermission(ACCESS) !== 'granted') throw new Error('Folder access was not granted.');
    return this.mount(record.handle, record.root);
  }

  async mount(folder, root) {
    if (folder.kind !== 'directory' || !safePart(folder.name)) throw new Error('Choose a folder.');
    for (const [path, handle] of this.mounts) {
      if (await folder.isSameEntry(handle)) return path;
    }
    const path = root ?? `${PREFIX}/${crypto.randomUUID()}/${folder.name}`;
    this.mounts.set(path, folder);
    const watch = new FolderWatch(path, candidate => this.readRevision(candidate), changed => this.changed.add(changed));
    this.watches.set(path, watch);
    void watch.start(folder);
    return path;
  }

  rootFor(path) {
    if (typeof path !== 'string') return undefined;
    return [...this.mounts.keys()].find(root => path === root || path.startsWith(root + '/'));
  }

  parsed(path) {
    const root = this.rootFor(path);
    if (!root) throw new Error('Choose a local folder before opening its files.');
    const parts = path === root ? [] : path.slice(root.length + 1).split('/');
    if (!parts.every(safePart)) throw new Error('Invalid local folder path.');
    return { parts, directory: this.mounts.get(root) };
  }

  async directory({ directory, parts }, create = false) {
    for (const name of parts) directory = await directory.getDirectoryHandle(name, { create });
    return directory;
  }

  async entry(path) {
    const location = this.parsed(path);
    if (!location.parts.length) return location.directory;
    const name = location.parts.pop();
    try { return await entryAt(await this.directory(location), name); }
    catch (error) {
      if (error.name !== 'NotFoundError' && error.name !== 'TypeMismatchError') throw error;
      return null;
    }
  }

  async read(path) {
    const handle = await this.entry(path);
    if (handle?.kind !== 'file') throw new Error('File does not exist.');
    const file = await handle.getFile();
    this.rememberFile(path, file, true);
    if (file.size > MAX_FILE_BYTES) throw new Error('This file exceeds the 32 MB browser limit.');
    return new Uint8Array(await file.arrayBuffer());
  }

  async write(path, bytes, { allowExisting = true, ignoreExisting = false } = {}) {
    if (bytes.byteLength > MAX_FILE_BYTES) throw new Error('This file exceeds the 32 MB browser limit.');
    const location = this.parsed(path);
    const name = location.parts.pop();
    if (!name) throw new Error('Choose a file inside the folder.');
    const directory = await this.directory(location);
    const existing = await entryAt(directory, name);
    if (existing && ignoreExisting) return;
    if (existing && !allowExisting) throw new Error('File already exists.');
    const handle = await directory.getFileHandle(name, { create: true });
    await replaceFile(handle, bytes);
    this.changed.add(path);
  }

  async drainChanges() {
    await Promise.all([...this.watches.values()].map(watch => watch.poll()));
    const paths = [...this.changed];
    this.changed.clear();
    return paths;
  }

  stopWatching() {
    for (const watch of this.watches.values()) watch.stop();
  }

  rememberFile(path, file, recent = false) {
    this.watches.get(this.rootFor(path))?.remember(path, 'file', fileRevision(file), recent);
  }

  async directoryNames(directory) {
    const names = [];
    for await (const name of directory.keys()) if (safePart(name)) names.push(name);
    return names;
  }

  async readRevision(path) {
    const entry = await this.entry(path);
    if (!entry) return undefined;
    if (entry.kind === 'directory') {
      const names = await this.directoryNames(entry);
      return { type: 'directory', revision: directoryRevision(names) };
    }
    return { type: 'file', revision: fileRevision(await entry.getFile()) };
  }

  async listFiles(path, include, limit) {
    const directory = await this.directory(this.parsed(path));
    const queue = [[path, directory]];
    const files = [];
    const skip = new Set(['.git', '.config', '.venv', '__pycache__', 'target', 'node_modules']);
    for (let index = 0; index < queue.length && index < limit; index++) {
      const [parent, handle] = queue[index];
      for await (const entry of handle.values()) {
        if (!safePart(entry.name) || skip.has(entry.name)) continue;
        const name = `${parent}/${entry.name}`;
        if (entry.kind === 'directory') {
          if (queue.length < limit) queue.push([name, entry]);
        } else if (include(name)) {
          files.push(name);
          if (files.length === limit) return files;
        }
      }
    }
    return files;
  }

  async gitSnapshot(path, includeTree, selectContents) {
    const root = await this.directory(this.parsed(path));
    const metadata = await entryAt(root, '.git');
    if (metadata?.kind !== 'directory') {
      throw new Error('The selected folder needs a Git directory. Linked worktrees are unavailable.');
    }

    const directories = [['.git', metadata]];
    const snapshot = [['.git', null]];
    const diskConfig = new TextEncoder().encode('\n[core]\n\tfilemode = false\n');
    let bytes = 0;
    let trackedPaths;
    if (includeTree) directories.push(['', root]);

    for (let index = 0; index < directories.length; index++) {
      const [parent, directory] = directories[index];
      if (parent === '' && selectContents) trackedPaths = await selectContents(snapshot);
      const worktree = parent !== '.git' && !parent.startsWith('.git/');
      const watchGitDirectory = parent === '.git' || parent === '.git/refs' || parent.startsWith('.git/refs/');
      const gitNames = [];
      for await (const entry of directory.values()) {
        if (watchGitDirectory && safePart(entry.name)) gitNames.push(entry.name);
        if (!safePart(entry.name) || entry.name === '.git' ||
            (parent === '.git' && UNUSED_GIT_DIRECTORIES.has(entry.name))) continue;
        if (snapshot.length >= MAX_GIT_ENTRIES) throw new Error('The repository exceeds the browser Git snapshot limit.');
        const name = parent ? `${parent}/${entry.name}` : entry.name;
        if (entry.kind === 'directory') {
          directories.push([name, entry]);
          snapshot.push([name, null]);
          continue;
        }

        if (worktree && trackedPaths && !trackedPaths.has(name) && !WORKTREE_GIT_FILES.has(entry.name)) {
          // Status needs the filename to report untracked files and apply ignore rules.
          snapshot.push([name, new Uint8Array()]);
          continue;
        }
        const file = await entry.getFile();
        if (GIT_REFRESH_FILES.has(name) || name.startsWith('.git/refs/')) {
          this.rememberFile(`${path}/${name}`, file, GIT_REFRESH_FILES.has(name));
        }
        if (name === '.git/objects/info/alternates' && file.size) {
          throw new Error('Git object stores outside the selected repository are unavailable.');
        }
        const config = name === '.git/config';
        bytes += file.size + (config ? diskConfig.length : 0);
        if (bytes > MAX_GIT_SNAPSHOT_BYTES) throw new Error('The repository exceeds the browser Git snapshot limit.');
        const contents = new Uint8Array(await file.arrayBuffer());
        if (!config) {
          snapshot.push([name, contents]);
          continue;
        }
        // Directory handles expose file contents without executable bits.
        // Override filemode only inside the worker's temporary repository.
        const isolatedConfig = new Uint8Array(contents.length + diskConfig.length);
        isolatedConfig.set(contents);
        isolatedConfig.set(diskConfig, contents.length);
        snapshot.push([name, isolatedConfig]);
      }
      if (watchGitDirectory) {
        this.watches.get(this.rootFor(path))?.remember(`${path}/${parent}`, 'directory', directoryRevision(gitNames));
      }
    }
    return snapshot;
  }

  async fs(operation, args) {
    const { path } = args;
    switch (operation) {
      case 'metadata': {
        const entry = await this.entry(path);
        if (!entry) return null;
        if (!this.inodes.has(path)) this.inodes.set(path, this.inodes.size + 1);
        const isDirectory = entry.kind === 'directory';
        const file = isDirectory ? null : await entry.getFile();
        if (file) this.rememberFile(path, file);
        const modified = file?.lastModified ?? 0;
        return {
          inode: this.inodes.get(path), mtime_secs: Math.floor(modified / 1000),
          mtime_nanos: (modified % 1000) * 1_000_000, len: file?.size ?? 0,
          is_symlink: false, is_dir: isDirectory, is_fifo: false, is_executable: false,
          is_writable: true,
        };
      }
      case 'read_dir': {
        const directory = await this.directory(this.parsed(path));
        const names = await this.directoryNames(directory);
        this.watches.get(this.rootFor(path))?.remember(path, 'directory', directoryRevision(names));
        return names.map(name => `${path}/${name}`);
      }
      case 'read': return this.read(path);
      case 'write': return this.write(path, args.data);
      case 'create_file': return this.write(path, new Uint8Array(), {
        allowExisting: Boolean(args.overwrite), ignoreExisting: Boolean(args.ignore_if_exists),
      });
      case 'create_dir': {
        await this.directory(this.parsed(path), true);
        this.changed.add(path);
        return;
      }
      case 'canonicalize': {
        if (!await this.entry(path)) throw new Error('Path does not exist.');
        return path;
      }
      case 'copy': return this.write(args.target, await this.read(args.source), {
        allowExisting: Boolean(args.overwrite), ignoreExisting: Boolean(args.ignore_if_exists),
      });
      default: throw new Error('This file operation is unavailable for browser-selected folders.');
    }
  }
}
