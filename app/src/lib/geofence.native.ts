// Háttérbeli területfigyelés natív appban: az operációs rendszer figyeli a munkaterületek
// körét (geofence), és akkor is szól, ha az app be van zárva. Nem folyamatos nyomkövetés:
// a telefon csak a be- és kilépés pillanatát jelzi, a pontos útvonal sehová nem kerül.
//
//  * belépés  → értesítés: „Megérkeztél — bejelentkezel?”
//  * kilépés  → ha ott még fut a munkaidő: értesítés + a kilépés idejét megjegyezzük, hogy az
//               app megnyitásakor fel tudjuk ajánlani a lezárást a távozás időpontjára.
//
// A TaskManager.defineTask-nak a modul legfelső szintjén kell lennie — ezért a gyökér
// layout importálja ezt a fájlt.

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import type { Site } from './types';

export type OpenSessionInfo = { sessionId: string; siteId: string | null; startedAt: string } | null;
export type PendingExit = { siteId: string; siteName: string; at: string } | null;

const TASK = 'ktg-geofence';
const K_SITES = 'ktg:geofence-sites';     // { [siteId]: név } — a háttérfeladat innen tudja a nevet
const K_OPEN = 'ktg:open-session';        // a most futó munkamenet (az app írja)
const K_EXIT = 'ktg:pending-exit';        // legutóbbi távozás futó munkaidő mellett
const K_LAST = 'ktg:geofence-last';       // ismétlődő értesítés szűrése
const MAX_REGIONS = 20;                   // iOS korlát
const DEFAULT_RADIUS = 150;

export const backgroundGeoAvailable = true;

async function notifyLocal(title: string, body: string, data: Record<string, any>) {
  try {
    await Notifications.scheduleNotificationAsync({ content: { title, body, data, sound: true }, trigger: null });
  } catch { /* értesítés nélkül is megy tovább */ }
}

TaskManager.defineTask(TASK, async ({ data, error }: any) => {
  if (error || !data) return;
  try {
    const { eventType, region } = data as { eventType: Location.GeofencingEventType; region: Location.LocationRegion };
    const siteId = String(region?.identifier ?? '');
    if (!siteId) return;
    const names = JSON.parse((await AsyncStorage.getItem(K_SITES)) ?? '{}') as Record<string, string>;
    const name = names[siteId] ?? 'munkaterület';
    const open = JSON.parse((await AsyncStorage.getItem(K_OPEN)) ?? 'null') as OpenSessionInfo;
    // ugyanarról az eseményről 10 percen belül nem szólunk kétszer (a GPS a határon „pattoghat”)
    const last = JSON.parse((await AsyncStorage.getItem(K_LAST)) ?? '{}') as Record<string, number>;
    const key = `${siteId}:${eventType}`;
    if ((last[key] ?? 0) > Date.now() - 10 * 60_000) return;
    last[key] = Date.now();
    await AsyncStorage.setItem(K_LAST, JSON.stringify(last));

    if (eventType === Location.GeofencingEventType.Enter) {
      await AsyncStorage.removeItem(K_EXIT);
      if (open && open.siteId === siteId) return; // már be van jelentkezve ide
      await notifyLocal(`📍 Megérkeztél: ${name}`, open
        ? 'Máshol még fut a munkaidőd — koppints, és válts át erre a helyszínre.'
        : 'Koppints a bejelentkezéshez.', { kind: 'geofence-enter', siteId });
    } else if (eventType === Location.GeofencingEventType.Exit) {
      if (!open || open.siteId !== siteId) return; // nem fut itt munkaidő — nincs teendő
      const at = new Date().toISOString();
      await AsyncStorage.setItem(K_EXIT, JSON.stringify({ siteId, siteName: name, at }));
      await notifyLocal(`🚶 Elhagytad: ${name}`, 'A munkaidőd még fut. Koppints, és zárd le — a távozásod időpontjával.', { kind: 'geofence-exit', siteId, at });
    }
  } catch { /* a háttérfeladat sosem dobhat */ }
});

export async function backgroundGeoStatus(): Promise<'unsupported' | 'off' | 'foreground-only' | 'on'> {
  try {
    const fg = await Location.getForegroundPermissionsAsync();
    if (!fg.granted) return 'off';
    const bg = await Location.getBackgroundPermissionsAsync();
    return bg.granted ? 'on' : 'foreground-only';
  } catch { return 'unsupported'; }
}

/** Engedélykérés: előbb „használat közben”, utána „mindig” — a rendszer csak így engedi. */
export async function enableBackgroundGeo(): Promise<boolean> {
  try {
    const fg = await Location.requestForegroundPermissionsAsync();
    if (!fg.granted) return false;
    const bg = await Location.requestBackgroundPermissionsAsync();
    return bg.granted;
  } catch { return false; }
}

/** A figyelt területek frissítése: a koordinátával rendelkező aktív munkaterületek közül a
 *  hozzám legközelebbi 20 (iOS-korlát). Engedély nélkül nem csinál semmit. */
export async function syncGeofences(sites: Site[]): Promise<void> {
  try {
    if ((await backgroundGeoStatus()) !== 'on') return;
    let list = sites.filter((s) => !s.deleted_at && s.status === 'active' && s.lat != null && s.lng != null);
    if (list.length > MAX_REGIONS) {
      const here = await Location.getLastKnownPositionAsync({ maxAge: 30 * 60_000 }).catch(() => null);
      if (here) {
        const d = (s: Site) => (Number(s.lat) - here.coords.latitude) ** 2 + (Number(s.lng) - here.coords.longitude) ** 2;
        list = [...list].sort((a, b) => d(a) - d(b));
      }
      list = list.slice(0, MAX_REGIONS);
    }
    await AsyncStorage.setItem(K_SITES, JSON.stringify(Object.fromEntries(list.map((s) => [s.id, s.name]))));
    if (list.length === 0) { await stopGeofences(); return; }
    await Location.startGeofencingAsync(TASK, list.map((s) => ({
      identifier: s.id, latitude: Number(s.lat), longitude: Number(s.lng),
      radius: Math.max(100, Number(s.geofence_radius_m ?? DEFAULT_RADIUS)), // 100 m alatt a rendszer megbízhatatlan
      notifyOnEnter: true, notifyOnExit: true,
    })));
  } catch { /* engedély / szolgáltatás hiánya — csendben */ }
}

export async function stopGeofences(): Promise<void> {
  try { if (await Location.hasStartedGeofencingAsync(TASK)) await Location.stopGeofencingAsync(TASK); } catch { /* nem futott */ }
}

/** Az app jelzi a háttérfeladatnak, hol fut most munkaidő (null = sehol). */
export async function rememberOpenSession(s: OpenSessionInfo): Promise<void> {
  try { if (s) await AsyncStorage.setItem(K_OPEN, JSON.stringify(s)); else await AsyncStorage.removeItem(K_OPEN); } catch { /* nincs tároló */ }
}

/** A legutóbbi „elhagytad a területet” jelzés — egyszer olvasható ki (az app felajánlja a lezárást). */
export async function takePendingExit(): Promise<PendingExit> {
  try {
    const v = await AsyncStorage.getItem(K_EXIT);
    if (!v) return null;
    await AsyncStorage.removeItem(K_EXIT);
    return JSON.parse(v);
  } catch { return null; }
}
