// Karbantartási munkalap (PDF) — az export-data funkció `mode: 'worksheet'` ága. Daniel papír-mintája
// (2026-11-26, „KARBANTARTÁSI MUNKALAP — Munkavégzési és anyagfelhasználási nyilvántartás”) alapján, feladatonként
// egy A4-es lap, a munkavállalók által az appban rögzített adatokból:
//  munka kódja (+ SOS), dátum, munkavégző, munkaterület / cím, munka kezdése–befejezése (munkamenetek),
//  elvégzett munkálatok (feladat címe, tételes bontás, készre jelentés leírása) és állapot,
//  felhasznált anyagok (megnevezés, mennyiség, egység, ár), egyéb megjegyzések (a munkavállalók megjegyzései,
//  nem sikerült ok). Egy feladatra PDF, több feladatra ZIP (feladatonként egy PDF).

import { PDFDocument, rgb, StandardFonts, PDFFont, PDFPage } from 'npm:pdf-lib@1.17.1';
import fontkit from 'npm:@pdf-lib/fontkit@1.1.1';
import JSZip from 'npm:jszip@3.10.1';
import * as XLSX from 'npm:xlsx@0.18.5';
import { fetchAll, TaskStatusFilter, parseCodes } from './tasks.ts';

/** a munkalap fejlécében a cég neve (a papír-mintán is ez áll) */
const COMPANY = 'TITAN CORE HOME KFT.';
const FONTS = {
  regular: { url: 'https://cdn.jsdelivr.net/gh/googlefonts/roboto@main/src/hinted/Roboto-Regular.ttf', sha: '56a45233d29f11b4dfb86d248e921939d115778f87325e7ae8cc108383d6664d' },
  bold: { url: 'https://cdn.jsdelivr.net/gh/googlefonts/roboto@main/src/hinted/Roboto-Bold.ttf', sha: '61f89f8db49261c2f6106e8dccc35df7b2f7ed909020db40a3fc905e95f99334' },
};
const budDay = (iso: string) => new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'Europe/Budapest' });
const hd = (d: string | null | undefined) => (d ? d.slice(0, 10).replace(/-/g, '.') + '.' : '');
const hm = (iso: string) => new Date(iso).toLocaleTimeString('hu-HU', { timeZone: 'Europe/Budapest', hour: '2-digit', minute: '2-digit' });
const ft = (n: number) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' Ft';

