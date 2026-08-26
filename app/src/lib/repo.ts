// Adatelérési réteg a képernyőknek.
// Írás: lokális tükör + outbox (offline-first), majd azonnali sync-kísérlet.
// Olvasás: lokális tükörből (hooks.ts), a DB-oldali view-k pedig hálózatról
// jönnek AsyncStorage cache-eléssel, hogy offline is legyen (utolsó ismert) adat.

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { supabase } from './supabase';
import { store } from './store';
import { syncNow } from './sync';
import { SyncTable } from './types';

export function newId(): string {
  return Crypto.randomUUID();
}

function nowISO(): string {
  return new Date().toISOString();
}

let currentUserId: string | null = null;
export function setCurrentUserId(id: string | null) {
  currentUserId = id;
}
export function getCurrentUserId(): string | null {
  return currentUserId;
}

// táblák, amelyeknek nincs created_by oszlopa (a comments author_id-t használ)
const NO_CREATED_BY = new Set<SyncTable>(['comments']);

/** Új rekord: lokálisan azonnal él, outboxon át szinkronizál */
export function insertRow<T extends Record<string, any>>(table: SyncTable, values: Partial<T>): string {
  const id = (values.id as string) ?? newId();
  const row: Record<string, any> = {
    ...values,
    id,
    created_at: nowISO(),
    updated_at: nowISO(),
    deleted_at: null,
  };
  if (!NO_CREATED_BY.has(table)) row.created_by = values.created_by ?? currentUserId;
  store.putLocal(table, row as any);
  store.enqueue({ opId: newId(), kind: 'upsert', table, row: row as any, queuedAt: nowISO() });
  void syncNow();
  return id;
}

/** Mezőszintű módosítás: csak a patch oszlopai mennek fel, így egy elavult
 *  lokális tükör nem írja felül a másik felhasználó közbeni módosításait. */
export function updateRow(table: SyncTable, id: string, patch: Record<string, any>): void {
  const existing = store.get(table, id);
  if (!existing) return;
  store.putLocal(table, { ...existing, ...patch, updated_at: nowISO() });
  store.enqueue({ opId: newId(), kind: 'update', table, id: String(id), patch, queuedAt: nowISO() });
  void syncNow();
}

/** Törlés = soft delete; az audit log és a sync így is látja */
export function softDeleteRow(table: SyncTable, id: string): void {
  updateRow(table, id, { deleted_at: nowISO() });
}

/** RPC hívás offline-sorba állítva (pl. kifizetés pipa). Az optimista
 *  lokális változást a hívó végzi el (localPatch). */
export function queueRpc(fn: string, args: Record<string, any>,
  localPatch?: { table: SyncTable; id: string; patch: Record<string, any> }[]): void {
  if (localPatch) {
    for (const p of localPatch) {
      const existing = store.get(p.table, p.id);
      if (existing) store.putLocal(p.table, { ...existing, ...p.patch, updated_at: nowISO() });
    }
  }
  store.enqueue({ opId: newId(), kind: 'rpc', fn, args, queuedAt: nowISO() });
  void syncNow();
}

// ---------- Kifizetés-pipák ----------
export function markAttendancePaid(ids: string[], paid: boolean, note?: string) {
  const n = note?.trim() || null;
  queueRpc('mark_attendance_paid', { p_ids: ids, p_paid: paid, p_note: n },
    ids.map((id) => ({
      table: 'attendance' as SyncTable, id,
      patch: paid
        ? { paid_at: nowISO(), paid_by: currentUserId, paid_note: n }
        : { paid_at: null, paid_by: null, paid_note: null },
    })));
}

export function markCommissionPaid(ids: string[], paid: boolean, note?: string) {
  const n = note?.trim() || null;
  queueRpc('mark_commission_paid', { p_ids: ids, p_paid: paid, p_note: n },
    ids.map((id) => ({
      table: 'attendance' as SyncTable, id,
      patch: paid
        ? { commission_paid_at: nowISO(), commission_paid_by: currentUserId, commission_paid_note: n }
        : { commission_paid_at: null, commission_paid_by: null, commission_paid_note: null },
    })));
}

export function markInvoicePaid(id: string, paid: boolean, date?: string) {
  queueRpc('mark_invoice_paid', { p_id: id, p_paid: paid, p_date: date ?? new Date().toISOString().slice(0, 10) },
    [{
      table: 'invoices' as SyncTable, id,
      patch: paid
        ? { paid_at: date ?? new Date().toISOString().slice(0, 10), paid_marked_by: currentUserId }
        : { paid_at: null, paid_marked_by: null },
    }]);
}

// ---------- Online view-lekérdezés cache-eléssel ----------
const VIEW_CACHE_PREFIX = 'ktg:view:';

export async function fetchViewCached<T>(cacheKey: string, fetcher: () => Promise<T>): Promise<{ data: T | null; fromCache: boolean }> {
  try {
    const data = await fetcher();
    await AsyncStorage.setItem(VIEW_CACHE_PREFIX + cacheKey, JSON.stringify(data));
    return { data, fromCache: false };
  } catch {
    const cached = await AsyncStorage.getItem(VIEW_CACHE_PREFIX + cacheKey);
    return { data: cached ? JSON.parse(cached) : null, fromCache: true };
  }
}

export async function fetchView<T = any>(view: string, params?: (q: any) => any): Promise<T[]> {
  let q: any = supabase.from(view).select('*');
  if (params) q = params(q);
  const { data, error } = await q;
  if (error) throw error;
  return data as T[];
}

export async function callRpc<T = any>(fn: string, args?: Record<string, any>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args ?? {});
  if (error) throw error;
  return data as T;
}
