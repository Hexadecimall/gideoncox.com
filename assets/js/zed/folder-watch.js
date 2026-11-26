const MAX_TRACKED_PATHS = 8192;
const RECENT_FILES = 16;
const BACKGROUND_PATHS_PER_POLL = 24;

function eventPath(root, parts) {
  if (!Array.isArray(parts) || parts.some(part => typeof part !== 'string' || !part ||
      part === '.' || part === '..' || /[\\/\x00]/.test(part))) return undefined;
  return parts.length ? `${root}/${parts.join('/')}` : root;
}

export function fileRevision(file) {
  return `${file.lastModified}:${file.size}`;
}

export function directoryRevision(names) {
  return [...names].sort().join('\0');
}

export class FolderWatch {
  constructor(root, readRevision, onChange) {
    this.root = root;
    this.readRevision = readRevision;
    this.onChange = onChange;
    this.paths = new Map();
    this.recent = new Set();
    this.observer = undefined;
    this.observing = false;
  }

  async start(handle) {
    if (typeof globalThis.FileSystemObserver !== 'function') return;
    try {
      const observer = new globalThis.FileSystemObserver(records => {
        if (this.observer !== observer) return;
        for (const record of records) {
          if (record.type === 'unknown' || record.type === 'errored') {
            this.stop();
            return;
          }
          const path = eventPath(this.root, record.relativePathComponents);
          if (path && (path !== this.root || record.type === 'disappeared')) this.onChange(path);
          if (record.type === 'moved') {
            const oldPath = eventPath(this.root, record.relativePathMovedFrom);
            if (oldPath) this.onChange(oldPath);
          }
        }
      });
      this.observer = observer;
      await observer.observe(handle, { recursive: true });
      this.observing = this.observer === observer;
    } catch {
      this.stop();
    }
  }

  stop() {
    this.observer?.disconnect();
    this.observer = undefined;
    this.observing = false;
  }

  remember(path, type, revision, recent = false) {
    const previous = this.paths.get(path);
    if (!previous) {
      if (this.paths.size >= MAX_TRACKED_PATHS) {
        if (!recent) return;
        for (const candidate of this.paths.keys()) {
          if (this.recent.has(candidate)) continue;
          this.paths.delete(candidate);
          break;
        }
      }
      this.paths.set(path, { type, revision });
    } else if (previous.type !== type || previous.revision !== revision) {
      this.paths.set(path, { type, revision });
      if (previous.type === 'directory' && type === 'directory' && previous.revision !== null) {
        const removed = new Set(previous.revision ? previous.revision.split('\0') : []);
        for (const name of revision ? revision.split('\0') : []) {
          if (!removed.delete(name)) this.onChange(`${path}/${name}`);
        }
        for (const name of removed) this.onChange(`${path}/${name}`);
      } else {
        this.onChange(path);
      }
    }
    if (recent) {
      this.recent.delete(path);
      this.recent.add(path);
      if (this.recent.size > RECENT_FILES) this.recent.delete(this.recent.values().next().value);
    }
  }

  async poll() {
    if (this.observing) return;
    const paths = [...this.recent];
    let background = 0;
    for (const path of this.paths.keys()) {
      if (this.recent.has(path)) continue;
      paths.push(path);
      if (++background === BACKGROUND_PATHS_PER_POLL) break;
    }
    await Promise.all(paths.map(async path => {
      const baseline = this.paths.get(path);
      this.paths.delete(path);
      this.paths.set(path, baseline);
      try {
        const current = await this.readRevision(path);
        if (this.paths.get(path) !== baseline) return;
        if (!current) {
          if (baseline.revision !== null) {
            this.paths.set(path, { type: baseline.type, revision: null });
            this.onChange(path);
          }
          return;
        }
        this.remember(path, current.type, current.revision);
      } catch {
        // A transient read error or revoked permission is not evidence of a deletion.
      }
    }));
  }
}
