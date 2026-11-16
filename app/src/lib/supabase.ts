import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    // weben a supabase-js saját localStorage-kezelése működik;
    // natívon AsyncStorage kell
    ...(Platform.OS !== 'web' ? { storage: AsyncStorage } : {}),
    autoRefreshToken: true,
    persistSession: true,
    // weben az e-mail-megerősítő link tokenjeit az URL-ből felvesszük,
    // így a megerősítés után a felhasználó egyből be is van léptetve
    detectSessionInUrl: Platform.OS === 'web',
  },
});

/** Érvényes (nem lejárt) belépési munkamenet, vagy null.
 *
 *  Miért kell: ha a token lejárt és a frissítése épp nem sikerül (a háttérből visszatérő telefon, gyenge
 *  térerő), a supabase-js a kérést a NYILVÁNOS kulccsal küldi ki — a szerver ilyenkor névtelen („anon”)
 *  kérésként kezeli, és „permission denied” / „row-level security” hibát ad. Ez nem valódi elutasítás:
 *  a hívó ilyenkor várjon (kezelje úgy, mintha nem lenne kapcsolat), ne tekintse a szerver döntésének. */
export async function ensureFreshSession() {
  const got = await supabase.auth.getSession().catch(() => null);
  const session = got?.data?.session ?? null;
  if (!session) return null;
  const expMs = (session.expires_at ?? 0) * 1000;
  if (expMs >= Date.now() + 90_000) return session;
  const r = await supabase.auth.refreshSession().catch(() => null);
  if (r?.data?.session) return r.data.session;
  // a frissítés nem sikerült: a régi token csak akkor jó, ha még nem járt le
  return expMs > Date.now() + 5_000 ? session : null;
}
