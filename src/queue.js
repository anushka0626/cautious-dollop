import { openDB } from 'idb';

// Offline capture queue. Holds the evidence file itself plus everything needed to POST it
// later, so a capture taken with no connectivity survives a reload and anchors on its own
// once the evidence server is reachable.
//
// Every export swallows its own failures and returns a safe value. A browser with
// IndexedDB unavailable (private mode, storage policy, quota) must degrade to online-only
// capture rather than take the app down: the online anchoring path does not touch this
// module at all.

const DB_NAME = 'veritas-capture';
const STORE = 'pending';
const VERSION = 1;

let dbPromise = null;

const getDb = () => {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id' });
        }
      },
    });
  }
  return dbPromise;
};

// Oldest capture first: the queue anchors in the order evidence was taken.
export async function listQueued() {
  try {
    const rows = await (await getDb()).getAll(STORE);
    return rows.sort((a, b) => a.capturedAt - b.capturedAt);
  } catch (err) {
    console.error('[veritas] queue read failed:', err);
    return [];
  }
}

export async function putQueued(record) {
  try {
    await (await getDb()).put(STORE, record);
    return true;
  } catch (err) {
    console.error('[veritas] queue write failed:', err);
    return false;
  }
}

export async function removeQueued(id) {
  try {
    await (await getDb()).delete(STORE, id);
    return true;
  } catch (err) {
    console.error('[veritas] queue delete failed:', err);
    return false;
  }
}

export async function clearQueue() {
  try {
    await (await getDb()).clear(STORE);
    return true;
  } catch (err) {
    console.error('[veritas] queue clear failed:', err);
    return false;
  }
}
