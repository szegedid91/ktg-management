// Web Push (PWA) feliratkozás — csak weben. Natívon az Expo push megy
// (push.ts). A böngésző engedélykérése csak felhasználói gombnyomásra
// indulhat (subscribeWebPush); app-indításkor legfeljebb a már meglévő
// feliratkozást frissítjük a szerveren (refreshWebPush).
//
// iPhone-on a Web Push csak a főképernyőre tett (standalone) appban
// működik, iOS 16.4-től.

import { Platform } from 'react-native';
import { supabase } from './supabase';
import { getCurrentUserId } from './repo';

const SW_PATH = '/sw.js';
const VAPID_PUBLIC_KEY = process.env.EXPO_PUBLIC_VAPID_PUBLIC_KEY ?? '';

export type WebPushState = 'unsupported' | 'denied' | 'granted-subscribed' | 'granted-unsubscribed' | 'default';

function isWeb(): boolean {
  return Platform.OS === 'web' && typeof window !== 'undefined';
}

export function isWebPushSupported(): boolean {
  return isWeb()
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && 'Notification' in window
    && typeof Notification.requestPermission === 'function';
}

/** VAPID publikus kulcs (URL-safe base64) → Uint8Array, ahogy a
 *  pushManager.subscribe applicationServerKey-je várja */
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function getRegistration(): Promise<ServiceWorkerRegistration | undefined> {
  return navigator.serviceWorker.getRegistration('/');
}

async function getSubscription(): Promise<PushSubscription | null> {
  const reg = await getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}

/** A feliratkozás mentése (endpoint szerint upsert; a lejártnak jelöltet
 *  feltámasztja). Hiba esetén kivételt dob. */
async function saveSubscription(sub: PushSubscription): Promise<void> {
  const me = getCurrentUserId();
  if (!me) throw new Error('Nincs bejelentkezett felhasználó.');
  const json = sub.toJSON();
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!json.endpoint || !p256dh || !auth) throw new Error('A böngésző nem adott vissza teljes feliratkozást.');
  const { error } = await supabase.from('push_subscriptions').upsert({
    user_id: me,
    endpoint: json.endpoint,
    p256dh,
    auth,
    user_agent: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 300) : null,
    last_error: null,
    deleted_at: null,
  }, { onConflict: 'endpoint' });
  if (error) throw new Error(error.message);
}

export async function getWebPushState(): Promise<WebPushState> {
  if (!isWebPushSupported()) return 'unsupported';
  const perm = Notification.permission;
  if (perm === 'denied') return 'denied';
  if (perm === 'default') return 'default';
  try {
    return (await getSubscription()) ? 'granted-subscribed' : 'granted-unsubscribed';
  } catch {
    return 'granted-unsubscribed';
  }
}

/** Feliratkozás — CSAK felhasználói gombnyomásból hívható (a böngésző
 *  engedélykérő ablaka másképp nem jelenik meg). */
export async function subscribeWebPush(vapidPublicKey: string = VAPID_PUBLIC_KEY): Promise<WebPushState> {
  if (!isWebPushSupported()) return 'unsupported';
  if (!vapidPublicKey) throw new Error('Hiányzik a VAPID publikus kulcs (EXPO_PUBLIC_VAPID_PUBLIC_KEY).');

  const reg = await navigator.serviceWorker.register(SW_PATH, { scope: '/' });
  await navigator.serviceWorker.ready;

  const perm = await Notification.requestPermission();
  if (perm === 'denied') return 'denied';
  if (perm !== 'granted') return 'default';

  const key = urlBase64ToUint8Array(vapidPublicKey);
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  try {
    await saveSubscription(sub);
  } catch (e) {
    // az endpoint másik fiókhoz tartozhat (ugyanazon a böngészőn váltott
    // felhasználó): friss feliratkozás új endpointtal, azt mentjük
    await sub.unsubscribe().catch(() => {});
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    await saveSubscription(sub);
  }
  return 'granted-subscribed';
}

/** Leiratkozás: a böngészőben és a szerveren is */
export async function unsubscribeWebPush(): Promise<void> {
  if (!isWebPushSupported()) return;
  const sub = await getSubscription();
  if (!sub) return;
  const endpoint = sub.endpoint;
  await sub.unsubscribe().catch(() => {});
  await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint);
}

let refreshed = false;

/** App-indítás / bejelentkezés: ha az engedély már megvan és él a
 *  feliratkozás, újra felírjuk (az endpoint időnként cserélődik).
 *  Engedélyt nem kér. Egy betöltés alatt egyszer fut. */
export async function refreshWebPush(): Promise<void> {
  if (refreshed || !isWebPushSupported()) return;
  if (Notification.permission !== 'granted') return;
  refreshed = true;
  try {
    const sub = await getSubscription();
    if (sub) await saveSubscription(sub);
  } catch {
    // nem blokkoló — a beállítások oldalon újra be lehet kapcsolni
  }
}
