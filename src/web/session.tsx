import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { ApiFailure, api } from './api';
import { clearDevice, countUnsynced } from './offline/db';
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
      if (err instanceof ApiFailure && err.status === 401) setMe(null);
      else throw err;
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
    await clearDevice(true).catch(() => undefined);
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
