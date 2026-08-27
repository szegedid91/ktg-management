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
