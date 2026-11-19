// Export-fájl (Excel / PDF) lekérése az export-data edge-funkciótól és
// letöltése (weben böngésző-letöltés, telefonon megosztó-lap).

import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { supabase } from './supabase';
import { confirmDialog } from './dialogs';

/** Letölti az exportot. Visszaadja a szerver kísérő adatait (pl. `missing`: a megadott sorszámok közül melyikhez
 *  nem volt találat). */
export async function downloadExport(body: Record<string, unknown>): Promise<{ missing: string[] }> {
  const { data, error } = await supabase.functions.invoke('export-data', { body });
  if (error) throw error;
  if (data.error) throw new Error(data.error);
  const info = { missing: Array.isArray(data.missing) ? data.missing.map(String) : [] };

  if (Platform.OS === 'web') {
    const bytes = Uint8Array.from(atob(data.base64), (c) => c.charCodeAt(0));
    const blob = new Blob([bytes], { type: data.mime });
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
      if (!ok) return info;
      if (canShare) {
        try { await nav.share({ files: [file], title: data.filename }); return info; } catch (e: any) {
          if (String(e?.name) === 'AbortError') return info; // a megosztó-lapot bezárta
        }
      }
      const url = URL.createObjectURL(blob);
      const w = window.open(url, '_blank');
      if (!w) {
        const a = document.createElement('a'); a.href = url; a.target = '_blank'; a.rel = 'noopener'; a.click();
      }
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      return info;
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
    await FileSystem.writeAsStringAsync(path, data.base64, { encoding: FileSystem.EncodingType.Base64 });
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(path, { mimeType: data.mime, dialogTitle: data.filename });
    }
  }
  return info;
}
