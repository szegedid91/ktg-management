// Vágólapra másolás: weben a böngésző API-ja; natívon (ha van) expo-clipboard,
// különben csak jelezzük, hogy nem sikerült.

import { Platform } from 'react-native';

export async function copyText(text: string): Promise<boolean> {
  try {
    if (Platform.OS === 'web') {
      if (typeof navigator !== 'undefined' && (navigator as any).clipboard?.writeText) {
        await (navigator as any).clipboard.writeText(text);
        return true;
      }
      return false;
    }
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('expo-clipboard');
    if (mod?.setStringAsync) { await mod.setStringAsync(text); return true; }
    return false;
  } catch {
    return false;
  }
}
