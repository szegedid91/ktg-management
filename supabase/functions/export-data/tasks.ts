// Feladat-összesítő (Excel) — az export-data funkció `mode: 'tasks'` ága.
// Helyszínenként a hozzá tartozó feladatok kódjai, feladatonként a munkaóra,
// a munkabér, a kiszállás és az anyagköltség. Egy feladatra (task_id), egy
// helyszínre (site_id), állapotra (status: all | open | done | failed) és időszakra
// szűrhető: kész / nem sikerült feladatnál a lezárás dátuma, egyébként a kiadás dátuma szerint.

import * as XLSX from 'npm:xlsx@0.18.5';
import JSZip from 'npm:jszip@3.10.1';

const hd = (d: string | null) => (d ? d.slice(0, 10).replace(/-/g, '.') + '.' : '');
const r2 = (n: number) => Math.round(n * 100) / 100;
const STATUS: Record<string, string> = { assigned: 'kiadva', acknowledged: 'folyamatban', done: 'kész', failed: 'nem sikerült', cancelled: 'visszavonva' };

export type TaskStatusFilter = 'all' | 'open' | 'done' | 'failed';
export interface TaskFilter {
  taskId: string | null; siteId: string | null; from: string; to: string; status: TaskStatusFilter;
  /** elszámolás-elrendezés (ügyfél felé): feladatonként tömb — munkaóra, kiszállás, anyagok, összesen */
  layout?: 'summary' | 'settlement';
  /** csak ennek a munkavállalónak a sorai (elszámolásnál) */
  workerId?: string | null;
  /** feladatkód(ok) (elszámolásnál): egy vagy több sorszám vesszővel, szóközzel vagy új sorban — részlet is elég.
   *  Ha meg van adva, az időszak nem szűr (a megadott sorszámok kellenek, bármikor készültek). */
  code?: string | null;
  /** kimenő (ügyfélnek számlázott) órabér és kiszállási díj — a tömbök „Árak/Díjak” oszlopa */
  billHourly?: number; billCallout?: number;
  /** igaz: ZIP helyett a fájlok listája (út + base64) és hetenként a feladatok azonosítói — az app ebből és a külön
   *  kérésekkel lekért munkalap-PDF-ekből maga állítja össze a ZIP-et (a szerver CPU-kerete nem bírja egyben) */
  asFiles?: boolean;
}
/** időbélyeg → magyar naptári nap (ÉÉÉÉ-HH-NN) */
const budDay = (iso: string) => new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'Europe/Budapest' });

/** ISO-hét (hétfőtől vasárnapig; az év első hete az, amelyikben az első csütörtök van) — ugyanaz, mint az appban
 *  (lib/format.ts isoWeek) és az Excel ISO.HÉT.SZÁMA függvénye. */
function isoWeek(day: string): { year: number; week: number } {
  const d = new Date(day.slice(0, 10) + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 4 - ((d.getUTCDay() + 6) % 7 + 1));
  const year = d.getUTCFullYear();
  return { year, week: Math.ceil(((d.getTime() - Date.UTC(year, 0, 1)) / 86400000 + 1) / 7) };
}
/** az ISO-hét hétfője és vasárnapja (ÉÉÉÉ-HH-NN) */
function isoWeekRange(year: number, week: number): { from: string; to: string } {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const mon = new Date(jan4.getTime() - ((jan4.getUTCDay() + 6) % 7) * 86400000 + (week - 1) * 7 * 86400000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: iso(mon), to: iso(new Date(mon.getTime() + 6 * 86400000)) };
}

/** A beírt / bemásolt sorszám-lista szétszedése: vessző, pontosvessző, szóköz, új sor választ el; ismétlődés
 *  (kis- / nagybetűtől függetlenül) és a LIKE-helyettesítők nélkül. Az összevetés kisbetűsítve történik. */
