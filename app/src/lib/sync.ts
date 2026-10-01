// Szinkronmotor: outbox feltolása + változások lehúzása updated_at kurzorral.
// Fut: app-induláskor, előtérbe kerüléskor, minden írás után és 30 mp-enként.

import { supabase } from './supabase';
import { store, OutboxOp, opRowIds } from './store';
import { logError, errInfo, flushErrlog, setErrlogUser } from './errlog';
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
 *  újrapróbálni. Minden más (5xx, rate limit, kapcsolat, lejárt token) átmeneti. */
function isRejection(err: any): boolean {
  const code = String(err?.code ?? '');
  // PG hibaosztályok: 22 adathiba, 23 constraint, 42 jogosultság/séma,
  // P0 raise exception; PGRST1xx/2xx a PostgREST kérés-/sémahibái
  // (PGRST0xx kapcsolati, PGRST3xx JWT hibák: átmenetiek)
  return /^(22|23|42|P0)/.test(code) || /^PGRST[12]/.test(code);
}

/** Néhány táblát maszkoló nézeten át olvasunk (a profilok érzékeny
 *  oszlopai csak a sajátnál / partnernek látszanak; a jelenlét és a munkavállalók
 *  pénzadatai munkavállalói fióknak egyáltalán nem mennek le). */
const READ_SOURCE: Partial<Record<SyncTable, string>> = { profiles: 'profiles_v', workers: 'workers_v', attendance: 'attendance_v', worker_tasks: 'worker_tasks_v' };
const sourceOf = (table: SyncTable) => READ_SOURCE[table] ?? table;

/** Elutasított művelet visszagörgetése: az érintett sorok szerver-állapotának
 *  visszatöltése, hogy az optimista lokális változat ne ragadjon bent. */
async function rollbackOp(op: OutboxOp): Promise<void> {
  const targets: { table: SyncTable; id: string }[] = [];
  if (op.kind === 'upsert' && op.table && op.row) targets.push({ table: op.table, id: String(op.row.id) });
  if (op.kind === 'update' && op.table && op.id) targets.push({ table: op.table, id: op.id });
  if (op.kind === 'rpc' && op.touched?.length) targets.push(...op.touched);
  if (op.kind === 'rpc' && !op.touched?.length) {
    const table: SyncTable = op.fn === 'mark_invoice_paid' ? 'invoices'
      : op.fn === 'delete_site' ? 'sites'
      : op.fn === 'worker_task_action' ? 'worker_tasks'
      : (op.fn === 'accept_task_quote' || op.fn === 'reject_task_quote') ? 'task_quotes'
      : 'attendance';
    const ids: string[] = op.args?.p_ids ?? (op.args?.p_id ? [op.args.p_id] : []);
    ids.forEach((id) => targets.push({ table, id }));
  }
  for (const t of targets) {
    try {
      const { data, error } = await supabase.from(sourceOf(t.table)).select('*').eq('id', t.id).maybeSingle();
      if (error) continue; // offline vagy átmeneti — a következő pull rendezi
      if (data) store.putServer(t.table, data as any);
      else store.removeLocal(t.table, t.id); // a szerver el sem fogadta a beszúrást
    } catch {
      // nem kritikus — a lista frissítésnél helyreáll
    }
  }
}

/** Az elutasított művelet naplózható kivonata (érzékeny mezők és nagy tartalom nélkül). */
function opSummary(op: OutboxOp): Record<string, any> {
  const clean = (o: any) => {
    if (!o || typeof o !== 'object') return o;
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(o)) {
      if (/bank|password|token|secret|email|phone|name|note|body|address|iban|tax/i.test(k)) continue;
      out[k] = typeof v === 'string' && v.length > 200 ? `${v.slice(0, 200)}…` : v;
    }
    return out;
  };
  return { kind: op.kind, table: op.table, id: op.id, fn: op.fn, row: clean(op.row), patch: clean(op.patch), args: clean(op.args) };
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
    const what = op.kind === 'rpc' ? `rpc ${op.fn}` : `${op.kind} ${op.table}`;
    if (isRejection(err)) {
      store.markOpError(op.opId, String(err?.message ?? err));
      logError('sync-rejected', `${what}: ${String(err?.message ?? err)}`, { ...errInfo(err), op: opSummary(op) });
      return 'rejected';
    }
    // hálózati vagy átmeneti szerverhiba → az op a sorban marad, retry később
    if (!isNetworkError(err)) {
      // szerver-oldali (nem hálózati) átmeneti hiba: számoljuk; sok egymás utáni után a művelet a
      // „sikertelen” listába kerül, hogy ne tartsa fel örökre a mögötte állókat (a UI bannert mutat)
      const n = store.bumpOpAttempt(op.opId, String(err?.message ?? err));
      logError('sync-retry', `${what}: ${String(err?.message ?? err)}`, { ...errInfo(err), attempt: n, op: opSummary(op) });
      if (n >= 30) return 'rejected';
    }
    return 'offline';
  }
}

