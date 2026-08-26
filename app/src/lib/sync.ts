// Szinkronmotor: outbox feltolása + változások lehúzása updated_at kurzorral.
// Fut: app-induláskor, előtérbe kerüléskor, minden írás után és 30 mp-enként.

import { supabase } from './supabase';
import { store, OutboxOp } from './store';
import { SYNC_TABLES, SyncTable } from './types';

let syncing = false;
let runAgain = false; // írás érkezett futó szinkron közben → a végén újrafutunk
let timer: ReturnType<typeof setInterval> | null = null;
const statusListeners = new Set<(s: SyncStatus) => void>();

export interface SyncStatus {
  syncing: boolean;
  lastSyncAt: string | null;
  lastError: string | null;
  pendingOps: number;
  failedOps: number;
}

const status: SyncStatus = { syncing: false, lastSyncAt: null, lastError: null, pendingOps: 0, failedOps: 0 };

function notifyStatus() {
  status.pendingOps = store.outboxSize();
  status.failedOps = store.getFailed().length;
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

/** Végleges üzleti elutasítás (RLS, constraint, trigger, séma) — nincs értelme
 *  újrapróbálni. Minden más (5xx, rate limit, ismeretlen) átmeneti: retry. */
function isRejection(err: any): boolean {
  const code = String(err?.code ?? '');
  // PG hibaosztályok: 22 adathiba, 23 constraint, 42 jogosultság/séma,
  // P0 raise exception; PGRST a PostgREST séma-/kéréshibái
  return /^(22|23|42|P0|PGRST)/.test(code);
}

/** Elutasított művelet visszagörgetése: az érintett sorok szerver-állapotának
 *  visszatöltése, hogy az optimista lokális változat ne ragadjon bent. */
async function rollbackOp(op: OutboxOp): Promise<void> {
  const targets: { table: SyncTable; id: string }[] = [];
  if (op.kind === 'upsert' && op.table && op.row) targets.push({ table: op.table, id: String(op.row.id) });
  if (op.kind === 'update' && op.table && op.id) targets.push({ table: op.table, id: op.id });
  if (op.kind === 'rpc') {
    const table: SyncTable = op.fn === 'mark_invoice_paid' ? 'invoices' : 'attendance';
    const ids: string[] = op.args?.p_ids ?? (op.args?.p_id ? [op.args.p_id] : []);
    ids.forEach((id) => targets.push({ table, id }));
  }
  for (const t of targets) {
    try {
      const { data, error } = await supabase.from(t.table).select('*').eq('id', t.id).maybeSingle();
      if (error) continue; // offline vagy átmeneti — a következő pull rendezi
      if (data) store.putServer(t.table, data as any);
      else store.removeLocal(t.table, t.id); // a szerver el sem fogadta a beszúrást
    } catch {
      // nem kritikus — a lista frissítésnél helyreáll
    }
  }
}

async function pushOp(op: OutboxOp): Promise<'done' | 'offline' | 'rejected'> {
  try {
    if (op.kind === 'upsert') {
      const { error } = await supabase.from(op.table!).upsert(op.row!);
      if (error) throw error;
    } else if (op.kind === 'update') {
      const { error } = await supabase.from(op.table!).update(op.patch!).eq('id', op.id!);
      if (error) throw error;
    } else {
      const { error } = await supabase.rpc(op.fn!, op.args ?? {});
      if (error) throw error;
    }
    return 'done';
  } catch (err: any) {
    if (isRejection(err)) {
      store.markOpError(op.opId, String(err?.message ?? err));
      return 'rejected';
    }
    // hálózati vagy átmeneti szerverhiba → az op a sorban marad, retry később
    return 'offline';
  }
}

async function pushOutbox(): Promise<boolean> {
  for (const op of store.peekOutbox()) {
    const result = await pushOp(op);
    if (result === 'offline') return false;
    if (result === 'done') store.removeOp(op.opId);
    if (result === 'rejected') {
      // a szerver végleg elutasította: sikertelen listába kerül (a UI bannert
      // mutat), és az optimista lokális állapotot visszagörgetjük
      store.moveOpToFailed(op.opId);
      status.lastError = op.lastError ?? 'Egy műveletet a szerver elutasított.';
      await rollbackOp(op);
    }
  }
  return true;
}

async function pullTable(table: SyncTable): Promise<void> {
  const cursor = store.getCursor(table);
  const page = 1000;
  let from = 0;
  let maxTs = cursor;
  for (;;) {
    // gte + (updated_at, id) rendezés: az azonos időbélyegű sorok sem
    // maradhatnak ki (pl. tömeges kifizetés-pipa egy tranzakcióban);
    // a határ-sorok újratöltése ártalmatlan (idempotens upsert a tükörbe)
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .gte('updated_at', cursor)
      .order('updated_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + page - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    store.putManyLocal(table, data as any[], true);
    maxTs = (data[data.length - 1] as any).updated_at;
    if (data.length < page) break;
    from += page;
  }
  if (maxTs !== cursor) store.setCursor(table, maxTs);
}

export async function syncNow(): Promise<void> {
  if (syncing) { runAgain = true; return; }
  await store.whenLoaded(); // a diszk-állapot betöltése előtt nem szinkronizálunk
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
    if (runAgain) {
      runAgain = false;
      void syncNow(); // közben új írás érkezett — azonnal feltoljuk
    }
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
