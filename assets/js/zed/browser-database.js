const MAIN = 'main';
const BRANCH_KEY = 'zed-database-branch';

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = resolve;
    transaction.onabort = () => reject(transaction.error || new Error('Database transaction aborted.'));
  });
}

export async function openBrowserDatabase(notify) {
  const request = indexedDB.open('zed-native-databases', 1);
  request.onupgradeneeded = () => {
    request.result.createObjectStore('branches', { keyPath: 'branch' });
    request.result.createObjectStore('snapshots', { keyPath: ['branch', 'name'] })
      .createIndex('branch', 'branch');
  };
  const database = await requestResult(request);
  database.onversionchange = () => database.close();
  const branch = sessionStorage.getItem(BRANCH_KEY) || MAIN;
  const read = database.transaction(['branches', 'snapshots']);
  const [head, snapshots] = await Promise.all([
    requestResult(read.objectStore('branches').get(branch)),
    requestResult(read.objectStore('snapshots').index('branch').getAll(branch)),
  ]);
  return new BrowserDatabase(database, branch, head?.revision, snapshots, notify);
}

class BrowserDatabase {
  constructor(database, branch, revision, snapshots, notify) {
    this.database = database;
    this.branch = branch;
    this.revision = revision;
    this.snapshots = new Map(snapshots.map(({ name, bytes }) => [name, bytes]));
    this.pending = new Map();
    this.notify = notify;
  }

  read(name) { return this.snapshots.get(name); }

  write(name, bytes) {
    this.snapshots.set(name, bytes);
    this.pending.set(name, bytes);
    if (!this.writing) void this.flush();
  }

  async flush() {
    this.writing = true;
    while (this.pending.size) {
      const updates = this.pending;
      this.pending = new Map();
      try {
        await this.commit(updates);
      } catch (error) {
        for (const [name, bytes] of updates) {
          if (!this.pending.has(name)) this.pending.set(name, bytes);
        }
        console.warn('Could not save the Zed database.', error);
        this.notify('Zed could not save its browser history.');
        break;
      }
    }
    this.writing = false;
  }

  async commit(updates) {
    const write = this.database.transaction(['branches', 'snapshots'], 'readwrite');
    const done = transactionDone(write);
    const branches = write.objectStore('branches');
    const snapshots = write.objectStore('snapshots');
    const revision = crypto.randomUUID();
    let branch = this.branch;
    const current = branches.get(branch);
    current.onsuccess = () => {
      const conflict = current.result?.revision !== this.revision;
      // Concurrent editing tabs retain their own complete history on conflict.
      if (conflict) branch = crypto.randomUUID();
      for (const [name, bytes] of conflict ? this.snapshots : updates) {
        snapshots.put({ branch, name, bytes });
      }
      branches.put({ branch, revision });
    };
    await done;
    this.revision = revision;
    if (branch !== this.branch) {
      this.branch = branch;
      sessionStorage.setItem(BRANCH_KEY, branch);
      this.notify('Another tab saved first. This tab kept a separate copy of its history.');
    }
  }
}