/** betűtípus letöltése rögzített SHA-256-tal (ékezetek miatt); hiba esetén beépített Helvetica */
async function fontBytes(which: 'regular' | 'bold'): Promise<Uint8Array | null> {
  try {
    const res = await fetch(FONTS[which].url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error('font http ' + res.status);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((x) => x.toString(16).padStart(2, '0')).join('');
    if (digest !== FONTS[which].sha) throw new Error('font integrity mismatch');
    return bytes;
  } catch (e) { console.warn('worksheet font', which, e); return null; }
}

export interface WorksheetFilter {
  taskId: string | null; siteId: string | null; from: string; to: string; status: TaskStatusFilter; workerId: string | null; code: string | null;
  /** megadott feladatok (legfeljebb 20) — feladatonként egy PDF, fájllistaként; az app ezt hívja darabonként */
  items?: { task_id: string; hours?: number | null; callouts?: number | null; mats?: SheetOverride['mats'] }[] | null;
  /** igaz: csak a terv (hetenként a feladatok azonosítói), PDF nélkül */
  planOnly?: boolean;
}

/** Munkalapok a megadott feladatokhoz: feladatonként külön PDF (Daniel kérése), legfeljebb 20 egy kérésben —
 *  a betűkészlet-szűkítés PDF-enként fut, ezért a nagy listát az app több kérésre bontja (a szerver CPU-kerete). */
async function worksheetFiles(supabase: any, items: NonNullable<WorksheetFilter['items']>, json: (b: unknown, s?: number) => Response) {
  const list = items.slice(0, 20).filter((it) => typeof it?.task_id === 'string');
  const overrides = new Map<string, SheetOverride>();
  for (const it of list) if (it.hours != null || it.callouts != null || it.mats) overrides.set(it.task_id, { hours: it.hours ?? null, callouts: it.callouts ?? null, mats: it.mats ?? null });
  const docs = await buildWorksheets(supabase, list.map((it) => ({ key: it.task_id, taskIds: [it.task_id] })), null, overrides);
  return json({ files: docs.map((d) => ({ task_id: d.key, name: `munkalap_${(d.codes[0] || 'feladat').replace(/[^\w-]+/g, '_')}.pdf`, base64: toB64(d.bytes) })) });
}

const weekKey = (iso: string) => { const d = new Date(budDay(iso) + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 4 - ((d.getUTCDay() + 6) % 7 + 1)); const y = d.getUTCFullYear(); const w = Math.ceil(((d.getTime() - Date.UTC(y, 0, 1)) / 86400000 + 1) / 7); const jan4 = new Date(Date.UTC(y, 0, 4)); const mon = new Date(jan4.getTime() - ((jan4.getUTCDay() + 6) % 7) * 86400000 + (w - 1) * 7 * 86400000); const f = (x: Date) => x.toISOString().slice(0, 10); return `${y}_${String(w).padStart(2, '0')}_het_${f(mon)}_${f(new Date(mon.getTime() + 6 * 86400000))}`; };

export async function exportWorksheets(supabase: any, f: WorksheetFilter, json: (b: unknown, s?: number) => Response) {
  if (f.items && f.items.length) return await worksheetFiles(supabase, f.items, json);
  const codes = parseCodes(f.code).map((k) => k.toLowerCase());
  const q = () => {
    let tq = supabase.from('worker_tasks').select('id, code, title, details, status, priority, site_id, created_at, done_at, closed_at, fail_reason').is('deleted_at', null);
    if (f.taskId) tq = tq.eq('id', f.taskId);
    if (f.siteId) tq = tq.eq('site_id', f.siteId);
    if (codes.length === 1) tq = tq.ilike('code', `%${codes[0]}%`);
    if (f.status === 'done') tq = tq.eq('status', 'done');
    else if (f.status === 'failed') tq = tq.eq('status', 'failed');
    else if (f.status === 'open') tq = tq.or('status.in.(assigned,acknowledged),and(status.eq.failed,closed_at.is.null)');
    return tq;
  };
  const byDone = f.status === 'done' || f.status === 'failed';
  const tasks = (await fetchAll(q)).filter((t: any) => {
    if (f.taskId) return true;
    if (codes.length) { const c = String(t.code ?? '').toLowerCase(); return codes.some((k) => c.includes(k)); }
    const d = budDay((byDone && (t.closed_at ?? t.done_at)) || t.created_at);
    return d >= f.from && d <= f.to;
  }).sort((a: any, b: any) => String(a.code ?? '').localeCompare(String(b.code ?? ''), 'hu') || String(a.created_at).localeCompare(String(b.created_at)));
  if (f.planOnly) {
    // terv az appnak: hetenként (a készre jelentés / kiadás napja szerint) a feladatok; egy munkavállalónál csak az övéi
    let list = tasks as any[];
    if (f.workerId) {
      const ids = list.map((t) => t.id); const mine = new Set<string>();
      for (let i = 0; i < ids.length; i += 200) {
        const c = ids.slice(i, i + 200);
        for (const a of await fetchAll(() => supabase.from('task_assignees').select('id, task_id').eq('worker_id', f.workerId).is('deleted_at', null).in('task_id', c))) mine.add(a.task_id);
        for (const x of await fetchAll(() => supabase.from('work_sessions').select('id, task_id').eq('worker_id', f.workerId).is('deleted_at', null).in('task_id', c))) mine.add(x.task_id);
      }
      list = list.filter((t) => mine.has(t.id));
    }
    const groups = new Map<string, { key: string; taskIds: string[]; codes: string[] }>();
    for (const t of list) {
      const key = weekKey((byDone && (t.closed_at ?? t.done_at)) || t.created_at);
      const g = groups.get(key) ?? { key, taskIds: [], codes: [] };
      g.taskIds.push(t.id); g.codes.push(String(t.code ?? '')); groups.set(key, g);
    }
    return json({ groups: [...groups.values()].sort((a, b) => a.key.localeCompare(b.key)), filename: `munkalapok_${f.from}_${f.to}.zip` });
  }
  // egy feladat (a feladat oldaláról): közvetlenül a PDF
  const docs = await buildWorksheets(supabase, tasks.slice(0, 20).map((t: any) => ({ key: t.id, taskIds: [t.id] })), f.workerId);
  if (docs.length === 0) return json({ error: 'Nincs a szűrésnek megfelelő feladat.' }, 404);
  if (docs.length === 1) return json({ count: 1, filename: `munkalap_${(docs[0].codes[0] || 'feladat').replace(/[^\w-]+/g, '_')}.pdf`, mime: 'application/pdf', base64: toB64(docs[0].bytes) });
  const zip = new JSZip();
  for (const d of docs) zip.file(`munkalap_${(d.codes[0] || d.key.slice(0, 8)).replace(/[^\w-]+/g, '_')}.pdf`, d.bytes);
  return json({ count: docs.length, filename: `munkalapok_${f.from}_${f.to}.zip`, mime: 'application/zip', base64: await zip.generateAsync({ type: 'base64', compression: 'STORE' }) });
}

const toB64 = (b: Uint8Array) => { let s = ''; for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode(...b.subarray(i, i + 8192)); return btoa(s); };

/** Feladat-azonosítókhoz a munkalap-PDF-ek (feladatonként egy). workerId: csak azok a feladatok, ahol ő ki van
 *  osztva vagy dolgozott rajta. Az elszámolás-export is ezt hívja (hetenként mappába a munkalapokkal). */
/** a javított elszámolás-Excelből jövő adatok, amelyek az app adatait felülírják a munkalapon */
export interface SheetOverride { hours: number | null; callouts: number | null; mats: { name: string; qty: string; unit: string; price: string }[] | null }

export interface WorksheetGroup { key: string; taskIds: string[] }
export interface WorksheetDoc { key: string; count: number; codes: string[]; bytes: Uint8Array }

/** Csoportonként (pl. hetenként) EGY PDF, feladatonként egy oldal. Egy dokumentumba a betűtípus egyszer ágyazódik be,
 *  ezért sokkal kevesebb CPU, mint feladatonként külön PDF (az éles szerveren a feladatonkénti PDF „CPU Time exceeded”
 *  hibával elhalt). workerId: csak azok a feladatok, ahol ő ki van osztva vagy dolgozott rajta. */
export async function buildWorksheets(supabase: any, groups: WorksheetGroup[], workerId: string | null = null, overrides: Map<string, SheetOverride> = new Map()): Promise<WorksheetDoc[]> {
  const ids = [...new Set(groups.flatMap((g) => g.taskIds))];
  if (!ids.length) return [];
  const inChunks = async (build: (c: string[]) => any) => {
    const out: any[] = [];
    for (let i = 0; i < ids.length; i += 200) out.push(...await fetchAll(() => build(ids.slice(i, i + 200))));
    return out;
  };
  const [tasksRaw, sites, workers, assignees, sessions, materials, pricing, notes, profiles] = await Promise.all([
    inChunks((c) => supabase.from('worker_tasks').select('id, code, title, details, status, priority, site_id, created_at, done_at, closed_at, fail_reason').is('deleted_at', null).in('id', c)),
    fetchAll(() => supabase.from('sites').select('id, name, address')),
    fetchAll(() => supabase.from('workers').select('id, name')),
    inChunks((c) => supabase.from('task_assignees').select('id, task_id, worker_id, done_at, done_note, bill_items').is('deleted_at', null).in('task_id', c)),
    inChunks((c) => supabase.from('work_sessions').select('id, task_id, worker_id, started_at, ended_at').is('deleted_at', null).not('ended_at', 'is', null).in('task_id', c)),
    inChunks((c) => supabase.from('task_materials').select('id, task_id, worker_id, amount, note, quantity, unit, created_at').is('deleted_at', null).in('task_id', c)),
    fetchAll(() => supabase.from('task_material_pricing').select('id, material_id, resale_net').is('deleted_at', null)),
    inChunks((c) => supabase.from('task_notes').select('id, task_id, body, created_by, created_at, visible_to_workers').is('deleted_at', null).in('task_id', c)),
    fetchAll(() => supabase.from('profiles').select('id, worker_id')),
  ]);
  const order = new Map(ids.map((id, i) => [id, i]));
  const tasks = (tasksRaw as any[]).sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  const siteOf = new Map<string, any>((sites ?? []).map((s: any) => [s.id, s]));
  const nameOf = new Map<string, string>((workers ?? []).map((w: any) => [w.id, w.name]));
  const resaleOf = new Map<string, number>((pricing ?? []).map((p: any) => [p.material_id, Number(p.resale_net)]));
  const workerUser = new Set((profiles ?? []).filter((p: any) => p.worker_id).map((p: any) => p.id));
  const by = (rows: any[]) => { const m = new Map<string, any[]>(); for (const r of rows ?? []) m.set(r.task_id, [...(m.get(r.task_id) ?? []), r]); return m; };
  const assBy = by(assignees), sesBy = by(sessions), matBy = by(materials), noteBy = by(notes);
  const list = workerId
    ? tasks.filter((t: any) => (assBy.get(t.id) ?? []).some((a: any) => a.worker_id === workerId) || (sesBy.get(t.id) ?? []).some((s: any) => s.worker_id === workerId))
    : tasks;

  const [regBytes, boldBytes] = await Promise.all([fontBytes('regular'), fontBytes('bold')]);
  const taskOf = new Map(list.map((t: any) => [t.id, t]));
  const docs: WorksheetDoc[] = [];
  for (const g of groups) {
    const pdf = await PDFDocument.create();
    pdf.registerFontkit(fontkit);
    // a betűkészlet-szűkítés dokumentumonként egyszer fut (a teljes font beágyazása ~0,5 MB-tal növelné minden PDF-et)
    const font = regBytes ? await pdf.embedFont(regBytes, { subset: true }) : await pdf.embedFont(StandardFonts.Helvetica);
    const bold = boldBytes ? await pdf.embedFont(boldBytes, { subset: true }) : await pdf.embedFont(StandardFonts.HelveticaBold);
    const codes: string[] = [];
    for (const id of g.taskIds) {
    const t = taskOf.get(id);
    if (!t) continue;
    const site = siteOf.get(t.site_id);
    const ses = (sesBy.get(t.id) ?? []).sort((a: any, b: any) => String(a.started_at).localeCompare(String(b.started_at)));
    const ass = assBy.get(t.id) ?? [];
    const whoIds = [...new Set<string>([...ass.map((a: any) => a.worker_id), ...ses.map((s: any) => s.worker_id)])];
    const days = [...new Set(ses.map((s: any) => budDay(s.started_at)))].sort();
    const items = ass.flatMap((a: any) => (Array.isArray(a.bill_items) ? a.bill_items : []).map((x: any) => String(x?.label ?? '').trim()).filter((x: string) => x));
    const doneNotes = ass.map((a: any) => String(a.done_note ?? '').trim()).filter((x: string) => x);
    const state = t.status === 'done' ? 'KÉSZ' : t.status === 'failed' ? 'NEM SIKERÜLT' : t.status === 'cancelled' ? 'VISSZAVONVA' : 'FOLYAMATBAN';
    const works: string[] = [String(t.title ?? '').replace(/\s+/g, ' ').trim(), ...items, ...doneNotes.filter((d: string) => !items.includes(d))].filter((x, i, arr) => x && arr.indexOf(x) === i);
    const mats = (matBy.get(t.id) ?? []).sort((a: any, b: any) => String(a.created_at).localeCompare(String(b.created_at)));
    const ov = overrides.get(t.id);
    // elszámolt munkaóra: az Excelből, különben a készre jelentéskor megadott, különben a mért idő naponként felfelé kerekítve
    const declared = ass.map((a: any) => (a.bill_hours != null ? Number(a.bill_hours) : null)).filter((x: number | null): x is number => x != null);
    const perDayH = days.map((d) => ses.filter((s: any) => budDay(s.started_at) === d).reduce((a: number, s: any) => a + (new Date(s.ended_at).getTime() - new Date(s.started_at).getTime()) / 3600000, 0));
    const hours = ov?.hours ?? (declared.length ? declared.reduce((a: number, b: number) => a + b, 0) : perDayH.reduce((a, h) => a + (h > 0 ? Math.ceil(Math.round(h * 1e4) / 1e4) : 0), 0));
    const callouts = ov?.callouts ?? ass.map((a: any) => (a.bill_callouts != null ? Number(a.bill_callouts) : null)).filter((x: number | null): x is number => x != null).reduce((a: number, b: number) => a + b, 0);
    // munka vége: ha az Excel órája az irányadó és egy napos a munka, a kezdés + elszámolt óra (mint az Opteamus-munkalapokon)
    const start = ses.length ? ses[0].started_at : null;
    const endIso = ses.length ? (ov?.hours != null && days.length === 1 && hours > 0 ? new Date(new Date(start!).getTime() + hours * 3600000).toISOString() : ses[ses.length - 1].ended_at) : null;
    const remarks: string[] = [];
    if (t.status === 'failed' && t.fail_reason) remarks.push(`Nem sikerült: ${String(t.fail_reason).trim()}`);
    for (const n of (noteBy.get(t.id) ?? []).filter((n: any) => n.visible_to_workers !== false && workerUser.has(n.created_by)).sort((a: any, b: any) => String(a.created_at).localeCompare(String(b.created_at)))) {
      remarks.push(`${hd(budDay(n.created_at))} ${String(n.body ?? '').replace(/\s+/g, ' ').trim()}`);
    }
    drawSheet(pdf.addPage([595.28, 841.89]), font, bold, {
      code: `${t.code || '—'}${t.priority > 0 ? '   S.O.S' : ''}`,
      date: days.length ? days.map(hd).join(', ') : hd(t.done_at ? budDay(t.done_at) : budDay(t.created_at)),
      worker: whoIds.map((id) => nameOf.get(id) ?? '?').join(', '),
      site: site ? `${site.name}${site.address ? ` — ${site.address}` : ''}` : '',
      start: start ? hm(start) : '', end: endIso ? hm(endIso) : '',
      hours: hours > 0 ? `${String(Math.round(hours * 100) / 100).replace('.', ',')} óra` : '', callouts: callouts > 0 ? `${callouts} alkalom` : '',
      perDay: days.length > 1 ? days.map((d) => { const ds = ses.filter((s: any) => budDay(s.started_at) === d); return `${hd(d)} ${hm(ds[0].started_at)}–${hm(ds[ds.length - 1].ended_at)}`; }).join('; ') : '',
      works, state,
      mats: ov?.mats ?? mats.map((m: any) => {
        const qty = m.quantity != null && Number(m.quantity) > 0 ? Number(m.quantity) : 1;
        const price = resaleOf.get(m.id) ?? Number(m.amount);
        return { name: String(m.note || 'Anyag').replace(/\s+/g, ' ').trim(), qty: String(qty).replace('.', ','), unit: m.unit || 'db', price: ft(price) };
      }),
      remarks,
    });
    codes.push(String(t.code || t.id.slice(0, 8)));
    }
    if (codes.length === 0) continue;
    docs.push({ key: g.key, count: codes.length, codes, bytes: await pdf.save() });
  }
  return docs;
}

interface SheetData { code: string; date: string; worker: string; site: string; start: string; end: string; hours: string; callouts: string; perDay: string; works: string[]; state: string; mats: { name: string; qty: string; unit: string; price: string }[]; remarks: string[] }

/** A (javított) elszámolás-Excel tömbjeinek kiolvasása: lapónként a munka sorszáma, a Munkaóra és Kiszállás mennyisége,
 *  a Kiszállás alatti anyag-sorok (megnevezés, mennyiség, egység, ár). A lap neve („47. hét”) a hét. */
export function parseSettlementXlsx(base64: string): { sheet: string; code: string; hours: number | null; callouts: number | null; mats: { name: string; qty: string; unit: string; price: string }[] }[] {
  const wb = XLSX.read(base64, { type: 'base64' });
  const out: ReturnType<typeof parseSettlementXlsx> = [];
  for (const name of wb.SheetNames) {
    const rows: any[][] = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null });
    let cur: (typeof out)[number] | null = null; let inLines = false;
    for (const r of rows) {
      const a = String(r?.[0] ?? '').trim();
      const m = a.match(/^Munka sorszáma:\s*(.+)$/);
      if (m) { cur = { sheet: name, code: m[1].trim(), hours: null, callouts: null, mats: [] }; out.push(cur); inLines = false; continue; }
      if (!cur) continue;
      if (a === 'Megnevezés') { inLines = true; continue; }
      if (/^(Összesen|Mindösszesen)/.test(a)) { cur = null; inLines = false; continue; }
      if (!inLines || !a) continue;
      const num = (v: any) => (v == null || v === '' ? null : Number(String(v).replace(/\s/g, '').replace(',', '.')));
      if (a === 'Munkaóra') { cur.hours = num(r[1]); continue; }
      if (a === 'Kiszállás') { cur.callouts = num(r[1]); continue; }
      if (a.startsWith('–') || a.startsWith('-')) continue; // tételes bontás tájékoztató sora
      const qty = num(r[1]), price = num(r[3]);
      cur.mats.push({ name: a, qty: qty == null ? '' : String(qty).replace('.', ','), unit: String(r[2] ?? '').trim(), price: price == null ? '' : ft(price) });
    }
  }
  return out;
}

