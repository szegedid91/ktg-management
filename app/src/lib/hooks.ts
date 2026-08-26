// React hookok a lokális tükörhöz és az online view-khoz

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { store } from './store';
import { SyncTable } from './types';
import { fetchViewCached } from './repo';
import { subscribeSyncStatus, SyncStatus } from './sync';

/** A teljes tábla lokális tükre (élő, minden íráskor frissül) */
export function useTable<T = any>(table: SyncTable, includeDeleted = false): T[] {
  const subscribe = useCallback((cb: () => void) => store.subscribe(cb), []);
  const version = useSyncExternalStore(subscribe, () => store.version, () => store.version);
  const cacheRef = useRef<{ version: number; includeDeleted: boolean; rows: T[] }>({ version: -1, includeDeleted, rows: [] });
  if (cacheRef.current.version !== version || cacheRef.current.includeDeleted !== includeDeleted) {
    const all = store.getAll(table) as any[];
    cacheRef.current = {
      version,
      includeDeleted,
      rows: (includeDeleted ? all : all.filter((r) => !r.deleted_at)) as T[],
    };
  }
  return cacheRef.current.rows;
}

export function useRow<T = any>(table: SyncTable, id: string | undefined): T | undefined {
  const subscribe = useCallback((cb: () => void) => store.subscribe(cb), []);
  useSyncExternalStore(subscribe, () => store.version, () => store.version);
  return id ? (store.get(table, id) as T | undefined) : undefined;
}

export function useSyncStatus(): SyncStatus {
  const [status, setStatus] = useState<SyncStatus>({ syncing: false, lastSyncAt: null, lastError: null, pendingOps: 0 });
  useEffect(() => subscribeSyncStatus(setStatus), []);
  return status;
}

/** Online view lekérdezése cache-eléssel; refresh() újratölt */
export function useOnlineView<T>(cacheKey: string, fetcher: () => Promise<T>, deps: any[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [fromCache, setFromCache] = useState(false);
  const mounted = useRef(true);
  // gyors egymásutáni frissítéseknél (pl. szűrő gépelése) csak a legutolsó
  // kérés eredménye számít — a megkésett régebbi válasz nem írhatja felül
  const reqToken = useRef(0);
  useEffect(() => () => { mounted.current = false; }, []);

  const refresh = useCallback(async () => {
    const token = ++reqToken.current;
    setLoading(true);
    const res = await fetchViewCached(cacheKey, fetcher);
    if (mounted.current && reqToken.current === token) {
      setData(res.data);
      setFromCache(res.fromCache);
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => { void refresh(); }, [refresh]);
  return { data, loading, fromCache, refresh };
}