export function parseCodes(raw: string | null | undefined): string[] {
  const out: string[] = [];
  for (const part of String(raw ?? '').split(/[\s,;]+/)) {
    const c = part.replace(/[%_\\]/g, '').trim();
    if (c && !out.some((x) => x.toLowerCase() === c.toLowerCase())) out.push(c);
    if (out.length >= 500) break;
  }
  return out;
}

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
  const codes = parseCodes(f.code).map((k) => k.toLowerCase());
  const taskQuery = () => {
    let tq = supabase.from('worker_tasks')
      .select('id, code, title, status, site_id, created_at, done_at, closed_at, quote_amount, quote_accepted_at, item_code_id, item_codes(code, name)')
      .is('deleted_at', null);
    if (f.taskId) tq = tq.eq('id', f.taskId);
    if (f.siteId) tq = tq.eq('site_id', f.siteId);
    // egy sorszámnál az adatbázis szűr; többnél a letöltött listát szűrjük (lásd lent)
    if (codes.length === 1) tq = tq.ilike('code', `%${codes[0]}%`);
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
    // megadott sorszám(ok): csak ezek kellenek, az időszaktól függetlenül
    if (codes.length) { const c = String(t.code ?? '').toLowerCase(); return codes.some((k) => c.includes(k)); }
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
    idList.length ? inChunks((c) => supabase.from('task_assignees').select('id, task_id, worker_id, done_note, bill_hours, bill_callouts, bill_items').is('deleted_at', null).in('task_id', c)) : [],
    workerIds.length && fromTs && toTs
      ? fetchAll(() => supabase.from('work_sessions').select('id, task_id, worker_id, site_id, started_at, ended_at').is('deleted_at', null).not('ended_at', 'is', null).in('worker_id', workerIds).gte('started_at', fromTs).lte('started_at', toTs))
      : [],
    idList.length
      ? (async () => {
          const byTask = await inChunks((c) => supabase.from('attendance').select('id, task_id, worker_id, site_id, work_date, source, pay_basis, hours, day_multiplier, applied_rate, amount, commission_amount, callout_fee, paid_at, worked_hours').is('deleted_at', null).in('task_id', c));
          const byDays = workerIds.length && fromTs && toTs
            ? await fetchAll(() => supabase.from('attendance').select('id, task_id, worker_id, site_id, work_date, source, pay_basis, hours, day_multiplier, applied_rate, amount, commission_amount, callout_fee, paid_at, worked_hours').is('deleted_at', null).eq('source', 'session').in('worker_id', workerIds).gte('work_date', fromTs.slice(0, 10)).lte('work_date', toTs.slice(0, 10)))
            : [];
          const seen = new Set<string>();
          return [...byTask, ...byDays].filter((a: any) => (seen.has(a.id) ? false : (seen.add(a.id), true)));
        })()
      : [],
    idList.length ? inChunks((c) => supabase.from('task_materials').select('id, task_id, worker_id, amount, note, reason, quantity, unit, created_at').is('deleted_at', null).in('task_id', c)) : [],
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
  type Share = { row: any; share: number; hours: number; amount: number; commission: number; callout: number; mineMs: number; totalMs: number };
  /** ms → „1 ó 5 p” */
  const hm = (ms: number) => { const m = Math.round(ms / 60000); return m >= 60 ? `${Math.floor(m / 60)} ó ${m % 60} p` : `${m} p`; };
  const quoted = new Set((quotedTasks ?? []).map((t: any) => t.id));
  const dayKey = (w: string, site: string | null, day: string) => `${w}|${site ?? ''}|${day}`;
  /** átfedő menetek egyesített hossza (ms) */
  const unionMs = (list: any[]): number => {
    const iv = list.map((x) => [new Date(x.started_at).getTime(), new Date(x.ended_at).getTime()] as [number, number])
      .filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
    let total = 0, curS = -1, curE = -1;
    for (const [a, b] of iv) {
      if (curE < 0 || a > curE) { if (curE >= 0) total += curE - curS; curS = a; curE = b; }
      else if (b > curE) curE = b;
    }
    return curE >= 0 ? total + (curE - curS) : total;
  };
  const sesByDay = new Map<string, any[]>();
  for (const x of sessions ?? []) { const k = dayKey(x.worker_id, x.site_id, budDay(x.started_at)); sesByDay.set(k, [...(sesByDay.get(k) ?? []), x]); }
  const taskShares = (taskId: string): Share[] => {
    const days = new Set((sessions ?? []).filter((x: any) => x.task_id === taskId).map((x: any) => dayKey(x.worker_id, x.site_id, budDay(x.started_at))));
    const out: Share[] = [];
    for (const a of attendance ?? []) {
      const k = dayKey(a.worker_id, a.site_id, a.work_date);
      let share = 0, first = a.task_id === taskId, mine = 0, totalMs = 0;
      if (a.source !== 'session') share = a.task_id === taskId ? 1 : 0;
      else if (a.task_id === taskId || days.has(k)) {
        const ds = (sesByDay.get(k) ?? []).filter((x: any) => !(x.task_id && quoted.has(x.task_id)));
        // feladatonként az átfedő meneteket egyesítjük (kétszer rögzített időszak ne számítson duplán)
        const byTask = new Map<string, any[]>();
        ds.forEach((x: any, i: number) => { const g = x.task_id ?? `none:${i}`; byTask.set(g, [...(byTask.get(g) ?? []), x]); });
        const total = [...byTask.values()].reduce((s: number, list) => s + unionMs(list), 0);
        mine = unionMs(byTask.get(taskId) ?? []);
        totalMs = total;
        share = total > 0 ? mine / total : (a.task_id === taskId ? 1 : 0);
        // a kiszállási díj a napra egyszer jár: az aznap ott elsőként kezdett feladat viseli
        const earliest = ds.slice().sort((x: any, y: any) => String(x.started_at).localeCompare(String(y.started_at)))[0];
        first = earliest ? earliest.task_id === taskId : a.task_id === taskId;
      }
      if (share <= 0) continue;
      const calloutFee = Number(a.callout_fee ?? 0);
      const callout = share >= 1 || first ? calloutFee : 0;
      // órabéresnél az elszámolt (megkezdett) órák; napi / projektdíjasnál a nap tényleges munkaideje (tájékoztatás)
      const dayHours = Number((a.pay_basis === 'hourly' ? a.hours : a.worked_hours) ?? 0);
      if (share < 1 && a.pay_basis === 'hourly' && dayHours > 0) {
        // órabéres, több feladat aznap ugyanott: a feladat bére = a rajta töltött MEGKEZDETT órák × óradíj
        const taskHours = Math.max(1, Math.ceil(Math.round(mine / 3600000 * 10000) / 10000));
        const rate = a.applied_rate != null ? Number(a.applied_rate) : (Number(a.amount) - calloutFee) / dayHours;
        out.push({ row: a, share, hours: taskHours, amount: Math.round(taskHours * rate) + callout,
          commission: Math.round(Number(a.commission_amount ?? 0) * taskHours / dayHours), callout, mineMs: mine, totalMs });
        continue;
      }
      const r = (n: number) => Math.round(n * share);
      out.push({ row: a, share, hours: Math.round(dayHours * share * 100) / 100,
        amount: r(Number(a.amount) - calloutFee) + callout, commission: r(Number(a.commission_amount ?? 0)), callout, mineMs: mine, totalMs });
    }
    return out.sort((x, y) => x.row.work_date.localeCompare(y.row.work_date));
  };
  const sharesOf = new Map<string, Share[]>(list.map((t) => [t.id, taskShares(t.id)]));

  // egy sor = egy feladat egy munkavállalóval (a vállalkozó emberei külön sorban); a feladat-szintű
  // értékek (elfogadott ajánlat bére, továbbszámlázott anyag, kiszámlázott, haszon) az első soron állnak
  type Row = {
    taskId: string; first: boolean; site: string; code: string; item: string; title: string; status: string; worker: string; hours: number;
    wage: number; callout: number; matCost: number; cost: number; matResale: number; invoice: number | null; profit: number | null;
    created: string; done: string; siteId: string; doneNote: string; periodDay: string;
    wid: string; calloutCount: number; mats: any[];
    /** megkezdett órák (munkavállalónként és naponként felfelé kerekítve) — az ügyfél felé ezt számlázzuk */
    startedHours: number;
    /** a készre jelentéskor jóváhagyott (vagy a vezető által beállított) elszámolási adatok — ha megvannak,
     *  az ügyfél felé ezek mennek a mért értékek helyett */
    billHours: number | null; billCallouts: number | null; billItems: { label: string; hours: number }[];
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
      // az időszak-szűrés napja (kész / nem sikerült: lezárás, egyébként kiadás) — ez dönti el, melyik hét lapjára kerül
      periodDay: budDay((byDone && (t.closed_at ?? t.done_at)) || t.created_at),
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
      // megkezdett órák: minden megkezdett óra teljes óra, naponként kerekítve (Daniel szabálya az ügyfél felé is);
      // ahol nincs könyvelt nap (pl. elfogadott ajánlat), a feladaton töltött idő naponként kerekítve
      const up = (h: number) => (h > 0 ? Math.ceil(Math.round(h * 1e4) / 1e4) : 0);
      let startedHours = myAtt.reduce((a, x) => a + up(x.hours), 0);
      if (startedHours <= 0) {
        const perDay = new Map<string, number>();
        for (const x of ses.filter((q: any) => q.worker_id === wid)) {
          const d = budDay(x.started_at);
          perDay.set(d, (perDay.get(d) ?? 0) + (new Date(x.ended_at).getTime() - new Date(x.started_at).getTime()) / 3600000);
        }
        startedHours = [...perDay.values()].reduce((a, h) => a + up(h), 0);
      }
      // anyag: a munkavállaló saját tételei; a vezető által (munkavállaló nélkül) rögzített tétel az első soron
      const myMats = mats.filter((m: any) => m.worker_id === wid || (first && !m.worker_id));
      const matCost = myMats.reduce((a, m) => a + Number(m.amount), 0);
      const cost = wage + callout + matCost;
      taskCost += cost;
      // a munkavállaló megjegyzése a készre jelentéskor („miért tartott ennyi ideig”)
      const myAss = wid ? (assBy.get(t.id) ?? []).find((a: any) => a.worker_id === wid) : null;
      const doneNote = String(myAss?.done_note ?? '');
      const billItems = (Array.isArray(myAss?.bill_items) ? myAss.bill_items : [])
        .map((x: any) => ({ label: String(x?.label ?? '').slice(0, 200), hours: Number(x?.hours) }))
        .filter((x: any) => x.label && Number.isFinite(x.hours) && x.hours > 0);
      return { ...base, first, worker: wid ? nameOf(wid) : '', hours, wage, callout, matCost, cost, doneNote,
        wid: wid ?? '', calloutCount: myAtt.filter((x) => x.callout > 0).length, mats: myMats, startedHours,
        billHours: myAss?.bill_hours != null ? Number(myAss.bill_hours) : null,
        billCallouts: myAss?.bill_callouts != null ? Number(myAss.bill_callouts) : null, billItems,
        matResale: first ? matResale : 0, invoice: first ? invoice : null, profit: null };
    });
    if (invoice != null) out[0].profit = invoice + matResale - taskCost;
    return out;
  }).sort((a, b) => a.site.localeCompare(b.site, 'hu') || a.code.localeCompare(b.code, 'hu') || a.taskId.localeCompare(b.taskId) || (a.first ? -1 : b.first ? 1 : 0));

  if (f.layout === 'settlement') return await settlementWorkbook(supabase, rows, f, resaleOf, json);

  const taskSheet = rows.map((r) => ({
    'Feladat kód': r.code, 'Helyszín': r.site, 'Cikktörzs': r.item, 'Feladat': r.title, 'Állapot': r.status, 'Munkavállaló': r.worker,
    'Munkaóra': r.hours, 'Munkabér (Ft)': r.wage, 'Kiszállás (Ft)': r.callout, 'Anyagköltség (Ft)': r.matCost, 'Összes költség (Ft)': r.cost,
    'Anyag továbbszámlázva (Ft)': r.first ? r.matResale : '', 'Kiszámlázott (Ft)': r.invoice ?? '', 'Haszon (Ft)': r.profit ?? '',
    'Kiadva': r.created, 'Elkészült': r.done, 'Miért tartott ennyi ideig': r.doneNote,
    'Ügyfélnek: munkaóra': r.billHours ?? r.startedHours, 'Ügyfélnek: kiszállás (alkalom)': r.billCallouts ?? r.calloutCount,
    'Munkavállaló megadta': r.billHours != null ? 'igen' : 'nem',
    'Tételes bontás': r.billItems.map((x) => `${x.label}: ${String(x.hours).replace('.', ',')} óra`).join('; '),
  }));
  const sum = (f: (r: Row) => number, rs: Row[] = rows) => rs.reduce((s, r) => s + f(r), 0);
  const taskCount = new Set(rows.map((r) => r.taskId)).size;
  taskSheet.push({
    'Feladat kód': 'ÖSSZESEN', 'Helyszín': '', 'Cikktörzs': '', 'Feladat': `${taskCount} feladat`, 'Állapot': '', 'Munkavállaló': '',
    'Munkaóra': r2(sum((r) => r.hours)), 'Munkabér (Ft)': sum((r) => r.wage), 'Kiszállás (Ft)': sum((r) => r.callout),
    'Anyagköltség (Ft)': sum((r) => r.matCost), 'Összes költség (Ft)': sum((r) => r.cost), 'Anyag továbbszámlázva (Ft)': sum((r) => r.matResale),
    'Kiszámlázott (Ft)': sum((r) => r.invoice ?? 0), 'Haszon (Ft)': sum((r) => r.profit ?? 0), 'Kiadva': '', 'Elkészült': '', 'Miért tartott ennyi ideig': '',
    'Ügyfélnek: munkaóra': sum((r) => r.billHours ?? r.startedHours), 'Ügyfélnek: kiszállás (alkalom)': sum((r) => r.billCallouts ?? r.calloutCount),
    'Munkavállaló megadta': '', 'Tételes bontás': '',
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
      'Elszámolás': (a.pay_basis === 'hourly' ? `órabér (${a.hours} ó)` : a.pay_basis === 'daily' ? (Number(a.day_multiplier) === 0 ? 'napi díj máshol elszámolva' : 'napi díjas') : a.pay_basis === 'project' ? 'projektdíj' : 'jelenlét')
        + (x.share < 1 ? (a.pay_basis === 'hourly' ? ` · ezen a feladaton ${x.hours} megkezdett óra` : ` · ezen a feladaton ${hm(x.mineMs)} a nap ${hm(x.totalMs)} munkaidejéből`) : '') + (x.share < 1 && x.callout > 0 ? ' · kiszállás a nap első feladatán' : ''),
      'Órák': x.hours, 'Munkabér (Ft)': x.amount - x.callout, 'Kiszállás (Ft)': x.callout,
      'Ebből közvetítőé (Ft)': x.commission, 'Kifizetve': a.paid_at ? 'igen' : 'nem',
    }; });

  const matSheet = (materials ?? []).filter((m: any) => ids.has(m.task_id))
    .sort((a: any, b: any) => a.created_at.localeCompare(b.created_at))
    .map((m: any) => ({
      'Helyszín': siteNameOf.get(m.task_id) ?? '', 'Feladat kód': codeOf.get(m.task_id) ?? '', 'Dátum': hd(m.created_at), 'Rögzítette': nameOf(m.worker_id),
      'Mennyiség': m.quantity != null ? Number(m.quantity) : 1, 'Egység': m.unit || 'db',
      'Összeg (Ft)': Number(m.amount), 'Továbbszámlázva (Ft)': resaleOf.get(m.id) ?? '', 'Megjegyzés': m.note ?? '', 'Miért ennyibe került': m.reason ?? '',
    }));

  const wb = XLSX.utils.book_new();
  const s1 = XLSX.utils.json_to_sheet(taskSheet);
  s1['!cols'] = [{ wch: 12 }, { wch: 26 }, { wch: 28 }, { wch: 32 }, { wch: 12 }, { wch: 24 }, { wch: 9 }, { wch: 13 }, { wch: 13 }, { wch: 15 }, { wch: 16 }, { wch: 20 }, { wch: 15 }, { wch: 13 }, { wch: 12 }, { wch: 12 }, { wch: 40 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 60 }];
  const s2 = XLSX.utils.json_to_sheet(siteSheet);
  s2['!cols'] = [{ wch: 26 }, { wch: 40 }, { wch: 12 }, { wch: 9 }, { wch: 13 }, { wch: 13 }, { wch: 15 }, { wch: 16 }, { wch: 20 }, { wch: 15 }];
  const s3 = XLSX.utils.json_to_sheet(daySheet);
  s3['!cols'] = [{ wch: 26 }, { wch: 14 }, { wch: 24 }, { wch: 12 }, { wch: 24 }, { wch: 7 }, { wch: 13 }, { wch: 13 }, { wch: 16 }, { wch: 9 }];
  const s4 = XLSX.utils.json_to_sheet(matSheet);
  s4['!cols'] = [{ wch: 26 }, { wch: 14 }, { wch: 12 }, { wch: 24 }, { wch: 10 }, { wch: 8 }, { wch: 12 }, { wch: 18 }, { wch: 36 }, { wch: 40 }];
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

