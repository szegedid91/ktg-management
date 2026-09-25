import { localDateISO } from './format';
// Feladat-számítások a lokális tükörből: munkaidő, bérköltség (idő- vagy
// ajánlat-alapú), anyagköltség/továbbszámlázás, haszon.

import { TaskMaterial, TaskMaterialPricing, TaskQuote, TaskStatus, Worker, WorkerTask, WorkSession, AppSettings, Attendance } from './types';

/** Munkavállaló megjelenített neve: becenév, ha van. */
export function wname(w: { name: string; nickname?: string | null } | undefined | null): string {
  if (!w) return '?';
  return w.nickname?.trim() ? w.nickname.trim() : w.name;
}

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  assigned: 'Kiadva — elfogadásra vár',
  acknowledged: 'Elfogadva — folyamatban',
  done: 'Kész',
  failed: 'Nem sikerült',
  cancelled: 'Visszavonva',
};

export function isActiveTask(t: WorkerTask): boolean {
  return t.status === 'assigned' || t.status === 'acknowledged';
}

/** A munkavállalónak nyitott feladat: a futók és a „nem sikerült” is — az utóbbi
 *  folytatható és készre jelenthető (pl. aznap nem volt eszköz); csak a kész és
 *  a visszavont tűnik el neki. */
export function isOpenForWorker(t: WorkerTask): boolean {
  return isActiveTask(t) || (t.status === 'failed' && !t.closed_at);
}

/** Nem sikerültre jelentett, még el nem döntött feladat: a vezető teendője (kész / lezárás) */
export function isFailedOpen(t: WorkerTask): boolean {
  return t.status === 'failed' && !t.closed_at;
}

/** Kifizetetlen bér-sor, amiben a munkavállalónak tényleg jár pénz
 *  (a 0 Ft-os / csak jelenlét sorok nem számítanak) — minden képernyő ezt használja */
export function unpaidWorkerPart(a: { pay_basis: string; paid_at: string | null; amount: number | string; commission_amount: number | string }): number {
  if (a.pay_basis === 'presence' || a.paid_at) return 0;
  const part = Number(a.amount) - Number(a.commission_amount);
  return part > 0 ? part : 0;
}

/** Lejárt határidő (aktív feladatnál) */
export function isOverdue(t: WorkerTask, today: string): boolean {
  return isActiveTask(t) && !!t.due_date && t.due_date < today;
}

/** Hét kezdete (hétfő) ISO dátumból */
export function weekStartISO(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  const dow = (d.getDay() + 6) % 7; // 0 = hétfő
  d.setDate(d.getDate() - dow);
  return d.toISOString().slice(0, 10);
}

// ---------- ajánlatok ----------
export const QUOTE_STATUS_LABEL: Record<TaskQuote['status'], string> = {
  requested: 'ajánlatra vár', submitted: 'elfogadásra vár', accepted: 'elfogadva',
  rejected: 'elutasítva', declined: 'nem vállalja',
};
export const QUOTE_STATUS_COLOR: Record<TaskQuote['status'], string> = {
  requested: '#B7791F', submitted: '#2B6CB0', accepted: '#2F855A', rejected: '#C53030', declined: '#718096',
};

/** A feladat ajánlat-sorai (legfrissebb elöl). */
export function quotesOf(taskId: string, quotes: TaskQuote[]): TaskQuote[] {
  return quotes.filter((q) => q.task_id === taskId).sort((a, b) => b.requested_at.localeCompare(a.requested_at));
}

/** Egy munkavállaló legutóbbi ajánlat-sora a feladathoz (ha volt kérés). */
export function myQuote(taskId: string, workerId: string | null | undefined, quotes: TaskQuote[]): TaskQuote | null {
  if (!workerId) return null;
  return quotesOf(taskId, quotes).find((q) => q.worker_id === workerId) ?? null;
}

/** Nyitott (ajánlatra váró / beküldött) sorok a feladathoz. */
export function openQuotes(taskId: string, quotes: TaskQuote[]): TaskQuote[] {
  return quotesOf(taskId, quotes).filter((q) => q.status === 'requested' || q.status === 'submitted');
}

/** Rövid állapotcímke listákhoz. Munkavállalónál a sajátja, partnernél az
 *  összesítés (hány ajánlat vár visszaigazolásra / kire várunk). */
