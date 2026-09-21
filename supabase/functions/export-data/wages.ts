// Havi bérkimutatás (Excel + PDF) — az export-data funkció `mode: 'wages'` ága.

import * as XLSX from 'npm:xlsx@0.18.5';
import { PDFDocument, rgb, StandardFonts } from 'npm:pdf-lib@1.17.1';
import fontkit from 'npm:@pdf-lib/fontkit@1.1.1';

const FONT_URL = 'https://cdn.jsdelivr.net/gh/googlefonts/roboto@main/src/hinted/Roboto-Regular.ttf';
const FONT_SHA256 = '56a45233d29f11b4dfb86d248e921939d115778f87325e7ae8cc108383d6664d';

const ft = (n: number) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' Ft';
const hd = (d: string | null) => (d ? d.slice(0, 10).replace(/-/g, '.') + '.' : '');

/** Magyar ékezetekhez (ő, ű) beágyazott font kell; a letöltött fájl SHA-256-át rögzített
 *  értékhez hasonlítjuk. Hiba esetén beépített betűtípus (ékezet nélkül), nem 500-as hiba. */
async function loadFont(pdf: PDFDocument) {
  try {
    const res = await fetch(FONT_URL);
    if (!res.ok) throw new Error('font http ' + res.status);
    const bytes = await res.arrayBuffer();
    const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((x) => x.toString(16).padStart(2, '0')).join('');
    if (digest !== FONT_SHA256) throw new Error('font integrity mismatch');
    return { font: await pdf.embedFont(bytes, { subset: true }), unicode: true };
  } catch (e) {
    console.warn('export-data font', e);
    return { font: await pdf.embedFont(StandardFonts.Helvetica), unicode: false };
  }
}
function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(bin);
}
const hours = (h: number) => (Math.round(h * 100) / 100).toString().replace('.', ',');

