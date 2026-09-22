// Feladat-összesítő (Excel) — az export-data funkció `mode: 'tasks'` ága.
// Helyszínenként a hozzá tartozó feladatok kódjai, feladatonként a munkaóra,
// a munkabér, a kiszállás és az anyagköltség. Egy feladatra (task_id), egy
// helyszínre (site_id), állapotra (status: all | open | done | failed) és időszakra
// szűrhető: kész / nem sikerült feladatnál a lezárás dátuma, egyébként a kiadás dátuma szerint.

import * as XLSX from 'npm:xlsx@0.18.5';

const hd = (d: string | null) => (d ? d.slice(0, 10).replace(/-/g, '.') + '.' : '');
const r2 = (n: number) => Math.round(n * 100) / 100;
const STATUS: Record<string, string> = { assigned: 'kiadva', acknowledged: 'folyamatban', done: 'kész', failed: 'nem sikerült', cancelled: 'visszavonva' };

export type TaskStatusFilter = 'all' | 'open' | 'done' | 'failed';
export interface TaskFilter { taskId: string | null; siteId: string | null; from: string; to: string; status: TaskStatusFilter }
/** időbélyeg → magyar naptári nap (ÉÉÉÉ-HH-NN) */
const budDay = (iso: string) => new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'Europe/Budapest' });

