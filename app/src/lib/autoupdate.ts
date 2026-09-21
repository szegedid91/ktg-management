// Automatikus frissítés (web/PWA): a telepített app napokig nyitva maradhat a háttérben, és
// a régi kódot futtatja tovább. Amikor az app előtérbe kerül (és óránként), lekérdezzük a kint
// lévő verziót; ha újabb, és nincs el nem küldött művelet, újratöltünk. A függő műveletek a
// helyi tárban vannak, újratöltés után is megmaradnak — de óvatosságból megvárjuk a kiürülést.

import { Platform } from 'react-native';
import { APP_VERSION } from './version';
import { store } from './store';

let installed = false;
let lastCheck = 0;

async function check(): Promise<void> {
  if (Date.now() - lastCheck < 5 * 60_000) return; // legfeljebb 5 percenként
  lastCheck = Date.now();
  try {
    const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return;
    const { version } = await res.json();
    if (!version || version === APP_VERSION) return;
    if (store.peekOutbox().length > 0) return; // előbb menjenek fel a függő műveletek
    // beviteli mezőben állva nem töltünk újra (ne vesszen el a félig beírt szöveg)
    const el = document.activeElement as HTMLElement | null;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) { lastCheck = 0; return; }
    location.reload();
  } catch { /* offline — majd legközelebb */ }
}

export function installAutoUpdate(): void {
  if (installed || Platform.OS !== 'web' || typeof document === 'undefined') return;
  installed = true;
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void check(); });
  setInterval(() => { if (document.visibilityState === 'visible') void check(); }, 60 * 60_000);
  setTimeout(() => void check(), 30_000);
}