async function pushOutbox(): Promise<boolean> {
  for (const op of store.peekOutbox()) {
    const result = await pushOp(op);
    if (result === 'offline') {
      // a sor eleje elakadt: a lehúzás ettől függetlenül megy (a függő sorokat a tükör védi)
      status.lastError = op.attempts && op.attempts >= 3 ? `Egy művelet nem megy fel (${op.attempts}. próba): ${op.lastError ?? ''}`.trim() : status.lastError;
      return false;
    }
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

/** A profiloknak nincs „törölve” jelölése: a Supabase-ben törölt fiók sora
 *  egyszerűen eltűnik, amiről a növekményes lehúzás nem értesül. Ezért a
 *  profilokat minden körben összevetjük a szerver teljes listájával, és ami
 *  ott már nincs, azt helyben is töröljük (a tábla kicsi, ez olcsó). */
async function reconcileProfiles(): Promise<void> {
  await reconcileTable('profiles');
}

/** Egy tábla helyi tükrének összevetése a szerver azonosító-listájával: ami a
 *  szerveren már fizikailag nincs (végleges takarítás, vagy a jogosultság
 *  megszűnt), az helyben is eltűnik. A növekményes lehúzás ezt nem látja. */
async function reconcileTable(table: SyncTable): Promise<void> {
  const alive = new Set<string>();
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await supabase.from(sourceOf(table)).select('id').order('id').range(from, from + page - 1);
    if (error || !data) return; // offline / átmeneti hiba: most nem törlünk semmit
    data.forEach((r: any) => alive.add(String(r.id)));
    if (data.length < page) break;
  }
  const pendingIds = new Set(store.peekOutbox().flatMap((op) => opRowIds(op, table)));
  for (const row of store.getAll(table) as any[]) {
    const id = String(row.id);
    if (!alive.has(id) && !pendingIds.has(id)) store.removeLocal(table, id);
  }
}

let lastFullReconcile = 0;
const RECONCILE_EVERY_MS = 10 * 60_000;

/** Minden tábla egyeztetése — app-induláskor, majd 10 percenként. */
async function reconcileAll(): Promise<void> {
  if (Date.now() - lastFullReconcile < RECONCILE_EVERY_MS) return;
  lastFullReconcile = Date.now();
  for (const table of SYNC_TABLES) {
    if (table === 'profiles') continue; // minden körben megy
    await reconcileTable(table);
  }
}

// egyszeri teljes újratöltés egy táblára (a jel változásakor): pl. a worker_tasks_v mostantól
// „törölve” jelzést ad a törölt / levett feladathoz — a régen szinkronizált, elavult példányokat
// csak a kurzor visszaállításával lehet lecserélni a készüléken
const RESYNC_MARKS: Partial<Record<SyncTable, string>> = { worker_tasks: 'tombstones-2026-09-25' };

async function pullTable(table: SyncTable): Promise<void> {
  const gen = store.generation; // kijelentkezés/fiókváltás közben megszakad
  const mark = RESYNC_MARKS[table];
  const needFull = !!mark && store.getCursor(`${table}:mark`) !== mark;
  const cursor = needFull ? '1970-01-01T00:00:00Z' : store.getCursor(table);
  // 60 mp átfedés: az updated_at a tranzakció KEZDETE, a commit később jöhet — egy hosszabb művelet
  // sora különben kimaradhatna, ha a kurzor már túlszaladt rajta (az újratöltés idempotens upsert)
  const since = new Date(Math.max(0, new Date(cursor).getTime() - 60_000)).toISOString();
  const page = 1000;
  let maxTs = cursor;
  let lastTs: string | null = null;
  let lastId: string | null = null;
  for (;;) {
    // (updated_at, id) szerinti keyset-lapozás: offset helyett az utolsó sor után folytatjuk, így a
    // lapozás közben módosuló sorok sem tolnak el semmit
    let q = supabase.from(sourceOf(table)).select('*');
    q = lastTs && lastId
      ? q.or(`updated_at.gt.${lastTs},and(updated_at.eq.${lastTs},id.gt.${lastId})`)
      : q.gte('updated_at', since);
    const { data, error } = await q.order('updated_at', { ascending: true }).order('id', { ascending: true }).range(0, page - 1);
    if (error) throw error;
    if (store.generation !== gen) return; // közben törölték a tárat: nem írunk vissza
    if (!data || data.length === 0) break;
    store.putManyLocal(table, data as any[], true);
    const last = data[data.length - 1] as any;
    lastTs = String(last.updated_at); lastId = String(last.id);
    if (lastTs > maxTs) maxTs = lastTs;
    if (data.length < page) break;
  }
  if (store.generation !== gen) return;
  if (maxTs !== cursor) store.setCursor(table, maxTs);
  if (needFull && mark) store.setCursor(`${table}:mark`, mark);
}

// A munkavállaló kész feladatainak időablaka (vezetői beállítás, alap 35 nap). Ha a vezető átállítja
// (vagy a készülék még nem ismeri), a feladatokhoz kötött táblákat egyszer teljesen újratöltjük: a
// korábban eltűnt, most újra látható feladatok és a lépéseik / megjegyzéseik régi időbélyegűek, a
// növekményes lehúzás nem hozná le őket.
const DONE_WINDOW_TABLES: SyncTable[] = ['worker_tasks', 'task_assignees', 'task_subtasks', 'task_notes'];
const DONE_WINDOW_EVERY_MS = 2 * 60_000;
let doneWindowChecked = { at: 0, gen: -1 };

/** Hány napig látja a munkavállaló a kész feladatait (a legutóbbi szinkron szerint). */
export function workerDoneDays(): number {
  const n = Number(store.getCursor('done_window:days'));
  return Number.isFinite(n) ? n : 35;
}

async function checkDoneWindow(userId: string): Promise<void> {
  if (doneWindowChecked.gen === store.generation && Date.now() - doneWindowChecked.at < DONE_WINDOW_EVERY_MS) return;
  const gen = store.generation;
  const { data, error } = await Promise.resolve(supabase.rpc('fn_worker_done_window')).catch((e: any) => ({ data: null, error: e }));
  if (error || !data || store.generation !== gen) return; // offline / régi szerver: marad minden, ahogy volt
  doneWindowChecked = { at: Date.now(), gen };
  const mark = String((data as any).changed_at ?? '');
  const days = String(Number((data as any).days ?? 35));
  if (store.getCursor('done_window:days') !== days) store.setCursor('done_window:days', days);
  if (store.getCursor('done_window:mark') === mark) return;
  // vezetőnél nincs időablak (mindent lát): nála csak a jelet jegyezzük fel
  const isWorker = !!(store.getAll('profiles') as any[]).find((p) => p.id === userId)?.worker_id;
  if (isWorker) for (const t of DONE_WINDOW_TABLES) store.setCursor(t, '1970-01-01T00:00:00Z');
  store.setCursor('done_window:mark', mark);
}

let current: Promise<void> | null = null;

/** A folyamatban lévő szinkron vége (kijelentkezésnél megvárjuk). */
export function waitIdle(): Promise<void> { return current ?? Promise.resolve(); }

/** Kijelentkezés előtt: csak a függő műveletek feltolása — lehúzás és
 *  egyeztetés nélkül, legfeljebb timeoutMs-ig várva. (A teljes szinkron
 *  minden táblát lehúzott és egyeztetett, ettől volt lassú a kilépés.) */
export async function flushOutbox(timeoutMs = 4000): Promise<void> {
  const work = (async () => {
    await waitIdle();
    if (store.outboxSize() === 0) return;
    current = (async () => { try { await pushOutbox(); } catch { /* offline: a sor a tárban marad, de kilépéskor törlődik */ } })()
      .finally(() => { current = null; });
    await current;
  })();
  await Promise.race([work, new Promise<void>((r) => setTimeout(r, timeoutMs))]);
}

export function syncNow(): Promise<void> {
  if (current) { runAgain = true; return current; }
  current = runSync().finally(() => { current = null; });
  return current;
}

async function runSync(): Promise<void> {
  // a zárat azonnal (szinkron módon) fogjuk: két egyidejű hívás ne futtassa kétszer az outboxot
  syncing = true;
  await store.whenLoaded(); // a diszk-állapot betöltése előtt nem szinkronizálunk
  const { data: sess } = await supabase.auth.getSession().catch(() => ({ data: { session: null } } as any));
  if (!sess?.session) { syncing = false; return; }
  const gen = store.generation;

  status.syncing = true;
  notifyStatus();
  try {
    const pushed = await pushOutbox();
    // a lehúzás akkor is fut, ha egy művelet elakadt (átmeneti szerverhiba): a többi adat frissüljön;
    // a függő sorokat a tükör nem írja felül. Ha tényleg offline vagyunk, a lehúzás hálózati hibával áll meg.
    {
      await checkDoneWindow(sess.session.user.id);
      for (const table of SYNC_TABLES) {
        await pullTable(table);
        if (table === 'profiles') await reconcileProfiles();
      }
      if (store.generation !== gen) return;
      await reconcileAll();
      status.lastSyncAt = new Date().toISOString();
      if (pushed) status.lastError = null;
      // a naplózó a felhasználó nevével jelent (e-mail nélkül); a helyben várakozó hibák is most mennek fel
      setErrlogUser((store.getAll('profiles') as any[]).find((p) => p.id === sess.session.user.id)?.display_name ?? null);
      void flushErrlog();
      // régi, olvasott értesítések ne duzzasszák a lokális tárat
      const cutoff = new Date(Date.now() - 30 * 864e5).toISOString();
      store.prune('notification_queue', (r) => !!r.read_at && String(r.read_at) < cutoff);
      // függő push-értesítések kiküldése (legfeljebb percenként)
      import('./push').then((m) => m.drainPushQueue()).catch(() => {});
    }
  } catch (err: any) {
    status.lastError = isNetworkError(err) ? null : String(err?.message ?? err);
    if (!isNetworkError(err)) logError('sync', String(err?.message ?? err), errInfo(err));
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
