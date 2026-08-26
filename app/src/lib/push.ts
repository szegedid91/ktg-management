// Expo push token regisztráció + a kiküldő függvény időnkénti meghívása.
// Megjegyzés: Expo Go-ban (Androidon) a távoli push nem támogatott —
// éles buildben (EAS) működik. A regisztráció hibája nem blokkoló.

import { Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { supabase } from './supabase';
import { getCurrentUserId, updateRow } from './repo';

export async function registerPushToken(): Promise<void> {
  try {
    if (Platform.OS === 'web' || !Device.isDevice) return;
    const { status: existing } = await Notifications.getPermissionsAsync();
    let status = existing;
    if (existing !== 'granted') {
      const res = await Notifications.requestPermissionsAsync();
      status = res.status;
    }
    if (status !== 'granted') return;

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Értesítések',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }

    const token = (await Notifications.getExpoPushTokenAsync()).data;
    const me = getCurrentUserId();
    if (token && me) {
      // közvetlen szerver-írás: bejelentkezéskor a lokális profiles-tükör
      // még üres lehet, az updateRow ilyenkor némán kilépne
      const { error } = await supabase.from('profiles').update({ push_token: token }).eq('id', me);
      if (error) updateRow('profiles', me, { push_token: token }); // offline: tükrön át, sync majd feltolja
    }
  } catch {
    // Expo Go / szimulátor — push nélkül megy tovább
  }
}

let lastDrain = 0;

/** A push-queue ürítése — sync után hívjuk, legfeljebb percenként */
export function drainPushQueue(): void {
  const now = Date.now();
  if (now - lastDrain < 60_000) return;
  lastDrain = now;
  supabase.functions.invoke('push-dispatch', { body: { job: 'drain' } }).catch(() => {});
}
