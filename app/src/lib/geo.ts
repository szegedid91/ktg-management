// Helymeghatározás és terület-ellenőrzés (munkaterületre érkezés jelzése).
//
// Fontos korlát: webes (főképernyőre tett) appban a böngésző CSAK akkor ad
// helyzetet, amikor az app nyitva van és látszik — a háttérben, bezárt app
// mellett nincs helymeghatározás. Ezért az „érkezés” jelzése az app
// megnyitásakor / előtérbe kerülésekor és nyitott app mellett időnként fut.

export type GeoPermission = 'granted' | 'prompt' | 'denied' | 'unsupported';
export type GeoPoint = { lat: number; lng: number; accuracy: number };

export function geoSupported(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.geolocation;
}

export async function geoPermission(): Promise<GeoPermission> {
  if (!geoSupported()) return 'unsupported';
  try {
    const p = await (navigator as any).permissions?.query({ name: 'geolocation' });
    if (p?.state === 'granted' || p?.state === 'denied' || p?.state === 'prompt') return p.state;
  } catch { /* régebbi Safari: nincs permissions API */ }
  return 'prompt';
}

/** Aktuális helyzet; hiba / elutasítás esetén null. Az első hívás kéri el az engedélyt. */
export function getPosition(timeoutMs = 12000): Promise<GeoPoint | null> {
  if (!geoSupported()) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy ?? 0 }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60_000 },
    );
  });
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
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const list = await res.json();
    const hit = Array.isArray(list) ? list[0] : null;
    if (!hit) return null;
    const lat = Number(hit.lat); const lng = Number(hit.lon);
    if (!isFinite(lat) || !isFinite(lng)) return null;
    return { lat, lng, label: String(hit.display_name ?? '') };
  } catch {
    return null;
  }
}
