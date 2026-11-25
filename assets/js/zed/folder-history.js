const DATABASE_NAME = 'zed-local-folders';
const STORE = 'folders';
const LAST = 'last';

async function withStore(mode, operation) {
  if (!globalThis.indexedDB) return;
  const database = await new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Folder storage is busy.'));
  });
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE, mode);
      const request = operation(transaction.objectStore(STORE));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () => reject(transaction.error ?? request.error);
    });
  } finally {
    database.close();
  }
}

export function rememberedFolder() {
  return withStore('readonly', store => store.get(LAST));
}

export function rememberFolder(root, handle) {
  return withStore('readwrite', store => store.put({ root, handle }, LAST));
}
