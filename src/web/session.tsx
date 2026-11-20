import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { ApiFailure, api } from './api';
import { clearDevice, clearRosters, countUnsynced } from './offline/db';
import type { Me } from './types';

interface SessionState {
  me: Me | null;
  loading: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setMe(await api<Me>('/me'));
    } catch (err) {
      if (err instanceof ApiFailure && err.status === 401) {
        // Signed out on the server (expired or revoked): don't leave the offline list behind.
        await clearRosters().catch(() => undefined);
        setMe(null);
      } else throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  /** Signing out wipes the rosters cached for offline scanning. */
  const signOut = useCallback(async () => {
    const waiting = await countUnsynced().catch(() => 0);
    if (
      waiting > 0 &&
      !window.confirm(
        `${waiting} scans on this phone have not uploaded yet. If you sign out now they will be lost. Get signal and wait for them to upload, or press OK to sign out anyway.`,
      )
    ) {
      return;
    }
    const wiped = await clearDevice(true).then(
      () => true,
      () => false,
    );
    if (!wiped) window.alert("This phone's offline list couldn't be wiped. Close this browser tab, then clear this site's data in the browser settings.");
    await api('/auth/sign-out', { method: 'POST' }).catch(() => undefined);
    setMe(null);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return <SessionContext.Provider value={{ me, loading, refresh, signOut }}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession outside SessionProvider');
  return value;
}
