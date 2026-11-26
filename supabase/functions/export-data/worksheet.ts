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

export interface WorksheetFilter { taskId: string | null; siteId: string | null; from: string; to: string; status: TaskStatusFilter; workerId: string | null; code: string | null }

export async function exportWorksheets(supabase: any, f: WorksheetFilter, json: (b: unknown, s?: number) => Response) {
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
  // ha csak egy munkavállaló munkalapjai kellenek: a feladatai, ahol ő ki van osztva / dolgozott rajta — ezt a
  // buildWorksheets a betöltött adatokból szűri
  const pdfs = await buildWorksheets(supabase, tasks.map((t: any) => t.id), f.workerId);
  const toB64 = (b: Uint8Array) => { let s = ''; for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode(...b.subarray(i, i + 8192)); return btoa(s); };
  if (pdfs.length === 0) return json({ error: 'Nincs a szűrésnek megfelelő feladat.' }, 404);
  if (pdfs.length === 1) return json({ filename: pdfs[0].name, mime: 'application/pdf', base64: toB64(pdfs[0].bytes) });
  const zip = new JSZip();
  for (const p of pdfs) zip.file(p.name, p.bytes);
  return json({ count: pdfs.length, filename: `munkalapok_${f.from}_${f.to}.zip`, mime: 'application/zip', base64: await zip.generateAsync({ type: 'base64', compression: 'DEFLATE' }) });
}

/** Feladat-azonosítókhoz a munkalap-PDF-ek (feladatonként egy). workerId: csak azok a feladatok, ahol ő ki van
 *  osztva vagy dolgozott rajta. Az elszámolás-export is ezt hívja (hetenként mappába a munkalapokkal). */
export async function buildWorksheets(supabase: any, ids: string[], workerId: string | null = null): Promise<{ taskId: string; code: string; name: string; bytes: Uint8Array }[]> {
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
  const pdfs: { taskId: string; code: string; name: string; bytes: Uint8Array }[] = [];
  for (const t of list) {
    const pdf = await PDFDocument.create();
    pdf.registerFontkit(fontkit);
    const font = regBytes ? await pdf.embedFont(regBytes, { subset: true }) : await pdf.embedFont(StandardFonts.Helvetica);
    const bold = boldBytes ? await pdf.embedFont(boldBytes, { subset: true }) : await pdf.embedFont(StandardFonts.HelveticaBold);
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
      start: ses.length ? hm(ses[0].started_at) : '', end: ses.length ? hm(ses[ses.length - 1].ended_at) : '',
      perDay: days.length > 1 ? days.map((d) => { const ds = ses.filter((s: any) => budDay(s.started_at) === d); return `${hd(d)} ${hm(ds[0].started_at)}–${hm(ds[ds.length - 1].ended_at)}`; }).join('; ') : '',
      works, state,
      mats: mats.map((m: any) => {
        const qty = m.quantity != null && Number(m.quantity) > 0 ? Number(m.quantity) : 1;
        const price = resaleOf.get(m.id) ?? Number(m.amount);
        return { name: String(m.note || 'Anyag').replace(/\s+/g, ' ').trim(), qty: String(qty).replace('.', ','), unit: m.unit || 'db', price: ft(price) };
      }),
      remarks,
    });
    pdfs.push({ taskId: t.id, code: String(t.code || ''), name: `munkalap_${String(t.code || t.id.slice(0, 8)).replace(/[^\w-]+/g, '_')}.pdf`, bytes: await pdf.save() });
  }
  return pdfs;
}

interface SheetData { code: string; date: string; worker: string; site: string; start: string; end: string; perDay: string; works: string[]; state: string; mats: { name: string; qty: string; unit: string; price: string }[]; remarks: string[] }

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