/** Munkalapok a visszatöltött (javított) elszámolás-Excelből: a munkaóra, a kiszállás és az anyagok az Excelből, a dátum,
 *  a munkavégző, a helyszín, a kezdés és a megjegyzések az appból. Több lapnál (hetenként) a ZIP-ben lapónként mappa. */
export async function exportWorksheetsFromXlsx(supabase: any, base64: string, filename: string, json: (b: unknown, s?: number) => Response, planOnly = false) {
  let blocks: ReturnType<typeof parseSettlementXlsx>;
  try { blocks = parseSettlementXlsx(base64); } catch (e) { console.warn('worksheet xlsx', e); return json({ error: 'Az Excel nem olvasható. Az elszámolás-exportból letöltött (és javított) fájlt töltsd fel.' }, 400); }
  if (!blocks.length) return json({ error: 'Az Excelben nincs „Munka sorszáma:” tömb — az elszámolás-exportból letöltött (és javított) fájlt töltsd fel.' }, 400);
  const codes = [...new Set(blocks.map((b) => b.code.toLowerCase()))];
  const tasksAll: any[] = [];
  for (let i = 0; i < codes.length; i += 100) tasksAll.push(...await fetchAll(() => supabase.from('worker_tasks').select('id, code, status, done_at, closed_at, created_at').is('deleted_at', null).in('code', codes.slice(i, i + 100).map((c) => blocks.find((b) => b.code.toLowerCase() === c)!.code))));
  const weekOf = (iso: string | null) => { if (!iso) return null; const d = new Date(budDay(iso) + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 4 - ((d.getUTCDay() + 6) % 7 + 1)); return Math.ceil(((d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86400000 + 1) / 7); };
  const used = new Set<string>(); const overrides = new Map<string, SheetOverride>(); const plan: { sheet: string; taskId: string }[] = []; const missing: string[] = [];
  for (const b of blocks) {
    const cands = tasksAll.filter((t) => String(t.code ?? '').toLowerCase() === b.code.toLowerCase() && !used.has(t.id));
    const wk = Number((b.sheet.match(/^(\d+)\./) ?? [])[1]);
    const done = cands.filter((t) => t.status === 'done');
    const t = (wk ? done.find((t) => weekOf(t.closed_at ?? t.done_at) === wk) : null) ?? done[0] ?? cands[0];
    if (!t) { missing.push(b.code); continue; }
    used.add(t.id); overrides.set(t.id, { hours: b.hours, callouts: b.callouts, mats: b.mats }); plan.push({ sheet: b.sheet, taskId: t.id });
  }
  const stem = filename.replace(/\.xlsx$/i, '').replace(/[^\w-]+/g, '_') || 'elszamolas';
  const safe = (x: string) => x.replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_').replace(/\.+$/, '');
  const sheets = [...new Set(plan.map((p) => p.sheet))];
  if (plan.length === 0) return json({ error: `Az Excel sorszámaihoz nincs feladat az appban: ${missing.join(', ')}` }, 404);
  if (planOnly) {
    // terv az appnak: lapónként (hetenként) a feladatok és az Excelből jövő felülírások — a PDF-eket az app darabonként kéri
    return json({ missing, filename: `munkalapok_${stem}.zip`, groups: sheets.map((sh) => ({ key: safe(sh), items: plan.filter((p) => p.sheet === sh).map((p) => ({ task_id: p.taskId, ...overrides.get(p.taskId) })) })) });
  }
  // régebbi app: feladatonként PDF, lapónként mappa (legfeljebb 20 feladat — a szerver CPU-kerete)
  const docs = await buildWorksheets(supabase, plan.slice(0, 20).map((p) => ({ key: p.taskId, taskIds: [p.taskId] })), null, overrides);
  if (docs.length === 1) return json({ missing, count: 1, filename: `munkalap_${safe(docs[0].codes[0] || 'feladat')}.pdf`, mime: 'application/pdf', base64: toB64(docs[0].bytes) });
  const zip = new JSZip();
  for (const d of docs) { const sh = plan.find((p) => p.taskId === d.key)!.sheet; (sheets.length > 1 ? zip.folder(safe(sh))! : zip).file(`munkalap_${safe(d.codes[0] || d.key.slice(0, 8))}.pdf`, d.bytes); }
  return json({ missing, count: docs.length, filename: `munkalapok_${stem}.zip`, mime: 'application/zip', base64: await zip.generateAsync({ type: 'base64', compression: 'STORE' }) });
}

/** a papír-minta rajzolása: fejléc, kód-sáv, 4 szakasz (alapadatok, munkálatok, anyagok, megjegyzések) */
function drawSheet(page: PDFPage, font: PDFFont, bold: PDFFont, d: SheetData) {
  const W = 595.28, L = 40, R = W - 40;
  const navy = rgb(0.12, 0.23, 0.54), grey = rgb(0.85, 0.87, 0.92), dark = rgb(0.1, 0.1, 0.1), white = rgb(1, 1, 1), line = rgb(0.6, 0.6, 0.6);
  const text = (s: string, x: number, y: number, size = 10, f: PDFFont = font, color = dark) => page.drawText(s, { x, y, size, font: f, color });
  const fit = (s: string, w: number, size: number, f: PDFFont = font) => { let o = s; while (o.length > 1 && f.widthOfTextAtSize(o, size) > w) o = o.slice(0, -2) + '…'; return o; };
  /** szöveg tördelése adott szélességre */
  const wrap = (s: string, w: number, size: number, f: PDFFont = font): string[] => {
    const out: string[] = [];
    for (const para of s.split('\n')) {
      let cur = '';
      for (const word of para.split(' ')) {
        const nx = cur ? cur + ' ' + word : word;
        if (f.widthOfTextAtSize(nx, size) <= w) cur = nx;
        else { if (cur) out.push(cur); cur = f.widthOfTextAtSize(word, size) <= w ? word : fit(word, w, size, f); }
      }
      out.push(cur);
    }
    return out;
  };
  let y = 800;
  // fejléc
  text('KARBANTARTÁSI MUNKALAP', L, y, 20, bold, rgb(0.35, 0.35, 0.35));
  text(COMPANY, R - bold.widthOfTextAtSize(COMPANY, 9), y + 6, 9, bold, rgb(0.35, 0.35, 0.35));
  y -= 16; text('Munkavégzési és anyagfelhasználási nyilvántartás', L, y, 8.5, font, rgb(0.4, 0.4, 0.4));
  y -= 6; page.drawLine({ start: { x: L, y }, end: { x: R, y }, thickness: 1.2, color: rgb(0.3, 0.3, 0.3) });
  // kód-sáv
  y -= 34; page.drawRectangle({ x: L, y, width: R - L, height: 26, borderColor: navy, borderWidth: 1.2, color: rgb(0.93, 0.95, 0.99) });
  text('MUNKA KÓDJA:', L + 10, y + 8, 11, bold, navy);
  text(fit(d.code, R - L - 130, 13, bold), L + 115, y + 8, 13, bold, dark);
  const section = (title: string) => { y -= 30; page.drawRectangle({ x: L, y, width: R - L, height: 18, color: grey }); page.drawRectangle({ x: L, y, width: 4, height: 18, color: navy }); text(title, L + 12, y + 5, 10.5, bold, dark); y -= 8; };
  const field = (label: string, value: string, x: number, w: number, yy: number) => {
    text(label, x, yy, 9, bold, dark);
    const lx = x + bold.widthOfTextAtSize(label, 9) + 6;
    page.drawLine({ start: { x: lx, y: yy - 3 }, end: { x: x + w, y: yy - 3 }, thickness: 0.6, color: line });
    text(fit(value, x + w - lx - 4, 10), lx + 2, yy, 10);
  };
  // 1. alapadatok
  section('1. MUNKAVÉGZÉS ALAPADATAI');
  y -= 16; field('Dátum:', d.date, L, 255, y); field('Munkavégző neve:', d.worker, L + 275, R - L - 275, y);
  y -= 22; field('Munkaterület / Cím:', d.site, L, R - L, y);
  y -= 22; field('Munka kezdése:', d.start, L, 255, y); field('Munka befejezése:', d.end, L + 275, R - L - 275, y);
  y -= 22; field('Elszámolt munkaóra:', d.hours, L, 255, y); field('Kiszállás:', d.callouts, L + 275, R - L - 275, y);
  if (d.perDay) { y -= 14; text(fit('Naponként: ' + d.perDay, R - L, 8), L, y, 8, font, rgb(0.35, 0.35, 0.35)); }
  // 2. munkálatok
  section('2. ELVÉGZETT KARBANTARTÁSI MUNKÁLATOK');
  const tableHead = (cols: { label: string; x: number; w: number }[]) => {
    y -= 22; page.drawRectangle({ x: L, y, width: R - L, height: 20, color: navy });
    for (const c of cols) text(c.label, c.x + 4, y + 6, 8.5, bold, white);
  };
  const row = (cells: { s: string; x: number; w: number; f?: PDFFont }[], minH = 18) => {
    const lines = cells.map((c) => wrap(c.s, c.w - 8, 9.5, c.f));
    const h = Math.max(minH, 5 + 12 * Math.max(1, ...lines.map((l) => l.length)));
    y -= h; page.drawRectangle({ x: L, y, width: R - L, height: h, borderColor: line, borderWidth: 0.5 });
    cells.forEach((c, i) => { if (i > 0) page.drawLine({ start: { x: c.x, y }, end: { x: c.x, y: y + h }, thickness: 0.5, color: line }); lines[i].forEach((ln, k) => text(ln, c.x + 4, y + h - 12 - 12 * k, 9.5, c.f)); });
  };
  const c2 = [{ label: 'SSZ.', x: L, w: 32 }, { label: 'ELVÉGZETT FELADAT / MUNKALEÍRÁS', x: L + 32, w: R - L - 32 - 110 }, { label: 'ÁLLAPOT', x: R - 110, w: 110 }];
  tableHead(c2);
  const works = d.works.length ? d.works : [''];
  for (let i = 0; i < Math.max(5, works.length); i++) row([{ s: `${i + 1}.`, x: c2[0].x, w: c2[0].w, f: bold }, { s: works[i] ?? '', x: c2[1].x, w: c2[1].w }, { s: works[i] ? d.state : '', x: c2[2].x, w: c2[2].w, f: bold }]);
  // 3. anyagok
  section('3. MUNKAVÉGZÉSHEZ FELHASZNÁLT ANYAGOK');
  const c3 = [{ label: 'SSZ.', x: L, w: 32 }, { label: 'ANYAG MEGNEVEZÉSE / TÍPUSA', x: L + 32, w: R - L - 32 - 230 }, { label: 'MENNYISÉG', x: R - 230, w: 70 }, { label: 'EGYSÉG (DB/M/KG)', x: R - 160, w: 80 }, { label: 'ÁR (FT)', x: R - 80, w: 80 }];
  tableHead(c3);
  for (let i = 0; i < Math.max(4, d.mats.length); i++) {
    const m = d.mats[i];
    row([{ s: `${i + 1}.`, x: c3[0].x, w: c3[0].w, f: bold }, { s: m?.name ?? '', x: c3[1].x, w: c3[1].w }, { s: m?.qty ?? '', x: c3[2].x, w: c3[2].w }, { s: m?.unit ?? '', x: c3[3].x, w: c3[3].w }, { s: m?.price ?? '', x: c3[4].x, w: c3[4].w }]);
  }
  // 4. megjegyzések
  section('4. EGYÉB MEGJEGYZÉSEK / ÉSZREVÉTELEK / ESETLEGES HIBALISTA');
  const lines = d.remarks.flatMap((r) => wrap(r, R - L - 12, 9.5));
  const boxH = Math.max(70, Math.min(y - 40, 16 + 12 * lines.length));
  y -= boxH + 4; page.drawRectangle({ x: L, y, width: R - L, height: boxH, borderColor: line, borderWidth: 0.5 });
  lines.slice(0, Math.floor((boxH - 8) / 12)).forEach((ln, k) => text(ln, L + 6, y + boxH - 14 - 12 * k, 9.5));
}
