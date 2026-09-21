// Hibanapló: a rendszert érintő hibákat (szerver által elutasított művelet,
// feltöltési hiba, összeomlás, el nem kapott JS-hiba) a szerverre jelentjük,
// ahol csak az admin látja. NEM az outboxon át megy (egy naplózási hiba ne
// okozzon újabb hibát); ha nincs net, helyben vár és a következő alkalommal
// megy fel.

import { Platform } from 'react-native';
import { supabase } from './supabase';
import { APP_VERSION } from './version';

type Entry = {
  kind: string; message: string; detail?: any; route?: string | null;
  app_version: string; user_agent?: string | null; user_name?: string | null; at: string;
};

const KEY = 'ktg:errlog-queue';
const MAX_QUEUE = 40;
const recent = new Map<string, number>();
let userName: string | null = null;
let flushing = false;

/** A bejelentkezett felhasználó neve — a naplóban így olvasható, kinél volt a hiba. */
export function setErrlogUser(name: string | null) { userName = name; }

function readQueue(): Entry[] {
  try { return Platform.OS === 'web' ? JSON.parse(localStorage.getItem(KEY) ?? '[]') : memQueue; } catch { return []; }
}
function writeQueue(q: Entry[]) {
  try { if (Platform.OS === 'web') localStorage.setItem(KEY, JSON.stringify(q.slice(-MAX_QUEUE))); else memQueue = q.slice(-MAX_QUEUE); } catch { /* nincs tároló */ }
}
let memQueue: Entry[] = [];

/** Supabase/PostgREST/Storage hibaobjektum → naplózható mezők. */
export function errInfo(err: any): Record<string, any> {
  if (!err || typeof err !== 'object') return { message: String(err) };
  const out: Record<string, any> = {};
  for (const k of ['message', 'code', 'details', 'hint', 'status', 'statusCode', 'name', 'error']) {
    if (err[k] != null) out[k] = String(err[k]);
  }
  if (typeof err.stack === 'string') out.stack = err.stack.split('\n').slice(0, 6).join('\n');
  return out;
}

export function logError(kind: string, message: string, detail?: any): void {
  try {
    const msg = String(message ?? '').slice(0, 2000) || '(üres hibaüzenet)';
    // ugyanaz a hiba 1 percen belül csak egyszer
    const sig = `${kind}|${msg}`;
    const now = Date.now();
    if ((recent.get(sig) ?? 0) > now - 60_000) return;
    recent.set(sig, now);
    const entry: Entry = {
      kind, message: msg, detail: detail ?? null,
      route: Platform.OS === 'web' && typeof location !== 'undefined' ? location.pathname : null,
      app_version: APP_VERSION,
      user_agent: Platform.OS === 'web' && typeof navigator !== 'undefined' ? navigator.userAgent : Platform.OS,
      user_name: userName,
      at: new Date().toISOString(),
    };
    writeQueue([...readQueue(), entry]);
    void flushErrlog();
  } catch { /* a naplózás sosem dobhat */ }
}

export async function flushErrlog(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    const q = readQueue();
    if (!q.length) return;
    const { data } = await supabase.auth.getSession();
    const uid = data.session?.user.id;
    if (!uid) return; // bejelentkezés nélkül nem tudunk írni — marad a sorban
    const rows = q.map((e) => ({
      user_id: uid, kind: e.kind, message: e.message,
      detail: { ...(e.detail && typeof e.detail === 'object' ? e.detail : { value: e.detail }), client_time: e.at },
      route: e.route, app_version: e.app_version, user_agent: e.user_agent, user_name: e.user_name ?? userName,
    }));
    const { error } = await supabase.from('client_errors').insert(rows);
    // siker, vagy a szerver végleg elutasította (pl. a tábla még nincs kint): ne halmozzuk
    if (!error || /^(22|23|42|P0|PGRST[12])/.test(String((error as any).code ?? ''))) writeQueue([]);
  } catch { /* offline — később újra */ } finally { flushing = false; }
}

/** El nem kapott JS-hibák és promise-elutasítások figyelése (web). */
export function installGlobalErrorLogging(): void {
  if (Platform.OS !== 'web' || typeof window === 'undefined' || (window as any).__ktgErrlog) return;
  (window as any).__ktgErrlog = true;
  window.addEventListener('error', (e: ErrorEvent) => {
    if (!e?.message || e.message === 'Script error.' || /ResizeObserver loop/.test(e.message)) return;
    logError('js', e.message, { file: e.filename, line: e.lineno, col: e.colno, stack: e.error?.stack?.split('\n').slice(0, 6).join('\n') });
  });
  window.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
    const r: any = e?.reason;
    const msg = String(r?.message ?? r ?? '');
    // hálózati hibák nem rendszerhibák — offline is működik az app
    if (!msg || /Failed to fetch|NetworkError|Load failed|network|AbortError|aborted/i.test(msg)) return;
    logError('promise', msg, errInfo(r));
  });
}
