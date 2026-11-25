const PREFIX = '/browser-folders';
const MAX_FILE_BYTES = 32 * 1024 * 1024;

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

  available() { return typeof globalThis.showDirectoryPicker === 'function'; }
  async pick() {
    const folder = await globalThis.showDirectoryPicker({ mode: 'readwrite', id: 'zed-project-folder' });
    return this.mount(folder);
  }

  async mount(folder) {
    if (folder.kind !== 'directory' || !safePart(folder.name)) throw new Error('Choose a folder.');
    for (const [path, handle] of this.mounts) {
      if (await folder.isSameEntry(handle)) return path;
    }
    const path = `${PREFIX}/${crypto.randomUUID()}/${folder.name}`;
    this.mounts.set(path, folder);
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

  drainChanges() {
    const paths = [...this.changed];
    this.changed.clear();
    return paths;
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

  async fs(operation, args) {
    const { path } = args;
    switch (operation) {
      case 'metadata': {
        const entry = await this.entry(path);
        if (!entry) return null;
        if (!this.inodes.has(path)) this.inodes.set(path, this.inodes.size + 1);
        const isDirectory = entry.kind === 'directory';
        const file = isDirectory ? null : await entry.getFile();
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
        const paths = [];
        for await (const name of directory.keys()) if (safePart(name)) paths.push(`${path}/${name}`);
        return paths;
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
