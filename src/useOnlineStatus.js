import { useCallback, useEffect, useState } from 'react';
import { API_BASE } from './config';

const PING_INTERVAL_MS = 30000;
const PING_TIMEOUT_MS = 5000;

// navigator.onLine only says whether some network interface is up. On a station LAN
// with no route to the evidence server it still reports true, which is exactly the
// case this system runs into, so it is used as a fast negative signal only and every
// positive is confirmed against the server.
//
// The probe is a HEAD of the API root, which Express answers with 404 "Cannot GET /".
// That is deliberate: any response at all proves reachability, so a 404 or a 500 both
// count as online and only a network-level throw counts as offline. It touches no
// route and no contract.
export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);

  const checkNow = useCallback(async () => {
    if (!navigator.onLine) { setIsOnline(false); return false; }
    try {
      await fetch(`${API_BASE}/`, { method: 'HEAD', cache: 'no-store', signal: AbortSignal.timeout(PING_TIMEOUT_MS) });
      setIsOnline(true);
      return true;
    } catch {
      setIsOnline(false);
      return false;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const probe = () => { if (!cancelled) checkNow(); };

    probe();
    const interval = setInterval(probe, PING_INTERVAL_MS);
    // The offline event is trustworthy on its own; the online event only means an
    // interface came back, so it is re-confirmed by the probe.
    const goOffline = () => setIsOnline(false);
    window.addEventListener('online', probe);
    window.addEventListener('offline', goOffline);
    window.addEventListener('focus', probe);

    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener('online', probe);
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('focus', probe);
    };
  }, [checkNow]);

  return { isOnline, checkNow };
}
