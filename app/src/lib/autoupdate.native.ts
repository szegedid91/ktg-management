// Azonnali frissítés natív appban (Expo Updates / OTA): az itt kiadott JavaScript-frissítés
// az áruházi jóváhagyás nélkül jut el a telepített appokhoz. Az app indításkor és előtérbe
// kerüléskor ellenőriz; ha van újabb, letölti, és — ha nincs el nem küldött művelet —
// újraindul vele. (Natív modult érintő változáshoz továbbra is új áruházi build kell.)

import { AppState } from 'react-native';
import * as Updates from 'expo-updates';
import { store } from './store';

let installed = false;
let lastCheck = 0;
let busy = false;

async function check(): Promise<void> {
  if (busy || !Updates.isEnabled || __DEV__) return;
  if (Date.now() - lastCheck < 5 * 60_000) return;
  lastCheck = Date.now();
  busy = true;
  try {
    const res = await Updates.checkForUpdateAsync();
    if (!res.isAvailable) return;
    await Updates.fetchUpdateAsync();
    if (store.peekOutbox().length > 0) return; // a letöltött frissítés a következő indításkor úgyis életbe lép
    await Updates.reloadAsync();
  } catch { /* offline / nincs frissítés-szerver — majd legközelebb */ } finally { busy = false; }
}

export function installAutoUpdate(): void {
  if (installed) return;
  installed = true;
  AppState.addEventListener('change', (s) => { if (s === 'active') void check(); });
  setTimeout(() => void check(), 15_000);
}
