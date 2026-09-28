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

/** Teljes lekérés lapozva: a PostgREST alapból 1000 sornál csendben csonkol. */
export async function fetchAll(build: () => any, page = 1000): Promise<any[]> {
  const out: any[] = [];
  for (let from = 0; ; from += page) {
    const { data, error } = await build().order('id').range(from, from + page - 1);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < page) break;
  }
  return out;
}

export async function exportTasks(supabase: any, f: TaskFilter, json: (b: unknown, s?: number) => Response) {
  const taskQuery = () => {
    let tq = supabase.from('worker_tasks')
      .select('id, code, title, status, site_id, created_at, done_at, closed_at, quote_amount, quote_accepted_at, item_code_id, item_codes(code, name)')
      .is('deleted_at', null);
    if (f.taskId) tq = tq.eq('id', f.taskId);
    if (f.siteId) tq = tq.eq('site_id', f.siteId);
    if (f.status === 'done') tq = tq.eq('status', 'done');
    else if (f.status === 'failed') tq = tq.eq('status', 'failed');
    // „folyamatban”: a kiadott / elfogadott, és a nyitva hagyott „nem sikerült” (a munkavállalónál még él)
    else if (f.status === 'open') tq = tq.or('status.in.(assigned,acknowledged),and(status.eq.failed,closed_at.is.null)');
    return tq;
  };
  const tasksAll = (await fetchAll(taskQuery)).sort((a: any, b: any) => String(a.created_at).localeCompare(String(b.created_at)));
  // időszak-szűrés magyar naptári nap szerint (lezárás vagy kiadás dátuma)
  const byDone = f.status === 'done' || f.status === 'failed';
  const list = (tasksAll as any[]).filter((t) => {
    if (f.taskId) return true;
    const d = budDay((byDone && (t.closed_at ?? t.done_at)) || t.created_at);
    return d >= f.from && d <= f.to;
  });
  const ids = new Set(list.map((t) => t.id));
  const idList = [...ids];
  const inChunks = async (build: (chunk: string[]) => any) => {
    const out: any[] = [];
    for (let i = 0; i < idList.length; i += 200) out.push(...await fetchAll(() => build(idList.slice(i, i + 200))));
    return out;
  };
  // a feladatok munkamenetei → az érintett munkavállaló×nap párok bér-sorai (a párhuzamos feladatok miatt a nap
  // összes menete kell, nem csak a listázott feladatoké)
  const ownSessions = idList.length ? await inChunks((c) => supabase.from('work_sessions').select('task_id, worker_id, site_id, started_at, ended_at').is('deleted_at', null).not('ended_at', 'is', null).in('task_id', c)) : [];
  const workerIds = [...new Set(ownSessions.map((x: any) => x.worker_id as string))];
  const dayMin = ownSessions.reduce((m: string | null, x: any) => (m == null || x.started_at < m ? x.started_at : m), null as string | null);
  const dayMax = ownSessions.reduce((m: string | null, x: any) => (m == null || x.started_at > m ? x.started_at : m), null as string | null);
  const fromTs = dayMin ? new Date(new Date(dayMin).getTime() - 2 * 86400000).toISOString() : null;
  const toTs = dayMax ? new Date(new Date(dayMax).getTime() + 2 * 86400000).toISOString() : null;
  const [sites, workers, assignees, sessions, attendance, materials, pricing, finance, quotedTasks] = await Promise.all([
    fetchAll(() => supabase.from('sites').select('id, name, address')),
    fetchAll(() => supabase.from('workers').select('id, name')),
    idList.length ? inChunks((c) => supabase.from('task_assignees').select('id, task_id, worker_id').is('deleted_at', null).in('task_id', c)) : [],
    workerIds.length && fromTs && toTs
      ? fetchAll(() => supabase.from('work_sessions').select('id, task_id, worker_id, site_id, started_at, ended_at').is('deleted_at', null).not('ended_at', 'is', null).in('worker_id', workerIds).gte('started_at', fromTs).lte('started_at', toTs))
      : [],
    idList.length
      ? (async () => {
          const byTask = await inChunks((c) => supabase.from('attendance').select('id, task_id, worker_id, site_id, work_date, source, pay_basis, hours, day_multiplier, applied_rate, amount, commission_amount, callout_fee, paid_at').is('deleted_at', null).in('task_id', c));
          const byDays = workerIds.length && fromTs && toTs
            ? await fetchAll(() => supabase.from('attendance').select('id, task_id, worker_id, site_id, work_date, source, pay_basis, hours, day_multiplier, applied_rate, amount, commission_amount, callout_fee, paid_at').is('deleted_at', null).eq('source', 'session').in('worker_id', workerIds).gte('work_date', fromTs.slice(0, 10)).lte('work_date', toTs.slice(0, 10)))
            : [];
          const seen = new Set<string>();
          return [...byTask, ...byDays].filter((a: any) => (seen.has(a.id) ? false : (seen.add(a.id), true)));
        })()
      : [],
    idList.length ? inChunks((c) => supabase.from('task_materials').select('id, task_id, worker_id, amount, note, created_at').is('deleted_at', null).in('task_id', c)) : [],
    fetchAll(() => supabase.from('task_material_pricing').select('id, material_id, resale_net').is('deleted_at', null)),
    idList.length ? inChunks((c) => supabase.from('task_finance').select('id, task_id, invoice_net').is('deleted_at', null).in('task_id', c)) : [],
    fetchAll(() => supabase.from('worker_tasks').select('id, quote_accepted_at').not('quote_accepted_at', 'is', null)),
  ]);

  const siteOf = new Map<string, { name: string; address: string }>((sites ?? []).map((s: any) => [s.id, { name: s.name, address: s.address ?? '' }]));
  const workerName = new Map<string, string>((workers ?? []).map((w: any) => [w.id, w.name]));
  const nameOf = (id: string | null) => (id ? (workerName.get(id) ?? '?') : '');
  const resaleOf = new Map<string, number>((pricing ?? []).map((p: any) => [p.material_id, Number(p.resale_net)]));
  const invoiceOf = new Map<string, number | null>((finance ?? []).map((x: any) => [x.task_id, x.invoice_net == null ? null : Number(x.invoice_net)]));
  const by = <T extends { task_id: string }>(rows: T[] | null) => {
    const m = new Map<string, T[]>();
    for (const r of rows ?? []) if (ids.has(r.task_id)) m.set(r.task_id, [...(m.get(r.task_id) ?? []), r]);
    return m;
  };
  const assBy = by<any>(assignees), matBy = by<any>(materials);

  // A nap bér-sora (munkavállaló × helyszín × nap) egyben képződik; ha aznap ugyanott több feladaton is
  // dolgozott (párhuzamos feladatok), órabérnél a feladat bére = a rajta töltött megkezdett órák × óradíj,
  // napi/projektdíjnál időarányos rész — ugyanúgy, mint az app feladat oldala (lib/tasks.ts taskWageShares). Az elfogadott ajánlatos feladat menetei
  // nem számítanak; a kézi nap teljes egészében a megjelölt feladaté. A kiszállási díj nem oszlik
  // meg: az aznap ott elsőként kezdett feladaté.
  type Share = { row: any; share: number; hours: number; amount: number; commission: number; callout: number };
  const quoted = new Set((quotedTasks ?? []).map((t: any) => t.id));
  const dayKey = (w: string, site: string | null, day: string) => `${w}|${site ?? ''}|${day}`;
  const dur = (x: any) => Math.max(0, new Date(x.ended_at).getTime() - new Date(x.started_at).getTime());
  const sesByDay = new Map<string, any[]>();
  for (const x of sessions ?? []) { const k = dayKey(x.worker_id, x.site_id, budDay(x.started_at)); sesByDay.set(k, [...(sesByDay.get(k) ?? []), x]); }
  const taskShares = (taskId: string): Share[] => {
    const days = new Set((sessions ?? []).filter((x: any) => x.task_id === taskId).map((x: any) => dayKey(x.worker_id, x.site_id, budDay(x.started_at))));
    const out: Share[] = [];
    for (const a of attendance ?? []) {
      const k = dayKey(a.worker_id, a.site_id, a.work_date);
      let share = 0, first = a.task_id === taskId, mine = 0;
      if (a.source !== 'session') share = a.task_id === taskId ? 1 : 0;
      else if (a.task_id === taskId || days.has(k)) {
        const ds = (sesByDay.get(k) ?? []).filter((x: any) => !(x.task_id && quoted.has(x.task_id)));
        const total = ds.reduce((s: number, x: any) => s + dur(x), 0);
        mine = ds.filter((x: any) => x.task_id === taskId).reduce((s: number, x: any) => s + dur(x), 0);
        share = total > 0 ? mine / total : (a.task_id === taskId ? 1 : 0);
        // a kiszállási díj a napra egyszer jár: az aznap ott elsőként kezdett feladat viseli
        const earliest = ds.slice().sort((x: any, y: any) => String(x.started_at).localeCompare(String(y.started_at)))[0];
        first = earliest ? earliest.task_id === taskId : a.task_id === taskId;
      }
      if (share <= 0) continue;
      const calloutFee = Number(a.callout_fee ?? 0);
      const callout = share >= 1 || first ? calloutFee : 0;
      const dayHours = Number(a.hours ?? 0);
      if (share < 1 && a.pay_basis === 'hourly' && dayHours > 0) {
        // órabéres, több feladat aznap ugyanott: a feladat bére = a rajta töltött MEGKEZDETT órák × óradíj
        const taskHours = Math.max(1, Math.ceil(Math.round(mine / 3600000 * 10000) / 10000));
        const rate = a.applied_rate != null ? Number(a.applied_rate) : (Number(a.amount) - calloutFee) / dayHours;
        out.push({ row: a, share, hours: taskHours, amount: Math.round(taskHours * rate) + callout,
          commission: Math.round(Number(a.commission_amount ?? 0) * taskHours / dayHours), callout });
        continue;
      }
      const r = (n: number) => Math.round(n * share);
      out.push({ row: a, share, hours: Math.round(dayHours * share * 100) / 100,
        amount: r(Number(a.amount) - calloutFee) + callout, commission: r(Number(a.commission_amount ?? 0)), callout });
    }
    return out.sort((x, y) => x.row.work_date.localeCompare(y.row.work_date));
  };
  const sharesOf = new Map<string, Share[]>(list.map((t) => [t.id, taskShares(t.id)]));

  // egy sor = egy feladat egy munkavállalóval (a vállalkozó emberei külön sorban); a feladat-szintű
  // értékek (elfogadott ajánlat bére, továbbszámlázott anyag, kiszámlázott, haszon) az első soron állnak
  type Row = {
    taskId: string; first: boolean; site: string; code: string; item: string; title: string; status: string; worker: string; hours: number;
    wage: number; callout: number; matCost: number; cost: number; matResale: number; invoice: number | null; profit: number | null;
    created: string; done: string; siteId: string;
  };
  const rows: Row[] = list.flatMap((t) => {
    const s = siteOf.get(t.site_id) ?? { name: '— helyszín nélkül —', address: '' };
    const att = sharesOf.get(t.id) ?? [];
    const ses = (sessions ?? []).filter((x: any) => x.task_id === t.id);
    const mats = matBy.get(t.id) ?? [];
    const matResale = mats.reduce((a, m) => a + (resaleOf.get(m.id) ?? 0), 0);
    const invoice = invoiceOf.get(t.id) ?? null;
    const quoteWage = t.quote_accepted_at && t.quote_amount != null ? Number(t.quote_amount) : null;
    // kiosztottak + akinek munkaideje / anyagköltsége van a feladaton (a kiosztás sorrendjében)
    const wids: (string | null)[] = [...new Set<string | null>([
      ...(assBy.get(t.id) ?? []).map((a: any) => a.worker_id as string),
      ...att.map((a) => a.row.worker_id as string),
      ...mats.map((m: any) => m.worker_id as string | null).filter((x) => x),
    ])];
    if (wids.length === 0) wids.push(null);
    const base = {
      taskId: t.id, site: s.name, code: t.code ?? '', item: t.item_codes ? `${t.item_codes.code} ${t.item_codes.name}` : '', title: t.title,
      status: t.status === 'failed' ? (t.closed_at ? 'nem sikerült (lezárva)' : 'nem sikerült (nyitva)') : (STATUS[t.status] ?? t.status), created: hd(t.created_at), done: hd(t.done_at), siteId: t.site_id ?? '',
    };
    let taskCost = 0;
    const out: Row[] = wids.map((wid, i) => {
      const first = i === 0;
      const myAtt = att.filter((a) => a.row.worker_id === wid);
      const callout = myAtt.reduce((a, x) => a + x.callout, 0);
      // bér: elfogadott ajánlatnál az ajánlat összege (első sor), egyébként a könyvelt napok feladatra eső része (a kiszállás külön oszlop)
      const wage = quoteWage != null ? (first ? quoteWage : 0) : myAtt.reduce((a, x) => a + x.amount, 0) - callout;
      // munkaóra: az elszámolt (bérrel könyvelt) órák feladatra eső része; ahol nincs ilyen (pl. elfogadott ajánlat), a tényleges munkaidő
      const booked = myAtt.reduce((a, x) => a + x.hours, 0);
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
  const daySheet = list.flatMap((t) => (sharesOf.get(t.id) ?? []).map((x) => ({ t, x })))
    .sort((p, q) => p.x.row.work_date.localeCompare(q.x.row.work_date))
    .map(({ t, x }) => { const a = x.row; return {
      'Helyszín': siteNameOf.get(t.id) ?? '', 'Feladat kód': codeOf.get(t.id) ?? '', 'Munkavállaló': nameOf(a.worker_id), 'Dátum': hd(a.work_date),
      'Elszámolás': (a.pay_basis === 'hourly' ? `órabér (${a.hours} ó)` : a.pay_basis === 'daily' ? (Number(a.day_multiplier) === 0 ? 'napi díj máshol elszámolva' : 'napi díj') : a.pay_basis === 'project' ? 'projektdíj' : 'jelenlét')
        + (x.share < 1 ? (a.pay_basis === 'hourly' ? ` · ezen a feladaton ${x.hours} megkezdett óra` : ` · a nap ${Math.round(x.share * 100)}%-a`) : '') + (x.share < 1 && x.callout > 0 ? ' · kiszállás a nap első feladatán' : ''),
      'Órák': x.hours, 'Munkabér (Ft)': x.amount - x.callout, 'Kiszállás (Ft)': x.callout,
      'Ebből közvetítőé (Ft)': x.commission, 'Kifizetve': a.paid_at ? 'igen' : 'nem',
    }; });

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
