import { ConsoleStdout, Directory, File, OpenDirectory, OpenFile, PreopenDirectory, wasi } from '../rust/wasi/index.js';
import { writeFile } from '../terminal-wasi.js';
import WASI from '../rust/wasi/wasi.js?v=utf8-argv-1';

const decoder = new TextDecoder();
export const MAX_GIT_OUTPUT = 32 * 1024 * 1024;

function readlink(path) {
  const { ret } = this.path_lookup(path, 0);
  // Snapshots contain regular entries. WASI's realpath expects EINVAL for them.
  return { ret: ret || wasi.ERRNO_INVAL, data: null };
}

function openPath(...args) {
  const result = OpenDirectory.prototype.path_open.call(this, ...args);
  if (result.fd_obj instanceof OpenDirectory) setupDirectory(result.fd_obj);
  return result;
}

function setupDirectory(directory) {
  // WASI libc checks these inherited rights when implementing access(2).
  directory.fd_fdstat_get = () => {
    const fdstat = new wasi.Fdstat(wasi.FILETYPE_DIRECTORY, 0);
    fdstat.fs_rights_base = BigInt(wasi.RIGHTS_FD_READDIR | wasi.RIGHTS_FD_FILESTAT_GET);
    fdstat.fs_rights_inherited = BigInt(wasi.RIGHTS_FD_READ | wasi.RIGHTS_FD_READDIR | wasi.RIGHTS_FD_WRITE);
    return { ret: wasi.ERRNO_SUCCESS, fdstat };
  };
  directory.path_open = openPath;
  directory.path_readlink = readlink;
}

function validPath(path) {
  return typeof path === 'string' && !path.includes('\0') && !path.includes('\\')
    && path.split('/').every(part => part && part !== '.' && part !== '..');
}

function isMetadata(path) {
  return path === '.git' || path.startsWith('.git/');
}

const pathArguments = new Map([
  ['blame-revision', 0], ['blame-buffer', 0],
  ['read-index', 0], ['read-head', 0], ['read-tree', 1], ['stage', 0], ['set-index-text', 0], ['stage-deletion', 0], ['unstage', 0],
]);
const argCounts = new Map([
  ['init', 1], ['head', 0], ['status', 0], ['read-index', 1], ['read-head', 1], ['read-tree', 2],
  ['switch-branch', 1], ['create-branch', 2], ['rename-branch', 2], ['delete-branch', 3],
  ['branches', 0], ['show', 1], ['read-blob', 1], ['resolve', 1], ['diff', 1], ['diff-stat', 1],
  ['blame-revision', 2], ['blame-buffer', 2],
  ['history', 3], ['search-commits', 4], ['read-commit', 1], ['commit-files', 2],
  ['stage', 1], ['set-index-text', 2], ['stage-deletion', 1], ['unstage', 1], ['commit', 3],
]);

function output() {
  const chunks = [];
  let length = 0;
  const fd = new ConsoleStdout(bytes => {
    length += bytes.length;
    if (length > MAX_GIT_OUTPUT) throw new Error('Git output exceeded the browser limit.');
    chunks.push(bytes.slice());
  });
  return { fd, bytes() {
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return bytes;
  } };
}

export class GitWasiWorktree {
  constructor(module, entries = [], changeWorktree = false) {
    this.module = module;
    this.changeWorktree = changeWorktree;
    this.repository = new PreopenDirectory('/repo', new Map());
    this.root = new PreopenDirectory('/', new Map([['repo', this.repository.dir]]));
    setupDirectory(this.repository);
    setupDirectory(this.root);
    for (const [path, bytes] of entries) this.write(path, bytes);
  }

  write(path, bytes) {
    if (!validPath(path) || (bytes !== null && !(bytes instanceof Uint8Array))) {
      throw new Error('Invalid Git snapshot entry.');
    }
    if (bytes === null) {
      let directory = this.repository.dir;
      for (const part of path.split('/')) {
        const child = directory.contents.get(part) ?? directory.create_entry_for_path(part, true).entry;
        if (!(child instanceof Directory)) throw new Error('Conflicting Git snapshot paths.');
        directory = child;
      }
    } else {
      const { inode_obj: entry } = this.repository.path_lookup(path, 0);
      if (entry instanceof Directory) throw new Error('Conflicting Git snapshot paths.');
      writeFile(this.repository.dir, '/' + path, bytes, !this.changeWorktree && !isMetadata(path));
    }
  }

  *walk(path, entry) {
    if (entry instanceof Directory) {
      yield [path, null];
      for (const [name, value] of entry.contents) yield* this.walk(`${path}/${name}`, value);
    } else if (entry instanceof File) {
      yield [path, entry.data];
    }
  }

  *metadata() {
    const entry = this.repository.dir.contents.get('.git');
    if (entry instanceof Directory) yield* this.walk('.git', entry);
  }

  worktreeChanges(entries) {
    const before = new Map(entries.filter(([path]) => !isMetadata(path)));
    const changed = [];
    let size = 0;
    for (const [name, entry] of this.repository.dir.contents) {
      if (isMetadata(name)) continue;
      for (const [path, bytes] of this.walk(name, entry)) {
        const previous = before.get(path);
        before.delete(path);
        if (bytes === previous || (bytes && previous?.length === bytes.length
          && bytes.every((byte, offset) => byte === previous[offset]))) continue;
        size += bytes?.byteLength ?? 0;
        if (size > MAX_GIT_OUTPUT || changed.length >= 8192) {
          throw new Error('Git checkout changes exceeded the browser limit.');
        }
        changed.push([path, bytes]);
      }
    }
    return { changed, removed: [...before.keys()] };
  }

  async run(operation, args, input = null) {
    const pathIndex = pathArguments.get(operation);
    if (args.length !== argCounts.get(operation)
      || args.some(arg => typeof arg !== 'string' || arg.includes('\0'))
      || (pathIndex !== undefined && (!validPath(args[pathIndex]) || isMetadata(args[pathIndex])))) {
      throw new Error('Invalid Git arguments.');
    }
    const stdout = output();
    const stderr = output();
    const stdin = new OpenFile(new File(input ?? [], { readonly: true }));
    const instanceWasi = new WASI(['zed-git', operation, ...args], ['HOME=/', 'XDG_CONFIG_HOME=/'],
      [stdin, stdout.fd, stderr.fd, this.repository, this.root], { debug: false });
    const instance = await WebAssembly.instantiate(this.module, { wasi_snapshot_preview1: instanceWasi.wasiImport });
    const code = instanceWasi.start(instance);
    if (code === 2) return null;
    if (code !== 0) throw new Error(decoder.decode(stderr.bytes()).trim() || `Git exited with status ${code}.`);
    return stdout.bytes();
  }
}
