// Webes URL-segédek. FIGYELEM: natív appban a `window` létezik, de a `window.location` NEM —
// ezért a `typeof window !== 'undefined'` ellenőrzés natívon nem véd, és összeomláshoz vezet.
// Minden location-hozzáférés ezen a modulon át menjen.

import { Platform } from 'react-native';

/** Az éles webapp címe — natív appból az e-mailes linkek (megerősítés, jelszócsere) ide visznek. */
export const WEB_ORIGIN = 'https://ktg.szakify.hu';

const loc = (): Location | null =>
  (Platform.OS === 'web' && typeof window !== 'undefined' && window.location ? window.location : null);

/** Az aktuális origin weben (helyi fejlesztésnél localhost); natívon az éles webapp címe. */
export function appOrigin(): string { return loc()?.origin ?? WEB_ORIGIN; }
export function webPathname(): string { return loc()?.pathname ?? ''; }
export function webSearch(): string { return loc()?.search ?? ''; }
export function webHash(): string { return loc()?.hash ?? ''; }
