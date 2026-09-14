// Feladat-számítások a lokális tükörből: munkaidő, bérköltség (idő- vagy
// ajánlat-alapú), anyagköltség/továbbszámlázás, haszon.

import { TaskMaterial, TaskMaterialPricing, TaskQuote, TaskStatus, Worker, WorkerTask, WorkSession } from './types';

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
  const days = new Set(own.map((s) => s.started_at.slice(0, 10))).size;
  const running = own.some((s) => !s.ended_at);
  const finishedAt = task.done_at ?? null;
  return { startedAt, finishedAt, hours, days, running };
}

/** Bérköltség: elfogadott ajánlat → az ajánlat; különben a munkavállaló
 *  elszámolási módja szerint idő-alapú (óra / nap / projekt). */
export function taskWageCost(
  task: WorkerTask, assigneeWorkers: Worker[], sessions: WorkSession[], now = Date.now(),
): { total: number; parts: { worker: Worker; basis: string; amount: number; hours: number }[] } {
  if (task.quote_amount != null && task.quote_accepted_at) {
    return { total: Number(task.quote_amount), parts: [] };
  }
  const parts = assigneeWorkers.map((w) => {
    const own = sessions.filter((s) => s.task_id === task.id && s.worker_id === w.id);
    const hours = own.reduce((sum, s) => sum + sessionHours(s, now), 0);
    const days = new Set(own.map((s) => s.started_at.slice(0, 10))).size;
    const basis = w.default_pay_basis ?? 'hourly';
    let amount = 0;
    if (basis === 'hourly') amount = hours * Number(w.hourly_rate ?? 0);
    else if (basis === 'daily') amount = days * Number(w.daily_rate ?? 0);
    else amount = own.length > 0 ? Number(w.project_rate ?? 0) : 0;
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

/** Haszon = kiszámlázott + továbbszámlázott anyag − bér − anyag beszerzési ár */
export function taskProfit(invoiceNet: number | null | undefined, wage: number, materials: TaskMaterial[], pricing: TaskMaterialPricing[]): number | null {
  if (invoiceNet == null) return null;
  const m = materialTotals(materials, pricing);
  return Number(invoiceNet) + m.resale - wage - m.cost;
}
