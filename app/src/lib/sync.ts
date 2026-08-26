// Szinkronmotor: outbox feltolása + változások lehúzása updated_at kurzorral.
// Fut: app-induláskor, előtérbe kerüléskor, minden írás után és 30 mp-enként.

import { supabase } from './supabase';
import { store, OutboxOp } from './store';
import { SYNC_TABLES, SyncTable } from './types';

let syncing = false;
let timer: ReturnType<typeof setInterval> | null = null;
const statusListeners = new Set<(s: SyncStatus) => void>();

export interface SyncStatus {
  syncing: boolean;
  lastSyncAt: string | null;
  lastError: string | null;
  pendingOps: number;
}

const status: SyncStatus = { syncing: false, lastSyncAt: null, lastError: null, pendingOps: 0 };

function notifyStatus() {
  status.pendingOps = store.outboxSize();
  statusListeners.forEach((l) => l({ ...status }));
}

export function subscribeSyncStatus(l: (s: SyncStatus) => void): () => void {
  statusListeners.add(l);
  l({ ...status });
  return () => statusListeners.delete(l);
}

/** Hálózati hiba (offline) vs. szerver által elutasított művelet megkülönböztetése */
function isNetworkError(err: any): boolean {
  const msg = String(err?.message ?? err ?? '');
  return /network|fetch|timeout|abort|Failed to fetch|ERR_/i.test(msg);
}

async function pushOp(op: OutboxOp): Promise<'done' | 'offline' | 'rejected'> {
  try {
    if (op.kind === 'upsert') {
      const { error } = await supabase.from(op.table!).upsert(op.row!);
      if (error) throw error;
    } else {
      const { error } = await supabase.rpc(op.fn!, op.args ?? {});
      if (error) throw error;
    }
    return 'done';
  } catch (err: any) {
    if (isNetworkError(err)) return 'offline';
    store.markOpError(op.opId, String(err?.message ?? err));
    return 'rejected';
  }
}

async function pushOutbox(): Promise<boolean> {
  for (const op of store.peekOutbox()) {
    const result = await pushOp(op);
    if (result === 'offline') return false;
    if (result === 'done') store.removeOp(op.opId);
    // 'rejected': a szerver elutasította (pl. jogosultság) — a sikertelen
    // listába kerül, a UI mutatja, nem torlaszolja el a többi írást
    if (result === 'rejected') store.moveOpToFailed(op.opId);
  }
  return true;
}

async function pullTable(table: SyncTable): Promise<void> {
  const cursor = store.getCursor(table);
  let from = 0;
  const page = 1000;
  for (;;) {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .gt('updated_at', cursor)
      .order('updated_at', { ascending: true })
      .range(from, from + page - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    store.putManyLocal(table, data as any[], true);
    store.setCursor(table, (data[data.length - 1] as any).updated_at);
    if (data.length < page) break;
    from = 0; // a kurzor haladt, elölről lapozunk az új kurzorral
  }
}

export async function syncNow(): Promise<void> {
  if (syncing) return;
  const { data: sess } = await supabase.auth.getSession().catch(() => ({ data: { session: null } } as any));
  if (!sess?.session) return;

  syncing = true;
  status.syncing = true;
  notifyStatus();
  try {
    const pushed = await pushOutbox();
    if (pushed) {
      for (const table of SYNC_TABLES) {
        await pullTable(table);
      }
      status.lastSyncAt = new Date().toISOString();
      status.lastError = null;
      // függő push-értesítések kiküldése (legfeljebb percenként)
      import('./push').then((m) => m.drainPushQueue()).catch(() => {});
    }
  } catch (err: any) {
    status.lastError = isNetworkError(err) ? null : String(err?.message ?? err);
  } finally {
    syncing = false;
    status.syncing = false;
    notifyStatus();
  }
}

export function startSyncLoop() {
  if (timer) return;
  timer = setInterval(() => { void syncNow(); }, 30_000);
  void syncNow();
}

export function stopSyncLoop() {
  if (timer) { clearInterval(timer); timer = null; }
}