export async function exportTasks(supabase: any, f: TaskFilter, json: (b: unknown, s?: number) => Response) {
  let tq = supabase.from('worker_tasks')
    .select('id, code, title, status, site_id, created_at, done_at, quote_amount, quote_accepted_at, item_code_id, item_codes(code, name)')
    .is('deleted_at', null).order('created_at');
  if (f.taskId) tq = tq.eq('id', f.taskId);
  if (f.siteId) tq = tq.eq('site_id', f.siteId);
  if (f.status === 'done') tq = tq.eq('status', 'done');
  else if (f.status === 'failed') tq = tq.eq('status', 'failed');
  else if (f.status === 'open') tq = tq.in('status', ['assigned', 'acknowledged']);
  const [{ data: tasks, error }, { data: sites }, { data: workers }, { data: assignees }, { data: sessions },
    { data: attendance }, { data: materials }, { data: pricing }, { data: finance }] = await Promise.all([
    tq,
    supabase.from('sites').select('id, name, address'),
    supabase.from('workers').select('id, name'),
    supabase.from('task_assignees').select('task_id, worker_id').is('deleted_at', null),
    supabase.from('work_sessions').select('task_id, worker_id, started_at, ended_at').is('deleted_at', null).not('ended_at', 'is', null).not('task_id', 'is', null),
    supabase.from('attendance').select('task_id, worker_id, work_date, pay_basis, hours, day_multiplier, applied_rate, amount, commission_amount, callout_fee, paid_at').is('deleted_at', null).not('task_id', 'is', null),
    supabase.from('task_materials').select('id, task_id, worker_id, amount, note, created_at').is('deleted_at', null),
    supabase.from('task_material_pricing').select('material_id, resale_net').is('deleted_at', null),
    supabase.from('task_finance').select('task_id, invoice_net').is('deleted_at', null),
  ]);
  if (error) throw error;

  const siteOf = new Map<string, { name: string; address: string }>((sites ?? []).map((s: any) => [s.id, { name: s.name, address: s.address ?? '' }]));
  const nameOf = (id: string | null) => (id ? ((workers ?? []).find((w: any) => w.id === id)?.name ?? '?') : '');
  const resaleOf = new Map<string, number>((pricing ?? []).map((p: any) => [p.material_id, Number(p.resale_net)]));
  const invoiceOf = new Map<string, number | null>((finance ?? []).map((x: any) => [x.task_id, x.invoice_net == null ? null : Number(x.invoice_net)]));
  // időszak-szűrés magyar naptári nap szerint (lezárás vagy kiadás dátuma)
  const byDone = f.status === 'done' || f.status === 'failed';
  const list = ((tasks ?? []) as any[]).filter((t) => {
    if (f.taskId) return true;
    const d = budDay((byDone && t.done_at) || t.created_at);
    return d >= f.from && d <= f.to;
  });
  const ids = new Set(list.map((t) => t.id));
  const by = <T extends { task_id: string }>(rows: T[] | null) => {
    const m = new Map<string, T[]>();
    for (const r of rows ?? []) if (ids.has(r.task_id)) m.set(r.task_id, [...(m.get(r.task_id) ?? []), r]);
    return m;
  };
  const assBy = by<any>(assignees), sesBy = by<any>(sessions), attBy = by<any>(attendance), matBy = by<any>(materials);

  // egy sor = egy feladat egy munkavállalóval (a vállalkozó emberei külön sorban); a feladat-szintű
  // értékek (elfogadott ajánlat bére, továbbszámlázott anyag, kiszámlázott, haszon) az első soron állnak
  type Row = {
    taskId: string; first: boolean; site: string; code: string; item: string; title: string; status: string; worker: string; hours: number;
    wage: number; callout: number; matCost: number; cost: number; matResale: number; invoice: number | null; profit: number | null;
    created: string; done: string; siteId: string;
  };
  const rows: Row[] = list.flatMap((t) => {
    const s = siteOf.get(t.site_id) ?? { name: '— helyszín nélkül —', address: '' };
    const att = attBy.get(t.id) ?? [];
    const ses = sesBy.get(t.id) ?? [];
    const mats = matBy.get(t.id) ?? [];
    const matResale = mats.reduce((a, m) => a + (resaleOf.get(m.id) ?? 0), 0);
    const invoice = invoiceOf.get(t.id) ?? null;
    const quoteWage = t.quote_accepted_at && t.quote_amount != null ? Number(t.quote_amount) : null;
    // kiosztottak + akinek munkaideje / anyagköltsége van a feladaton (a kiosztás sorrendjében)
    const wids: (string | null)[] = [...new Set<string | null>([
      ...(assBy.get(t.id) ?? []).map((a: any) => a.worker_id as string),
      ...att.map((a: any) => a.worker_id as string),
      ...mats.map((m: any) => m.worker_id as string | null).filter((x) => x),
    ])];
    if (wids.length === 0) wids.push(null);
    const base = {
      taskId: t.id, site: s.name, code: t.code ?? '', item: t.item_codes ? `${t.item_codes.code} ${t.item_codes.name}` : '', title: t.title,
      status: STATUS[t.status] ?? t.status, created: hd(t.created_at), done: hd(t.done_at), siteId: t.site_id ?? '',
    };
    let taskCost = 0;
    const out: Row[] = wids.map((wid, i) => {
      const first = i === 0;
      const myAtt = att.filter((a: any) => a.worker_id === wid);
      const callout = myAtt.reduce((a, x) => a + Number(x.callout_fee ?? 0), 0);
      // bér: elfogadott ajánlatnál az ajánlat összege (első sor), egyébként a könyvelt napok (a kiszállás külön oszlop)
      const wage = quoteWage != null ? (first ? quoteWage : 0) : myAtt.reduce((a, x) => a + Number(x.amount), 0) - callout;
      // munkaóra: az elszámolt (bérrel könyvelt) órák; ahol nincs ilyen (pl. elfogadott ajánlat), a tényleges munkaidő
      const booked = myAtt.reduce((a, x) => a + Number(x.hours ?? 0), 0);
      const hours = booked > 0 ? r2(booked)
        : r2(ses.filter((x: any) => x.worker_id === wid).reduce((a, x) => a + (new Date(x.ended_at).getTime() - new Date(x.started_at).getTime()) / 3600000, 0));
      // anyag: a munkavállaló saját tételei; a vezető által (munkavállaló nélkül) rögzített tétel az első soron
      const matCost = mats.filter((m: any) => m.worker_id === wid || (first && !m.worker_id)).reduce((a, m) => a + Number(m.amount), 0);
      const cost = wage + callout + matCost;
      taskCost += cost;
      return { ...base, first, worker: wid ? nameOf(wid) : '', hours, wage, callout, matCost, cost,
        matResale: first ? matResale : 0, invoice: first ? invoice : null, profit: null };
    });
    if (invoice != null) out[0].profit = invoice + matResale - taskCost;
    return out;
  }).sort((a, b) => a.site.localeCompare(b.site, 'hu') || a.code.localeCompare(b.code, 'hu') || a.taskId.localeCompare(b.taskId) || (a.first ? -1 : b.first ? 1 : 0));

  const taskSheet = rows.map((r) => ({
    'Feladat kód': r.code, 'Helyszín': r.site, 'Cikktörzs': r.item, 'Feladat': r.title, 'Állapot': r.status, 'Munkavállaló': r.worker,
    'Munkaóra': r.hours, 'Munkabér (Ft)': r.wage, 'Kiszállás (Ft)': r.callout, 'Anyagköltség (Ft)': r.matCost, 'Összes költség (Ft)': r.cost,
    'Anyag továbbszámlázva (Ft)': r.first ? r.matResale : '', 'Kiszámlázott (Ft)': r.invoice ?? '', 'Haszon (Ft)': r.profit ?? '',
    'Kiadva': r.created, 'Elkészült': r.done,
  }));
  const sum = (f: (r: Row) => number, rs: Row[] = rows) => rs.reduce((s, r) => s + f(r), 0);
  const taskCount = new Set(rows.map((r) => r.taskId)).size;
  taskSheet.push({
    'Feladat kód': 'ÖSSZESEN', 'Helyszín': '', 'Cikktörzs': '', 'Feladat': `${taskCount} feladat`, 'Állapot': '', 'Munkavállaló': '',
    'Munkaóra': r2(sum((r) => r.hours)), 'Munkabér (Ft)': sum((r) => r.wage), 'Kiszállás (Ft)': sum((r) => r.callout),
    'Anyagköltség (Ft)': sum((r) => r.matCost), 'Összes költség (Ft)': sum((r) => r.cost), 'Anyag továbbszámlázva (Ft)': sum((r) => r.matResale),
    'Kiszámlázott (Ft)': sum((r) => r.invoice ?? 0), 'Haszon (Ft)': sum((r) => r.profit ?? 0), 'Kiadva': '', 'Elkészült': '',
  });

  // helyszínenként: a csatolt feladatkódok és az összegek
  const siteGroups = new Map<string, Row[]>();
  for (const r of rows) siteGroups.set(r.siteId, [...(siteGroups.get(r.siteId) ?? []), r]);
  const siteSheet = [...siteGroups.values()].map((rs) => ({
    'Helyszín': rs[0].site,
    'Feladat kódok': [...new Set(rs.map((r) => r.code || r.title))].join(', '), 'Feladatok (db)': new Set(rs.map((r) => r.taskId)).size,
    'Munkaóra': r2(sum((r) => r.hours, rs)), 'Munkabér (Ft)': sum((r) => r.wage, rs), 'Kiszállás (Ft)': sum((r) => r.callout, rs),
    'Anyagköltség (Ft)': sum((r) => r.matCost, rs), 'Összes költség (Ft)': sum((r) => r.cost, rs),
    'Anyag továbbszámlázva (Ft)': sum((r) => r.matResale, rs), 'Kiszámlázott (Ft)': sum((r) => r.invoice ?? 0, rs),
  }));

  // munkaidő-napok feladatonként (a könyvelt bér-sorok)
  const codeOf = new Map(list.map((t) => [t.id, t.code || t.title]));
  const siteNameOf = new Map(list.map((t) => [t.id, siteOf.get(t.site_id)?.name ?? '']));
  const daySheet = (attendance ?? []).filter((a: any) => ids.has(a.task_id))
    .sort((a: any, b: any) => a.work_date.localeCompare(b.work_date))
    .map((a: any) => ({
      'Helyszín': siteNameOf.get(a.task_id) ?? '', 'Feladat kód': codeOf.get(a.task_id) ?? '', 'Munkavállaló': nameOf(a.worker_id), 'Dátum': hd(a.work_date),
      'Elszámolás': a.pay_basis === 'hourly' ? `órabér (${a.hours} ó)` : a.pay_basis === 'daily' ? (Number(a.day_multiplier) === 0 ? 'napi díj máshol elszámolva' : 'napi díj') : a.pay_basis === 'project' ? 'projektdíj' : 'jelenlét',
      'Órák': Number(a.hours ?? 0), 'Munkabér (Ft)': Number(a.amount) - Number(a.callout_fee ?? 0), 'Kiszállás (Ft)': Number(a.callout_fee ?? 0),
      'Ebből közvetítőé (Ft)': Number(a.commission_amount ?? 0), 'Kifizetve': a.paid_at ? 'igen' : 'nem',
    }));

  const matSheet = (materials ?? []).filter((m: any) => ids.has(m.task_id))
    .sort((a: any, b: any) => a.created_at.localeCompare(b.created_at))
    .map((m: any) => ({
      'Helyszín': siteNameOf.get(m.task_id) ?? '', 'Feladat kód': codeOf.get(m.task_id) ?? '', 'Dátum': hd(m.created_at), 'Rögzítette': nameOf(m.worker_id),
      'Összeg (Ft)': Number(m.amount), 'Továbbszámlázva (Ft)': resaleOf.get(m.id) ?? '', 'Megjegyzés': m.note ?? '',
    }));

  const wb = XLSX.utils.book_new();
  const s1 = XLSX.utils.json_to_sheet(taskSheet);
  s1['!cols'] = [{ wch: 12 }, { wch: 26 }, { wch: 28 }, { wch: 32 }, { wch: 12 }, { wch: 24 }, { wch: 9 }, { wch: 13 }, { wch: 13 }, { wch: 15 }, { wch: 16 }, { wch: 20 }, { wch: 15 }, { wch: 13 }, { wch: 12 }, { wch: 12 }];
  const s2 = XLSX.utils.json_to_sheet(siteSheet);
  s2['!cols'] = [{ wch: 26 }, { wch: 40 }, { wch: 12 }, { wch: 9 }, { wch: 13 }, { wch: 13 }, { wch: 15 }, { wch: 16 }, { wch: 20 }, { wch: 15 }];
  const s3 = XLSX.utils.json_to_sheet(daySheet);
  s3['!cols'] = [{ wch: 26 }, { wch: 14 }, { wch: 24 }, { wch: 12 }, { wch: 24 }, { wch: 7 }, { wch: 13 }, { wch: 13 }, { wch: 16 }, { wch: 9 }];
  const s4 = XLSX.utils.json_to_sheet(matSheet);
  s4['!cols'] = [{ wch: 26 }, { wch: 14 }, { wch: 12 }, { wch: 24 }, { wch: 12 }, { wch: 18 }, { wch: 36 }];
  XLSX.utils.book_append_sheet(wb, s1, 'Feladatok');
  XLSX.utils.book_append_sheet(wb, s2, 'Helyszínek');
  XLSX.utils.book_append_sheet(wb, s3, 'Munkaidő');
  XLSX.utils.book_append_sheet(wb, s4, 'Anyagok');
  const stem = f.taskId && rows[0] ? `feladat_${(rows[0].code || 'osszefoglalo').replace(/[^\w-]+/g, '_')}`
    : `${{ all: 'feladatok', open: 'folyamatban_feladatok', done: 'kesz_feladatok', failed: 'nem_sikerult_feladatok' }[f.status]}_${f.from}_${f.to}`;
  return json({
    filename: `${stem}.xlsx`,
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    base64: XLSX.write(wb, { type: 'base64', bookType: 'xlsx' }),
  });
}
