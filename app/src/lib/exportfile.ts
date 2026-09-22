// Export-fájl (Excel / PDF) lekérése az export-data edge-funkciótól és
// letöltése (weben böngésző-letöltés, telefonon megosztó-lap).

import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { supabase } from './supabase';

export async function downloadExport(body: Record<string, unknown>): Promise<void> {
  const { data, error } = await supabase.functions.invoke('export-data', { body });
  if (error) throw error;
  if (data.error) throw new Error(data.error);

  if (Platform.OS === 'web') {
    const a = document.createElement('a');
    a.href = `data:${data.mime};base64,${data.base64}`;
    a.download = data.filename;
    a.click();
  } else {
    const path = FileSystem.cacheDirectory + data.filename;
    await FileSystem.writeAsStringAsync(path, data.base64, { encoding: FileSystem.EncodingType.Base64 });
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(path, { mimeType: data.mime, dialogTitle: data.filename });
    }
  }
}
