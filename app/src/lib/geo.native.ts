// Helymeghatározás natív appban (iOS / Android) — expo-location. Ugyanazt a felületet adja,
// mint a webes geo.ts; a Metro natív buildnél ezt a fájlt választja.

import * as Location from 'expo-location';

export type GeoPermission = 'granted' | 'prompt' | 'denied' | 'unsupported';
export type GeoPoint = { lat: number; lng: number; accuracy: number };

export function geoSupported(): boolean { return true; }

export async function geoPermission(): Promise<GeoPermission> {
  try {
    const p = await Location.getForegroundPermissionsAsync();
    if (p.granted) return 'granted';
    return p.canAskAgain ? 'prompt' : 'denied';
  } catch { return 'unsupported'; }
}

/** Aktuális helyzet; hiba / elutasítás esetén null. Az első hívás kéri el az engedélyt. */
export async function getPosition(timeoutMs = 12000): Promise<GeoPoint | null> {
  try {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (!perm.granted) return null;
    const pos = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
      new Promise<null>((r) => setTimeout(() => r(null), timeoutMs)),
    ]);
    if (!pos) {
      const last = await Location.getLastKnownPositionAsync({ maxAge: 120_000 });
      return last ? { lat: last.coords.latitude, lng: last.coords.longitude, accuracy: last.coords.accuracy ?? 0 } : null;
    }
    return { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy ?? 0 };
  } catch { return null; }
}

/** Két pont távolsága méterben (haversine). */
export function distanceM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Cím → koordináta az OpenStreetMap (Nominatim) keresőjével. Csak a cím megy ki. */
export async function geocodeAddress(address: string): Promise<{ lat: number; lng: number; label: string } | null> {
  const q = address.trim();
  if (!q) return null;
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=hu&q=${encodeURIComponent(q)}`, {
      headers: { Accept: 'application/json', 'User-Agent': 'ktg-management-app' },
    });
    if (!res.ok) return null;
    const list = await res.json();
    const hit = Array.isArray(list) ? list[0] : null;
    if (!hit) return null;
    const lat = Number(hit.lat); const lng = Number(hit.lon);
    if (!isFinite(lat) || !isFinite(lng)) return null;
    return { lat, lng, label: String(hit.display_name ?? '') };
  } catch { return null; }
}
