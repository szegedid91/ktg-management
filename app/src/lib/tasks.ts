// Feladat-számítások a lokális tükörből: munkaidő, bérköltség (idő- vagy
// ajánlat-alapú), anyagköltség/továbbszámlázás, haszon.

import { TaskMaterial, TaskStatus, Worker, WorkerTask, WorkSession } from './types';

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

export function materialTotals(materials: TaskMaterial[]) {
  const cost = materials.reduce((s, m) => s + Number(m.amount), 0);
  const priced = materials.filter((m) => m.resale_net != null);
  const unpriced = materials.filter((m) => m.resale_net == null);
  const resale = priced.reduce((s, m) => s + Number(m.resale_net), 0);
  return { cost, resale, unpriced, priced };
}

/** Haszon = kiszámlázott + továbbszámlázott anyag − bér − anyag beszerzési ár */
export function taskProfit(task: WorkerTask, wage: number, materials: TaskMaterial[]): number | null {
  if (task.invoice_net == null) return null;
  const m = materialTotals(materials);
  return Number(task.invoice_net) + m.resale - wage - m.cost;
}
