// Eszköz QR-kódok: a kód egy mély link az eszköz oldalára (?eq=<id>),
// így a telefon kamerájával beolvasva az app az áthelyezés űrlappal nyílik.
// A címke-nyomtatás csak weben él (böngésző nyomtató-párbeszéd).

import { Platform } from 'react-native';
import QRCode from 'qrcode';

export const APP_ORIGIN = 'https://ktg.szakify.hu';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Az eszközhöz tartozó QR-kód tartalma (mély link) */
export function equipmentQrUrl(equipmentId: string): string {
  return `${APP_ORIGIN}/equipment?eq=${equipmentId}`;
}

/** Beolvasott/beírt szövegből az eszköz azonosítója: a mély link
 *  (…/equipment?eq=<uuid>) vagy csupasz uuid. Egyébként null. */
export function parseEquipmentCode(text: string): string | null {
  const t = text.trim();
  if (!t) return null;
  if (UUID_RE.test(t)) return t.toLowerCase();
  const m = /[?&]eq=([0-9a-f-]{36})/i.exec(t);
  if (m && UUID_RE.test(m[1])) return m[1].toLowerCase();
  return null;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

export interface QrLabel { id: string; name: string }

/** Címkék nyomtatása (csak web): A4, 3 oszlop, címkénként ~40 mm-es QR + név.
 *  Az ablakot azonnal (a kattintás közben) nyitjuk, hogy a felugró-blokkoló
 *  ne fogja meg; a tartalom utólag kerül bele. Visszatérés: sikerült-e elindítani. */
export async function printEquipmentLabels(items: QrLabel[]): Promise<'ok' | 'blocked' | 'unsupported'> {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return 'unsupported';
  const w = window.open('', '_blank');
  if (!w) return 'blocked';
  w.document.write('<!doctype html><title>QR címkék</title><p style="font-family:sans-serif">Címkék készítése…</p>');

  const cards = await Promise.all(items.map(async (it) => {
    const svg = await QRCode.toString(equipmentQrUrl(it.id), { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
    return `<div class="label">${svg}<div class="name">${escapeHtml(it.name)}</div></div>`;
  }));

  const html = `<!doctype html>
<html lang="hu"><head><meta charset="utf-8"><title>QR címkék — eszközök</title>
<style>
  @page { size: A4; margin: 10mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: #111; background: #fff; }
  .toolbar { padding: 10px 12px; border-bottom: 1px solid #ddd; display: flex; gap: 12px; align-items: center; }
  .toolbar button { font-size: 15px; padding: 8px 16px; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4mm; padding: 6mm; }
  .label { border: 1px dashed #999; border-radius: 3mm; padding: 4mm 3mm; text-align: center;
           break-inside: avoid; page-break-inside: avoid; }
  .label svg { width: 40mm; height: 40mm; display: block; margin: 0 auto 2mm; }
  .name { font-size: 12pt; font-weight: 700; line-height: 1.2; word-break: break-word; }
  @media print { .toolbar { display: none; } .grid { padding: 0; } }
</style></head>
<body>
  <div class="toolbar">
    <button onclick="window.print()">🖨️ Nyomtatás</button>
    <span>${items.length} címke — A4, 3 oszlop. A nyomtatásnál ne legyen méretezés („tényleges méret”).</span>
  </div>
  <div class="grid">${cards.join('')}</div>
  <script>window.addEventListener('load', function () { setTimeout(function () { window.print(); }, 250); });</script>
</body></html>`;

  w.document.open();
  w.document.write(html);
  w.document.close();
  return 'ok';
}
