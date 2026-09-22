// Export könyvelőnek: Excel (xlsx) és PDF — költséglista számlafotó-
// hivatkozásokkal, bevételi lista, bérek, ÁFA-bontás.
// Bemenet: { from: "ÉÉÉÉ-HH-NN", to: "ÉÉÉÉ-HH-NN", site_id?: uuid, format: "xlsx" | "pdf" }
// Kimenet: { filename, mime, base64 }

import { createClient } from 'npm:@supabase/supabase-js@2';
import * as XLSX from 'npm:xlsx@0.18.5';
import { PDFDocument, rgb, StandardFonts } from 'npm:pdf-lib@1.17.1';
import fontkit from 'npm:@pdf-lib/fontkit@1.1.1';
import { identifyCaller } from './caller.ts';
import { exportWages } from './wages.ts';
import { exportTasks } from './tasks.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const FONT_URL = 'https://cdn.jsdelivr.net/gh/googlefonts/roboto@main/src/hinted/Roboto-Regular.ttf';
const FONT_SHA256 = '56a45233d29f11b4dfb86d248e921939d115778f87325e7ae8cc108383d6664d';

const ft = (n: number) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' Ft';
const hd = (d: string | null) => (d ? d.slice(0, 10).replace(/-/g, '.') + '.' : '');

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  try {
    const body = await req.json().catch(() => ({}));
    const ISO = /^\d{4}-\d{2}-\d{2}$/;
    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const from = ISO.test(body.from ?? '') ? body.from : '1970-01-01';
    const to = ISO.test(body.to ?? '') ? body.to : '2999-12-31';
    const site_id = UUID.test(body.site_id ?? '') ? body.site_id : null;
    const format = body.format === 'pdf' ? 'pdf' : 'xlsx';

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    // csak vezető exportálhat — a munkavállalói fiók nem lát pénzügyet
    const caller = await identifyCaller(req, supabase);
    if (!caller) return json({ error: 'Bejelentkezés szükséges.' }, 401);
    if (!caller.isPartner) return json({ error: 'Az export csak a vezetőknek érhető el.' }, 403);

    // havi bérkimutatás (munkavállalók napjai, bérei)
    if (body.mode === 'wages') {
      const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(body.month ?? '') ? body.month : new Date().toISOString().slice(0, 7);
      const workerId = UUID.test(body.worker_id ?? '') ? body.worker_id : null;
      return await exportWages(supabase, month, workerId, format, json);
    }
    // feladat-összesítő (helyszín, kódok, munkaóra, kiszállás, anyagköltség) — csak Excel
    if (body.mode === 'tasks') {
      const taskId = UUID.test(body.task_id ?? '') ? body.task_id : null;
      return await exportTasks(supabase, { taskId, siteId: site_id, from, to }, json);
    }

    let expQ = supabase.from('expenses').select('*, expense_categories(name), sites(name), profiles:created_by(display_name)')
      .gte('expense_date', from).lte('expense_date', to).is('deleted_at', null).order('expense_date');
    let attQ = supabase.from('v_attendance_detail').select('*')
      .gte('work_date', from).lte('work_date', to).order('work_date');
    let invQ = supabase.from('invoices').select('*, sites(name)')
      .gte('invoice_date', from).lte('invoice_date', to).is('deleted_at', null).order('invoice_date');
    if (site_id) {
      expQ = expQ.eq('site_id', site_id);
      attQ = attQ.eq('site_id', site_id);
      invQ = invQ.eq('site_id', site_id);
    }
    const [{ data: expenses }, { data: attendance }, { data: invoices }] = await Promise.all([expQ, attQ, invQ]);
    // csak az exportált költségek fotói kapnak (7 napos) linket
    const expenseIds = (expenses ?? []).map((e: any) => e.id);
    const { data: photos } = expenseIds.length
      ? await supabase.from('expense_photos').select('*').is('deleted_at', null).in('expense_id', expenseIds)
      : { data: [] as any[] };

    // számlafotó signed URL-ek (7 nap)
    const photoUrls = new Map<string, string[]>();
    for (const p of photos ?? []) {
      const { data } = await supabase.storage.from('receipts').createSignedUrl(p.storage_path, 7 * 86400);
      if (data?.signedUrl) {
        const arr = photoUrls.get(p.expense_id) ?? [];
        arr.push(data.signedUrl);
        photoUrls.set(p.expense_id, arr);
      }
    }

    const expRows = (expenses ?? []).map((e: any) => ({
      'Dátum': hd(e.expense_date), 'Építkezés': e.sites?.name ?? '',
      'Megnevezés': e.title ?? '', 'Kategória': e.expense_categories?.name ?? '',
      'Nettó (Ft)': Number(e.net_amount), 'ÁFA %': Number(e.vat_rate),
      'ÁFA (Ft)': Number(e.vat_amount), 'Bruttó (Ft)': Number(e.gross_amount),
      'Rögzítette': e.profiles?.display_name ?? '',
      'Számlafotó': (photoUrls.get(e.id) ?? []).join(' '),
    }));

    const attRows = (attendance ?? []).map((a: any) => ({
      'Dátum': hd(a.work_date), 'Építkezés': a.site_name, 'Munkavállaló': a.worker_name,
      'Elszámolás': a.pay_basis === 'hourly' ? `órabér (${a.hours} ó)` : a.pay_basis === 'daily' ? `napi díj ×${a.day_multiplier}` : a.pay_basis === 'project' ? 'projektdíj' : 'jelenlét',
      'Bérköltség (Ft)': Number(a.total_amount), 'Ebből munkásé (Ft)': Number(a.worker_amount),
      'Ebből közvetítőé (Ft)': Number(a.commission_amount),
      'ÁFA (Ft)': Number(a.vat_amount), 'Kifizetve': a.paid_at ? 'igen' : 'nem',
    }));

    const invRows = (invoices ?? []).map((i: any) => ({
      'Dátum': hd(i.invoice_date), 'Építkezés': i.sites?.name ?? '', 'Megnevezés': i.title ?? '',
      'Nettó (Ft)': Number(i.net_amount), 'ÁFA %': Number(i.vat_rate), 'ÁFA (Ft)': Number(i.vat_amount),
      'Bruttó (Ft)': Number(i.gross_amount), 'Számlázva': hd(i.invoiced_at), 'Befolyt': hd(i.paid_at),
    }));

    // ÁFA-bontás kulcsonként
    const vatMap = new Map<number, { in: number; out: number }>();
    for (const e of expenses ?? []) {
      const v = vatMap.get(Number(e.vat_rate)) ?? { in: 0, out: 0 };
      v.in += Number(e.vat_amount); vatMap.set(Number(e.vat_rate), v);
    }
    for (const i of invoices ?? []) {
      const v = vatMap.get(Number(i.vat_rate)) ?? { in: 0, out: 0 };
      v.out += Number(i.vat_amount); vatMap.set(Number(i.vat_rate), v);
    }
    const vatRows = [...vatMap.entries()].sort((a, b) => a[0] - b[0]).map(([rate, v]) => ({
      'ÁFA-kulcs (%)': rate, 'Beszerzési ÁFA (Ft)': v.in, 'Fizetendő ÁFA (Ft)': v.out,
      'Egyenleg (Ft)': v.out - v.in,
    }));

    const totalCost = expRows.reduce((s, r) => s + r['Nettó (Ft)'], 0)
      + attRows.reduce((s, r) => s + r['Bérköltség (Ft)'], 0);
    const totalPaid = (invoices ?? []).filter((i: any) => i.paid_at).reduce((s: number, i: any) => s + Number(i.net_amount), 0);

    const period = `${from}_${to}`;

    if (format === 'xlsx') {
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(expRows), 'Költségek');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(attRows), 'Bérek');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(invRows), 'Bevételek');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(vatRows), 'ÁFA-bontás');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{
        'Időszak': `${hd(from)} – ${hd(to)}`,
        'Összes nettó költség (Ft)': totalCost,
        'Befolyt nettó bevétel (Ft)': totalPaid,
        'Nettó eredmény (Ft)': totalPaid - totalCost,
      }]), 'Összesítés');
      const b64 = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
      return new Response(JSON.stringify({
        filename: `koltsegek_${period}.xlsx`,
        mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        base64: b64,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ---------- PDF ----------
    const pdf = await PDFDocument.create();
    pdf.registerFontkit(fontkit);
    // magyar ékezetekhez (ő, ű) beágyazott font kell. A letöltött fájl SHA-256-át
    // rögzített értékhez hasonlítjuk (integritás); hiba esetén beépített
    // betűtípussal készül a PDF (ékezet nélkül), nem 500-as hibával.
    let font;
    try {
      const res = await fetch(FONT_URL);
      if (!res.ok) throw new Error('font http ' + res.status);
      const bytes = await res.arrayBuffer();
      const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((x) => x.toString(16).padStart(2, '0')).join('');
      if (digest !== FONT_SHA256) throw new Error('font integrity mismatch');
      font = await pdf.embedFont(bytes, { subset: true });
    } catch (e) {
      console.warn('export-data font', e);
      font = await pdf.embedFont(StandardFonts.Helvetica);
    }

    let page = pdf.addPage([595, 842]); // A4
    let y = 800;
    const draw = (text: string, size = 10, indent = 40) => {
      if (y < 50) { page = pdf.addPage([595, 842]); y = 800; }
      page.drawText(text, { x: indent, y, size, font, color: rgb(0.1, 0.12, 0.13) });
      y -= size + 6;
    };

    draw('Építkezés-költségkövető — könyvelői összesítő', 16);
    draw(`Időszak: ${hd(from)} – ${hd(to)}`, 11);
    y -= 10;
    draw(`Összes nettó költség: ${ft(totalCost)}`, 12);
    draw(`Befolyt nettó bevétel: ${ft(totalPaid)}`, 12);
    draw(`Nettó eredmény: ${ft(totalPaid - totalCost)}`, 12);
    y -= 10;

    draw('ÁFA-bontás', 13);
    for (const r of vatRows) {
      draw(`${r['ÁFA-kulcs (%)']}% — beszerzési: ${ft(r['Beszerzési ÁFA (Ft)'])}, fizetendő: ${ft(r['Fizetendő ÁFA (Ft)'])}`, 10, 55);
    }
    y -= 10;

    draw(`Költségek (${expRows.length} tétel)`, 13);
    for (const r of expRows) {
      draw(`${r['Dátum']} ${r['Építkezés']} — ${r['Megnevezés'] || r['Kategória']}: nettó ${ft(r['Nettó (Ft)'])} + ÁFA ${ft(r['ÁFA (Ft)'])}`, 9, 55);
    }
    y -= 10;

    draw(`Bérek (${attRows.length} tétel)`, 13);
    for (const r of attRows) {
      draw(`${r['Dátum']} ${r['Építkezés']} — ${r['Munkavállaló']} (${r['Elszámolás']}): ${ft(r['Bérköltség (Ft)'])}${r['Kifizetve'] === 'igen' ? ' ✓' : ''}`, 9, 55);
    }
    y -= 10;

    draw(`Kimenő számlák (${invRows.length} tétel)`, 13);
    for (const r of invRows) {
      draw(`${r['Dátum']} ${r['Építkezés']} — ${r['Megnevezés']}: nettó ${ft(r['Nettó (Ft)'])}${r['Befolyt'] ? ` (befolyt: ${r['Befolyt']})` : ' (kintlévő)'}`, 9, 55);
    }

    const pdfBytes = await pdf.save();
    let bin = '';
    const arr = new Uint8Array(pdfBytes);
    for (let i = 0; i < arr.length; i += 8192) {
      bin += String.fromCharCode(...arr.subarray(i, i + 8192));
    }
    return new Response(JSON.stringify({
      filename: `koltsegek_${period}.pdf`,
      mime: 'application/pdf',
      base64: btoa(bin),
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error('export-data', err);
    return json({ error: 'Az export nem sikerült. Próbáld újra később.' }, 500);
  }
});