/** Havi bérkimutatás: munkavállalónként a napok, órák, bér, kiszállás, kifizetettség. */
export async function exportWages(supabase: any, month: string, workerId: string | null, format: 'xlsx' | 'pdf', json: (b: unknown, s?: number) => Response) {
  const [yy, mm] = month.split('-').map(Number);
  const from = `${month}-01`;
  const to = `${month}-${String(new Date(Date.UTC(yy, mm, 0)).getUTCDate()).padStart(2, '0')}`;
  let q = supabase.from('attendance')
    .select('work_date, pay_basis, hours, day_multiplier, applied_rate, amount, commission_amount, callout_fee, paid_at, note, worker_id, sites(name), workers(name, nickname, contractor_id, worker_type, company_name)')
    .gte('work_date', from).lte('work_date', to).is('deleted_at', null).order('work_date');
  if (workerId) q = q.eq('worker_id', workerId);
  const { data: rows, error } = await q;
  if (error) throw error;
  const { data: allWorkers } = await supabase.from('workers').select('id, name');
  const nameOf = new Map<string, string>((allWorkers ?? []).map((w: any) => [w.id, w.name]));

  type Day = { date: string; site: string; basis: string; hours: number; wage: number; callout: number; total: number; paid: boolean; note: string };
  type Group = { name: string; boss: string; days: Day[] };
  const groups = new Map<string, Group>();
  for (const a of rows ?? []) {
    const callout = Number(a.callout_fee ?? 0);
    const total = Number(a.amount) - Number(a.commission_amount ?? 0);
    const g = groups.get(a.worker_id) ?? {
      name: a.workers?.name ?? '?',
      boss: a.workers?.contractor_id ? (nameOf.get(a.workers.contractor_id) ?? '') : '',
      days: [],
    };
    g.days.push({
      date: hd(a.work_date), site: a.sites?.name ?? '',
      basis: a.pay_basis === 'hourly' ? `órabér (${ft(Number(a.applied_rate))}/ó)` : a.pay_basis === 'daily' ? `napi díj ×${a.day_multiplier}` : a.pay_basis === 'project' ? 'projektdíj' : 'jelenlét',
      hours: Number(a.hours ?? 0), wage: total - callout, callout, total, paid: !!a.paid_at, note: a.note ?? '',
    });
    groups.set(a.worker_id, g);
  }
  const list = [...groups.values()].sort((a, b) => a.name.localeCompare(b.name, 'hu'));
  const sum = (g: Group, f: (d: Day) => number) => g.days.reduce((s, d) => s + f(d), 0);
  const title = `${yy}. ${['január', 'február', 'március', 'április', 'május', 'június', 'július', 'augusztus', 'szeptember', 'október', 'november', 'december'][mm - 1]}`;

  if (format === 'xlsx') {
    const summary = list.map((g) => ({
      'Munkavállaló': g.name, 'Vállalkozó': g.boss,
      'Napok': new Set(g.days.map((d) => d.date)).size, 'Órák': Math.round(sum(g, (d) => d.hours) * 100) / 100,
      'Munkabér (Ft)': sum(g, (d) => d.wage), 'Kiszállás (Ft)': sum(g, (d) => d.callout), 'Összesen (Ft)': sum(g, (d) => d.total),
      'Kifizetve (Ft)': sum(g, (d) => (d.paid ? d.total : 0)), 'Függő (Ft)': sum(g, (d) => (d.paid ? 0 : d.total)),
    }));
    summary.push({
      'Munkavállaló': 'ÖSSZESEN', 'Vállalkozó': '',
      'Napok': summary.reduce((s, r) => s + r['Napok'], 0), 'Órák': Math.round(summary.reduce((s, r) => s + r['Órák'], 0) * 100) / 100,
      'Munkabér (Ft)': summary.reduce((s, r) => s + r['Munkabér (Ft)'], 0), 'Kiszállás (Ft)': summary.reduce((s, r) => s + r['Kiszállás (Ft)'], 0),
      'Összesen (Ft)': summary.reduce((s, r) => s + r['Összesen (Ft)'], 0),
      'Kifizetve (Ft)': summary.reduce((s, r) => s + r['Kifizetve (Ft)'], 0), 'Függő (Ft)': summary.reduce((s, r) => s + r['Függő (Ft)'], 0),
    });
    const detail = list.flatMap((g) => g.days.map((d) => ({
      'Munkavállaló': g.name, 'Dátum': d.date, 'Helyszín': d.site, 'Elszámolás': d.basis, 'Órák': d.hours,
      'Munkabér (Ft)': d.wage, 'Kiszállás (Ft)': d.callout, 'Összesen (Ft)': d.total, 'Kifizetve': d.paid ? 'igen' : 'nem', 'Megjegyzés': d.note,
    })));
    const wb = XLSX.utils.book_new();
    const s1 = XLSX.utils.json_to_sheet(summary); s1['!cols'] = [{ wch: 28 }, { wch: 22 }, { wch: 7 }, { wch: 8 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }];
    const s2 = XLSX.utils.json_to_sheet(detail); s2['!cols'] = [{ wch: 28 }, { wch: 12 }, { wch: 30 }, { wch: 22 }, { wch: 7 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 10 }, { wch: 30 }];
    XLSX.utils.book_append_sheet(wb, s1, 'Összesítő');
    XLSX.utils.book_append_sheet(wb, s2, 'Napok');
    return json({
      filename: `berek_${month}.xlsx`,
      mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      base64: XLSX.write(wb, { type: 'base64', bookType: 'xlsx' }),
    });
  }

  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const { font } = await loadFont(pdf);
  const dark = rgb(0.1, 0.12, 0.13), grey = rgb(0.42, 0.45, 0.5), line = rgb(0.85, 0.85, 0.85);
  let page = pdf.addPage([595, 842]);
  let y = 800;
  const need = (h: number) => { if (y - h < 45) { page = pdf.addPage([595, 842]); y = 800; } };
  const text = (t: string, x: number, size = 9, color = dark) => page.drawText(t, { x, y, size, font, color });
  const right = (t: string, xr: number, size = 9, color = dark) => page.drawText(t, { x: xr - font.widthOfTextAtSize(t, size), y, size, font, color });
  const fit = (t: string, w: number, size = 9) => { let o = t; while (o.length > 1 && font.widthOfTextAtSize(o, size) > w) o = o.slice(0, -2) + '…'; return o; };
  const hr = () => { page.drawLine({ start: { x: 40, y: y + 9 }, end: { x: 555, y: y + 9 }, thickness: 0.5, color: line }); };

  text(`Bérkimutatás — ${title}`, 40, 16); y -= 20;
  text(`Készült: ${hd(new Date().toISOString())} · ${list.length} munkavállaló`, 40, 9, grey); y -= 22;

  // összesítő
  text('Összesítő', 40, 12); y -= 16;
  text('Munkavállaló', 40, 8, grey); right('Nap', 300, 8, grey); right('Óra', 345, 8, grey); right('Összesen', 425, 8, grey); right('Kifizetve', 490, 8, grey); right('Függő', 555, 8, grey); y -= 12;
  let gT = 0, gP = 0;
  for (const g of list) {
    need(14); hr();
    const tot = sum(g, (d) => d.total), paid = sum(g, (d) => (d.paid ? d.total : 0));
    gT += tot; gP += paid;
    text(fit(g.name + (g.boss ? ` (${g.boss})` : ''), 235), 40);
    right(String(new Set(g.days.map((d) => d.date)).size), 300); right(hours(sum(g, (d) => d.hours)), 345);
    right(ft(tot), 425); right(ft(paid), 490); right(ft(tot - paid), 555); y -= 13;
  }
  need(16); hr();
  text('ÖSSZESEN', 40, 10); right(ft(gT), 425, 10); right(ft(gP), 490, 10); right(ft(gT - gP), 555, 10); y -= 26;

  // részletezés munkavállalónként
  for (const g of list) {
    need(60);
    text(g.name + (g.boss ? ` — ${g.boss} embere` : ''), 40, 12); y -= 15;
    text('Dátum', 40, 8, grey); text('Helyszín', 100, 8, grey); text('Elszámolás', 270, 8, grey); right('Óra', 400, 8, grey); right('Kiszállás', 455, 8, grey); right('Összesen', 515, 8, grey); right('Kifiz.', 555, 8, grey); y -= 12;
    for (const d of g.days) {
      need(13); hr();
      text(d.date, 40); text(fit(d.site, 165), 100); text(fit(d.basis, 100), 270);
      right(d.hours ? hours(d.hours) : '', 400); right(d.callout ? ft(d.callout) : '', 455); right(ft(d.total), 515); right(d.paid ? 'igen' : 'nem', 555, 8, d.paid ? dark : grey);
      y -= 12;
    }
    need(16); hr();
    text(`Összesen: ${new Set(g.days.map((d) => d.date)).size} nap · ${hours(sum(g, (d) => d.hours))} óra`, 40, 10);
    right(ft(sum(g, (d) => d.total)), 515, 10); y -= 13;
    text(`Kifizetve: ${ft(sum(g, (d) => (d.paid ? d.total : 0)))} · Függő: ${ft(sum(g, (d) => (d.paid ? 0 : d.total)))}`, 40, 8, grey); y -= 24;
  }
  if (list.length === 0) { text('Ebben a hónapban nincs rögzített munkanap.', 40, 11); }

  return json({ filename: `berek_${month}.pdf`, mime: 'application/pdf', base64: toBase64(new Uint8Array(await pdf.save())) });
}