export function quoteLabel(task: WorkerTask, quotes: TaskQuote[], myWorkerId?: string | null): string | null {
  if (!task.quote_requested && !quotes.some((q) => q.task_id === task.id)) return null;
  if (task.quote_accepted_at) return null; // elfogadva → normál állapot
  if (myWorkerId) {
    const q = myQuote(task.id, myWorkerId, quotes);
    if (!q) return null;
    if (q.status === 'requested') return 'ajánlatkérés';
    if (q.status === 'submitted') return 'visszaigazolásra vár';
    return QUOTE_STATUS_LABEL[q.status];
  }
  // normál (nem ajánlatos) vagy már folyamatban lévő feladatnál a régi, lezárt
  // ajánlat-sorok szövege nem takarhatja el a valódi állapotot
  if (!task.quote_requested || task.status === 'acknowledged') return null;
  const open = openQuotes(task.id, quotes);
  const submitted = open.filter((q) => q.status === 'submitted');
  if (submitted.length === 1) return `ajánlat ${fmtFt(submitted[0].amount ?? 0)} · elfogadásra vár`;
  if (submitted.length > 1) return `${submitted.length} ajánlat elfogadásra vár`;
  if (open.length > 0) return 'ajánlatra vár';
  const all = quotesOf(task.id, quotes);
  if (all.length > 0) return all.every((q) => q.status === 'declined') ? 'nem vállalták — kérj új ajánlatot' : 'ajánlat elutasítva — kérj újat';
  return 'ajánlatra vár';
}

function fmtFt(n: number): string {
  return `${Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} Ft`;
}

/** Egy munkamenet hossza órában (nyitottnál mostanáig). */
export function sessionHours(s: WorkSession, now = Date.now()): number {
  const start = new Date(s.started_at).getTime();
  const end = s.ended_at ? new Date(s.ended_at).getTime() : now;
  return Math.max(0, (end - start) / 3_600_000);
}

/** Több munkamenet együttes ideje ÁTFEDÉS NÉLKÜL (párhuzamos feladatoknál egy óra csak egyszer
 *  számít — a szerver is így számol bért). */
export function unionHours(list: WorkSession[], now = Date.now()): number {
  const iv = list.map((s) => [new Date(s.started_at).getTime(), s.ended_at ? new Date(s.ended_at).getTime() : now] as [number, number])
    .filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  let total = 0; let curS = -1; let curE = -1;
  for (const [a, b] of iv) {
    if (curE < 0 || a > curE) { if (curE >= 0) total += curE - curS; curS = a; curE = b; }
    else if (b > curE) curE = b;
  }
  if (curE >= 0) total += curE - curS;
  return total / 3_600_000;
}

export function fmtHours(h: number): string {
  const totalMin = Math.round(h * 60);
  const hh = Math.floor(totalMin / 60);
  const mm = totalMin % 60;
  return hh > 0 ? `${hh} ó ${mm} p` : `${mm} p`;
}

export interface TaskTiming {
  startedAt: string | null;
  finishedAt: string | null;
  /** összes ledolgozott idő órában (nyitott menet mostanáig) */
  hours: number;
  /** naptári napok száma, amikor dolgoztak rajta */
  days: number;
  running: boolean;
}

export function taskTiming(task: WorkerTask, sessions: WorkSession[], now = Date.now()): TaskTiming {
  const own = sessions.filter((s) => s.task_id === task.id);
  const startedAt = own.length
    ? own.reduce((min, s) => (s.started_at < min ? s.started_at : min), own[0].started_at)
    : null;
  const hours = own.reduce((sum, s) => sum + sessionHours(s, now), 0);
  const days = new Set(own.map((s) => localDateISO(s.started_at))).size;
  const running = own.some((s) => !s.ended_at);
  const finishedAt = task.done_at ?? null;
  return { startedAt, finishedAt, hours, days, running };
}

/** Bérköltség: elfogadott ajánlat → az ajánlat; különben a munkavállaló
 *  elszámolási módja szerint idő-alapú (óra / nap / projekt). */
export function taskWageCost(
  task: WorkerTask, assigneeWorkers: Worker[], sessions: WorkSession[], settings?: AppSettings | null, now = Date.now(),
): { total: number; parts: { worker: Worker; basis: string; amount: number; hours: number }[] } {
  if (task.quote_amount != null && task.quote_accepted_at) {
    return { total: Number(task.quote_amount), parts: [] };
  }
  // díj a szerverrel egyezően: saját díj, különben a céges/magánszemély alapdíj
  const rateOf = (w: Worker, k: 'hourly' | 'daily' | 'project'): number => {
    const own = (w as any)[`${k}_rate`];
    if (own != null && own !== '') return Number(own);
    return settings ? Number((settings as any)[`${w.worker_type}_${k}_rate`] ?? 0) : 0;
  };
  // fn_worker_auto_basis: a beállított mód, ha van hozzá díj; különben napi, különben óra, különben projekt
  const basisOf = (w: Worker): 'hourly' | 'daily' | 'project' => {
    const pref = (w.default_pay_basis ?? 'hourly') as 'hourly' | 'daily' | 'project';
    if (pref === 'hourly' && rateOf(w, 'hourly') > 0) return 'hourly';
    if (pref === 'daily' && rateOf(w, 'daily') > 0) return 'daily';
    if (pref === 'project' && rateOf(w, 'project') > 0) return 'project';
    if (rateOf(w, 'hourly') > 0) return 'hourly';
    if (rateOf(w, 'daily') > 0) return 'daily';
    return 'project';
  };
  const parts = assigneeWorkers.map((w) => {
    const own = sessions.filter((s) => s.task_id === task.id && s.worker_id === w.id);
    const hours = own.reduce((sum, s) => sum + sessionHours(s, now), 0);
    // megkezdett órák naponként és építkezésenként (a szerver így kerekít)
    const byDay = new Map<string, number>();
    for (const s of own) {
      const k = `${localDateISO(s.started_at)}|${s.site_id ?? ''}`;
      byDay.set(k, (byDay.get(k) ?? 0) + sessionHours(s, now));
    }
    const wholeHours = [...byDay.values()].reduce((sum, h) => sum + Math.ceil(Math.round(h * 1e4) / 1e4), 0);
    const days = new Set(own.map((s) => localDateISO(s.started_at))).size;
    const basis = basisOf(w);
    let amount = 0;
    if (basis === 'hourly') amount = wholeHours * rateOf(w, 'hourly');
    else if (basis === 'daily') amount = days * rateOf(w, 'daily');
    else amount = own.length > 0 ? rateOf(w, 'project') : 0;
    return { worker: w, basis, amount: Math.round(amount), hours };
  });
  return { total: parts.reduce((s, p) => s + p.amount, 0), parts };
}

