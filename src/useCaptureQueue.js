import { useCallback, useEffect, useRef, useState } from 'react';
import { API_BASE } from './config';
import { clearQueue, listQueued, putQueued, removeQueued } from './queue';

// EvidenceRegistry.logEvidence requires !hashExists[hash], so submitting a document that
// is already on the ledger reverts and the server returns it as a 500. That is a duplicate
// submission, not a transport failure: retrying would revert identically forever, so it
// resolves the item and is reported distinctly from a fresh anchor.
const isAlreadyNotarized = (message) => /already notarized/i.test(message || '');

const readResponse = async (response) => {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Server responded ${response.status}`);
  return data;
};

// The upload response carries no timestamp, so the anchor time is read back from the
// verify route, where record.timestamp is the block timestamp. Non-fatal: if that call
// fails the only loss is precision, and the source is labelled in the UI either way.
const readAnchorTime = async (hash) => {
  try {
    const data = await readResponse(await fetch(`${API_BASE}/api/evidence/verify/${hash}`));
    if (data.authentic && data.record?.timestamp) {
      return { anchoredAt: data.record.timestamp * 1000, anchorTimeSource: 'chain' };
    }
  } catch {
    // fall through to the device clock
  }
  return { anchoredAt: Date.now(), anchorTimeSource: 'device' };
};

export function useCaptureQueue(isOnline) {
  const [items, setItems] = useState([]);
  const [syncing, setSyncing] = useState(false);

  const syncingRef = useRef(false);      // guards StrictMode's double effect
  const wasOnlineRef = useRef(isOnline);
  const mountSyncedRef = useRef(false);
  const itemsRef = useRef(items);

  useEffect(() => { itemsRef.current = items; }, [items]);

  const patch = useCallback((id, changes) => {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...changes } : item)));
  }, []);

  // Rehydrate whatever survived a reload.
  useEffect(() => {
    let cancelled = false;
    listQueued().then((rows) => {
      if (!cancelled) setItems(rows.map((row) => ({ ...row, status: 'pending' })));
    });
    return () => { cancelled = true; };
  }, []);

  // Returns false when the record could not be persisted, so the caller can warn that the
  // capture is held in memory only. It is still queued for this session either way.
  const enqueue = useCallback(async ({ file, caseId, docType, hash }) => {
    const record = {
      id: `${hash}-${Date.now()}`,
      caseId,
      docType,
      hash,
      fileName: file.name,
      file,
      capturedAt: Date.now(),
    };
    const persisted = await putQueued(record);
    setItems((current) => [...current, { ...record, status: 'pending' }]);
    return persisted;
  }, []);

  const syncOne = useCallback(async (item) => {
    patch(item.id, { status: 'syncing', error: '' });
    try {
      const formData = new FormData();
      formData.append('file', item.file, item.fileName);
      formData.append('caseId', item.caseId);
      formData.append('docType', item.docType);

      const data = await readResponse(
        await fetch(`${API_BASE}/api/evidence/upload`, { method: 'POST', body: formData }),
      );
      const timing = await readAnchorTime(item.hash);
      await removeQueued(item.id);
      patch(item.id, { status: 'anchored', txHash: data.txHash, blockNumber: data.blockNumber, ...timing });
    } catch (err) {
      if (isAlreadyNotarized(err.message)) {
        const timing = await readAnchorTime(item.hash);
        await removeQueued(item.id);
        patch(item.id, { status: 'duplicate', ...timing });
        return;
      }
      patch(item.id, { status: 'failed', error: err.message });
    }
  }, [patch]);

  // Sequential on purpose: each upload is a chain transaction, and the relayer signs with
  // one wallet, so parallel posts would race on the nonce. One item failing must not stop
  // the rest, which is why syncOne resolves rather than throws.
  const syncAll = useCallback(async () => {
    if (syncingRef.current) return;
    const queued = itemsRef.current.filter((item) => item.status === 'pending' || item.status === 'failed');
    if (queued.length === 0) return;

    syncingRef.current = true;
    setSyncing(true);
    try {
      for (const item of queued) {
        await syncOne(item);
      }
    } finally {
      syncingRef.current = false;
      setSyncing(false);
    }
  }, [syncOne]);

  const retry = useCallback(async (id) => {
    if (syncingRef.current) return;
    const item = itemsRef.current.find((row) => row.id === id);
    if (!item) return;

    syncingRef.current = true;
    setSyncing(true);
    try {
      await syncOne(item);
    } finally {
      syncingRef.current = false;
      setSyncing(false);
    }
  }, [syncOne]);

  const clearAll = useCallback(async () => {
    await clearQueue();
    setItems([]);
  }, []);

  // Drain on the offline -> online edge.
  useEffect(() => {
    const wasOnline = wasOnlineRef.current;
    wasOnlineRef.current = isOnline;
    if (isOnline && !wasOnline) syncAll();
  }, [isOnline, syncAll]);

  // ...and once on mount when already online, so reloading with a queue does not strand it.
  useEffect(() => {
    if (mountSyncedRef.current || !isOnline || items.length === 0) return;
    mountSyncedRef.current = true;
    syncAll();
  }, [isOnline, items, syncAll]);

  return { items, syncing, enqueue, retry, syncAll, clearAll };
}