/** Egy elszámolás-lap: feladatonként egy tömb — Munka sorszáma, megnevezés, majd Megnevezés / Mennyiség / Egység /
 *  Árak/Díjak / Összesen sorok: Munkaóra (megkezdett óra × kimenő órabér), Kiszállás (alkalom × kimenő kiszállási díj),
 *  anyagok (a rögzített tétel, a továbbszámlázott ár — ha nincs beárazva, a bekerülési összeg), végül Összesen; a lap
 *  alján Mindösszesen. A munkaóra és a kiszállás a készre jelentéskor jóváhagyott szám (task_assignees.bill_*), ennek
 *  hiányában a mért érték. Az összegek képletek, így a mennyiség vagy az ár átírása után az Excel újraszámol.
 *  Visszaadja a lapot, a végösszeget és a végösszeg celláját (az összesítő lap erre hivatkozik). */
function settlementSheet(groups: any[][], hourly: number, callout: number, resaleOf: Map<string, number>) {
  const aoa: any[][] = [];
  const merges: any[] = [];
  const totals: string[] = [];
  let grand = 0;
  const num = (v: number) => ({ t: 'n', v, z: '#,##0' });
  const formula = (fx: string, v: number) => ({ t: 'n', f: fx, v, z: '#,##0' });
  for (const rs of groups) {
    const t = rs[0];
    // az ügyfél felé a megkezdett órák mennek (minden megkezdett óra teljes óra)
    // ha a munkavállaló a készre jelentéskor jóváhagyta (vagy a vezető beállította) a számokat, azok mennek
    const hours = rs.reduce((a, r) => a + (r.billHours ?? r.startedHours ?? Math.ceil(r.hours)), 0);
    const calloutN = rs.reduce((a, r) => a + (r.billCallouts ?? r.calloutCount), 0);
    // tételes bontás (több külön munka egy sorszám alatt): azonos tételek óráit összeadjuk
    const itemHours = new Map<string, number>();
    for (const r of rs) for (const it of (r.billItems ?? [])) itemHours.set(it.label, (itemHours.get(it.label) ?? 0) + it.hours);
    const seen = new Set<string>();
    const mats = rs.flatMap((r) => r.mats).filter((m: any) => (seen.has(m.id) ? false : (seen.add(m.id), true)))
      .sort((a: any, b: any) => String(a.created_at).localeCompare(String(b.created_at)));
    const top = aoa.length;
    aoa.push([`Munka sorszáma: ${t.code || '—'}`]); merges.push({ s: { r: top, c: 0 }, e: { r: top, c: 5 } });
    aoa.push([`ODO megnevezés: ${t.title}${t.item ? ` (${t.item})` : ''}`]); merges.push({ s: { r: top + 1, c: 0 }, e: { r: top + 1, c: 5 } });
    aoa.push(['Megnevezés', 'Mennyiség', 'Egység', 'Árak/Díjak', 'Összesen']);
    const first = aoa.length + 1; // 1-alapú Excel-sor
    let blockSum = 0;
    const line = (name: string, qty: number, unit: string, price: number) => {
      const n = aoa.length + 1;
      // a mennyiség tört is lehet (pl. 0,5 óra): egész számnál tizedes nélkül, egyébként két tizedessel —
      // különben a 0,5 „1”-nek látszik, miközben a képlet 0,5-tel számol
      const qtyCell = { t: 'n', v: qty, z: Number.isInteger(qty) ? '#,##0' : '#,##0.00' };
      aoa.push([name, qtyCell, unit, num(price), formula(`B${n}*D${n}`, Math.round(qty * price))]);
      blockSum += Math.round(qty * price);
    };
    line('Munkaóra', hours, 'óra', hourly);
    // tájékoztató sorok a Munkaóra alatt: melyik munka mennyi ideig tartott (ár és összeg nélkül — nem adódik hozzá)
    for (const [label, h] of itemHours) {
      aoa.push([`   – ${label}`, { t: 'n', v: h, z: Number.isInteger(h) ? '#,##0' : '#,##0.00' }, 'óra']);
    }
    line('Kiszállás', calloutN, 'alkalom', callout);
    // anyag: mennyiség × egységár (egységár = továbbszámlázott / bekerülési összeg osztva a mennyiséggel)
    for (const m of mats) {
      const qty = m.quantity != null && Number(m.quantity) > 0 ? Number(m.quantity) : 1;
      line(m.note || 'Anyag', qty, m.unit || 'db', Math.round((resaleOf.get(m.id) ?? Number(m.amount)) / qty));
    }
    aoa.push([]);
    const last = aoa.length; // az üres sor is a SUM tartományában (mint a mintában)
    const totalRow = aoa.length + 1;
    const sum = blockSum;
    aoa.push(['Összesen:', null, null, null, formula(`SUM(E${first}:E${last})`, sum)]);
    totals.push(`E${totalRow}`); grand += sum;
    aoa.push([]); aoa.push([]);
  }
  let totalCell: string | null = totals.length === 1 ? totals[0] : null;
  if (groups.length === 0) aoa.push(['Nincs a szűrésnek megfelelő feladat.']);
  if (totals.length > 1) {
    const n = aoa.length + 1;
    aoa.push(['Mindösszesen:', null, null, null, formula(totals.join('+'), grand)]);
    merges.push({ s: { r: n - 1, c: 0 }, e: { r: n - 1, c: 3 } });
    totalCell = `E${n}`;
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!merges'] = merges;
  ws['!cols'] = [{ wch: 44 }, { wch: 11 }, { wch: 10 }, { wch: 13 }, { wch: 14 }];
  return { ws, grand, totalCell, count: groups.length };
}

/** Elszámolás az ügyfél felé („Heti elszámolás” minta). Időszak szerinti szűrésnél MINDEN HÉT KÜLÖN FÁJLBA kerül
 *  („elszamolas_2026_47_het_….xlsx” — a feladat a készre jelentés / kiadás napjának ISO-hete szerint); több hétnél a
 *  fájlok egy ZIP-ben jönnek, benne egy „osszesito.xlsx” is (hetenként az időszak, a munkák száma, a végösszeg). Egy hétnél
 *  a heti Excel jön közvetlenül. Egy feladatra vagy megadott sorszám-listára egyetlen „Elszámolás” lap készül, mint eddig. */
async function settlementWorkbook(supabase: any, rowsAll: any[], f: TaskFilter, resaleOf: Map<string, number>, json: (b: unknown, s?: number) => Response) {
  const rows = f.workerId ? rowsAll.filter((r) => r.wid === f.workerId) : rowsAll;
  const codes = parseCodes(f.code);
  const has = (r: any, k: string) => String(r.code ?? '').toLowerCase().includes(k.toLowerCase());
  const codeIdx = (r: any) => { const i = codes.findIndex((k) => has(r, k)); return i < 0 ? codes.length : i; };
  // megadott sorszám-listánál a tömbök a lista sorrendjében követik egymást (könnyebb összevetni)
  const ordered = codes.length > 1 ? rows.map((r, i) => ({ r, i })).sort((a, b) => codeIdx(a.r) - codeIdx(b.r) || a.i - b.i).map((x) => x.r) : rows;
  // amelyik megadott sorszámhoz nincs találat (elírás, más állapot / terület / ember)
  const missing = codes.filter((k) => !rows.some((r) => has(r, k)));
  const byTask = new Map<string, any[]>();
  for (const r of ordered) byTask.set(r.taskId, [...(byTask.get(r.taskId) ?? []), r]);
  const hourly = Number(f.billHourly ?? 0), callout = Number(f.billCallout ?? 0);
  const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const book = (ws: any, sheetName: string) => {
    const wb = XLSX.utils.book_new();
    (wb as any).Workbook = { CalcPr: { fullCalcOnLoad: true } };
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    return XLSX.write(wb, { type: 'base64', bookType: 'xlsx' }) as string;
  };
  const hd2 = (d: string) => d.replace(/-/g, '.') + '.';
  const weekly = !f.taskId && codes.length === 0;
  if (!weekly) {
    const one = (f.taskId || codes.length === 1) && rows[0] ? `elszamolas_${(rows[0].code || 'feladat').replace(/[^\w-]+/g, '_')}` : `elszamolas_${byTask.size}_sorszam`;
    return json({ missing, filename: `${one}.xlsx`, mime: XLSX_MIME, base64: book(settlementSheet([...byTask.values()], hourly, callout, resaleOf).ws, 'Elszámolás') });
  }
  // hetenként külön fájl, időrendben
  const weeks = new Map<string, { year: number; week: number; groups: any[][] }>();
  for (const rs of byTask.values()) {
    const w = isoWeek(rs[0].periodDay);
    const key = `${w.year}-${String(w.week).padStart(2, '0')}`;
    const e = weeks.get(key) ?? { ...w, groups: [] };
    e.groups.push(rs); weeks.set(key, e);
  }
  const list = [...weeks.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([, v]) => v);
  const files = list.map((w) => {
    const range = isoWeekRange(w.year, w.week);
    const sheet = settlementSheet(w.groups, hourly, callout, resaleOf);
    const stem = `${w.year}_${String(w.week).padStart(2, '0')}_het_${range.from}_${range.to}`;
    return { ...w, range, name: `${w.week}. hét`, folder: stem, filename: `elszamolas_${stem}.xlsx`, base64: book(sheet.ws, `${w.week}. hét`), grand: sheet.grand, count: sheet.count, taskIds: w.groups.map((rs) => rs[0].taskId as string) };
  });
  if (files.length === 0) return json({ missing, filename: `elszamolas_${f.from}_${f.to}.xlsx`, mime: XLSX_MIME, base64: book(settlementSheet([], hourly, callout, resaleOf).ws, 'Elszámolás') });
  // összesítő (több hétnél): hét, időszak, munkák száma, végösszeg, mappa
  const groups = files.map((w) => ({ key: w.folder, taskIds: w.taskIds, codes: w.groups.map((rs) => String(rs[0].code ?? '')) }));
  let summary: string | null = null;
  if (files.length > 1) {
    const aoa: any[][] = [[`Elszámolás ${hd2(f.from)} – ${hd2(f.to)}`], [], ['Hét', 'Időszak', 'Munkák (db)', 'Összesen', 'Mappa']];
    for (const w of files) aoa.push([w.name, `${hd2(w.range.from)} – ${hd2(w.range.to)}`, w.count, { t: 'n', v: w.grand, z: '#,##0' }, w.folder]);
    const n = aoa.length + 1;
    aoa.push(['Mindösszesen:', null, { t: 'n', f: `SUM(C4:C${n - 1})`, v: files.reduce((a, w) => a + w.count, 0), z: '#,##0' }, { t: 'n', f: `SUM(D4:D${n - 1})`, v: files.reduce((a, w) => a + w.grand, 0), z: '#,##0' }]);
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 4 } }];
    ws['!cols'] = [{ wch: 12 }, { wch: 28 }, { wch: 12 }, { wch: 16 }, { wch: 40 }];
    summary = book(ws, 'Összesítő');
  }
  const zipName = `elszamolas_${f.from}_${f.to}_hetenkent.zip`;
  if (f.asFiles) {
    // az app állítja össze a ZIP-et: hetenként mappa — a hét Excelje + a külön lekért munkalap-PDF-ek
    const out = files.map((w) => ({ path: `${w.folder}/${w.filename}`, base64: w.base64 }));
    if (summary) out.push({ path: 'osszesito.xlsx', base64: summary });
    return json({ missing, weeks: files.length, filename: zipName, files: out, groups });
  }
  // régebbi app: ZIP munkalapok nélkül (az xlsx már tömörített, STORE)
  const zip = new JSZip();
  for (const w of files) zip.folder(w.folder)!.file(w.filename, w.base64, { base64: true });
  if (summary) zip.file('osszesito.xlsx', summary, { base64: true });
  return json({ missing, weeks: files.length, filename: zipName, mime: 'application/zip', base64: await zip.generateAsync({ type: 'base64', compression: 'STORE' }) });
}