/** Anyag összesítés; a beárazás külön (csak-partner) táblából jön. */
export function materialTotals(materials: TaskMaterial[], pricing: TaskMaterialPricing[] = []) {
  const priceOf = (m: TaskMaterial) => pricing.find((p) => p.material_id === m.id) ?? null;
  const cost = materials.reduce((s, m) => s + Number(m.amount), 0);
  const priced = materials.filter((m) => priceOf(m));
  const unpriced = materials.filter((m) => !priceOf(m));
  const resale = priced.reduce((s, m) => s + Number(priceOf(m)!.resale_net), 0);
  return { cost, resale, unpriced, priced, priceOf };
}

/** A nap bér-sorának (munkavállaló × helyszín × nap) a feladatra eső része. A bér napra és
 *  helyszínre egyben képződik; ha aznap ugyanott több feladaton is dolgozott (párhuzamos
 *  feladatok), a sort a feladatokra fordított munkaidő arányában osztjuk el. Az elfogadott
 *  ajánlatos feladat menetei nem számítanak (azt az ajánlat fizeti). A kézzel rögzített nap
 *  teljes egészében a rajta megjelölt feladaté. */
export type TaskWageShare = { row: Attendance; share: number; hours: number; amount: number; commission: number; callout: number };
export function taskWageShares(taskId: string, attendance: Attendance[], sessions: WorkSession[], tasks: WorkerTask[]): TaskWageShare[] {
  const quoted = new Set(tasks.filter((t) => t.quote_accepted_at).map((t) => t.id));
  const closed = sessions.filter((s) => s.ended_at && !s.deleted_at);
  const key = (w: string, site: string | null, day: string) => `${w}|${site ?? ''}|${day}`;
  const dur = (s: WorkSession) => Math.max(0, new Date(s.ended_at!).getTime() - new Date(s.started_at).getTime());
  // a feladat menetei által érintett napok
  const days = new Set(closed.filter((s) => s.task_id === taskId).map((s) => key(s.worker_id, s.site_id, localDateISO(s.started_at))));
  const out: TaskWageShare[] = [];
  for (const a of attendance) {
    if (a.deleted_at) continue;
    const k = key(a.worker_id, a.site_id, a.work_date);
    let share = 0;
    if (a.source !== 'session') share = a.task_id === taskId ? 1 : 0;
    else if (a.task_id === taskId || days.has(k)) {
      const ds = closed.filter((s) => key(s.worker_id, s.site_id, localDateISO(s.started_at)) === k && !(s.task_id && quoted.has(s.task_id)));
      const total = ds.reduce((x, s) => x + dur(s), 0);
      const mine = ds.filter((s) => s.task_id === taskId).reduce((x, s) => x + dur(s), 0);
      share = total > 0 ? mine / total : (a.task_id === taskId ? 1 : 0);
    }
    if (share <= 0) continue;
    const r = (n: number) => Math.round(n * share);
    out.push({ row: a, share, hours: Math.round(Number(a.hours ?? 0) * share * 100) / 100,
      amount: r(Number(a.amount)), commission: r(Number(a.commission_amount ?? 0)), callout: r(Number(a.callout_fee ?? 0)) });
  }
  return out.sort((x, y) => x.row.work_date.localeCompare(y.row.work_date));
}

/** Haszon = kiszámlázott + továbbszámlázott anyag − bér − anyag beszerzési ár */
export function taskProfit(invoiceNet: number | null | undefined, wage: number, materials: TaskMaterial[], pricing: TaskMaterialPricing[]): number | null {
  if (invoiceNet == null) return null;
  const m = materialTotals(materials, pricing);
  return Number(invoiceNet) + m.resale - wage - m.cost;
}
