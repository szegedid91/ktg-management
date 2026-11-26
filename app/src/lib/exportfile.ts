// Export-fájl (Excel / PDF) lekérése az export-data edge-funkciótól és
// letöltése (weben böngésző-letöltés, telefonon megosztó-lap).

import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { supabase } from './supabase';
import { confirmDialog } from './dialogs';
import { base64ToBytes } from './zip';

/** Letölti az exportot. Visszaadja a szerver kísérő adatait (pl. `missing`: a megadott sorszámok közül melyikhez
 *  nem volt találat). */
export async function downloadExport(body: Record<string, unknown>): Promise<{ missing: string[] }> {
  const data = await callExport(body);
  const info = { missing: Array.isArray(data.missing) ? data.missing.map(String) : [] };
  await saveDownload(data.filename, data.mime, base64ToBytes(data.base64));
  return info;
}

/** Az export-data függvény hívása; a szerver hibaüzenete (pl. „Nincs a szűrésnek megfelelő feladat”) hibaként jön vissza. */
export async function callExport(body: Record<string, unknown>): Promise<any> {
  const { data, error } = await supabase.functions.invoke('export-data', { body });
  if (error) {
    // a nem-2xx válasz törzsében a szerver üzenete (pl. túl nagy kérés); a „CPU Time exceeded” 546-tal jön, törzs nélkül
    let msg = String(error?.message ?? error);
    try { const b = await (error as any)?.context?.json?.(); if (b?.error) msg = String(b.error); } catch { /* nincs törzs */ }
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

/** A kész fájl mentése: weben böngésző-letöltés (iPhone-on megosztó-lap), telefonon megosztó-lap. */
export async function saveDownload(filename: string, mime: string, bytes: Uint8Array): Promise<void> {
  const data = { filename, mime };

  if (Platform.OS === 'web') {
    const blob = new Blob([bytes as BlobPart], { type: data.mime });
    const nav: any = typeof navigator !== 'undefined' ? navigator : {};
    const ua = String(nav.userAgent ?? '');
    const isIOS = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && Number(nav.maxTouchPoints ?? 0) > 1);
    // iPhone / iPad: a főképernyőre tett appban az <a download> csendben elhal (nincs letöltéskezelő), és a
    // hálózati várakozás után a böngésző már nem tekinti a koppintást „friss”-nek — ezért a kész fájlt egy
    // megerősítő gomb mögé tesszük: a gombnyomás nyitja a megosztó-lapot (Fájlok, Mail, Drive…), ha az nem
    // elérhető, új lapon nyílik meg a fájl, ahonnan a Megosztás gombbal menthető
    if (isIOS) {
      const file = new File([blob], data.filename, { type: data.mime });
      const canShare = typeof nav.canShare === 'function' && nav.canShare({ files: [file] });
      const ok = await confirmDialog('Elkészült a fájl', data.filename, canShare ? '📤 Megosztás / mentés' : '📂 Megnyitás', false, 'Mégse');
      if (!ok) return;
      if (canShare) {
        try { await nav.share({ files: [file], title: data.filename }); return; } catch (e: any) {
          if (String(e?.name) === 'AbortError') return; // a megosztó-lapot bezárta
        }
      }
      const url = URL.createObjectURL(blob);
      const w = window.open(url, '_blank');
      if (!w) {
        const a = document.createElement('a'); a.href = url; a.target = '_blank'; a.rel = 'noopener'; a.click();
      }
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = data.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } else {
    const path = FileSystem.cacheDirectory + data.filename;
    await FileSystem.writeAsStringAsync(path, bytesToBase64(bytes), { encoding: FileSystem.EncodingType.Base64 });
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(path, { mimeType: data.mime, dialogTitle: data.filename });
    }
  }
}
function bytesToBase64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode(...b.subarray(i, i + 8192));
  return btoa(s);
}

/** Munkalap-PDF-ek lekérése darabonként (legfeljebb 6 feladat kérésenként — a szerver CPU-kerete); ha egy darab
 *  elhal (pl. túl sok oldal), felezve újrapróbálja. onProgress: kész / összes. */
export async function fetchWorksheetPdfs(
  items: { task_id: string; hours?: number | null; callouts?: number | null; mats?: unknown }[],
  onProgress?: (done: number, total: number) => void,
): Promise<{ task_id: string; name: string; bytes: Uint8Array }[]> {
  const out: { task_id: string; name: string; bytes: Uint8Array }[] = [];
  let done = 0;
  const run = async (chunk: typeof items): Promise<void> => {
    try {
      const data = await callExport({ mode: 'worksheet', items: chunk });
      for (const f of data.files ?? []) out.push({ task_id: String(f.task_id), name: String(f.name), bytes: base64ToBytes(String(f.base64)) });
      done += chunk.length; onProgress?.(done, items.length);
    } catch (e) {
      if (chunk.length <= 1) throw e;
      const mid = Math.ceil(chunk.length / 2);
      await run(chunk.slice(0, mid)); await run(chunk.slice(mid));
    }
  };
  for (let i = 0; i < items.length; i += 6) await run(items.slice(i, i + 6));
  return out;
}
