// Útvonaltervezés egy címhez: a telefon térkép-appja / böngészőben Google Maps.
//
// Főképernyőre tett (standalone) webappból egy https-térképlink új lapja
// Androidon Chrome-lapként nyílik meg, és miután a Térkép app átveszi,
// egy üres fehér lap marad, ahova a felhasználó „visszalép”. Ezért
// telefonon a rendszer térkép-sémáját hívjuk meg helyben (geo: / maps:):
// ezt a böngésző külső appnak adja át, a jelenlegi oldal nem töltődik újra.
import { Linking, Platform } from 'react-native';

function ua(): string {
  return typeof navigator !== 'undefined' ? navigator.userAgent : '';
}
const isAndroidWeb = () => /Android/i.test(ua());
const isIOSWeb = () => /iPhone|iPad|iPod/i.test(ua()) || (/Macintosh/i.test(ua()) && typeof navigator !== 'undefined' && (navigator as any).maxTouchPoints > 1);

export function directionsUrl(address: string): string {
  const q = encodeURIComponent(address.trim());
  if (Platform.OS === 'ios' || (Platform.OS === 'web' && isIOSWeb())) return `maps://?daddr=${q}`;
  if (Platform.OS === 'android' || (Platform.OS === 'web' && isAndroidWeb())) return `geo:0,0?q=${q}`;
  return `https://www.google.com/maps/dir/?api=1&destination=${q}`;
}

export async function openDirections(address: string | null | undefined): Promise<void> {
  if (!address?.trim()) return;
  const url = directionsUrl(address);
  try {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      // egyedi séma (geo:, maps:): helyben, új lap nélkül; https: új lapon
      if (/^https?:/i.test(url)) window.open(url, '_blank', 'noopener');
      else window.location.href = url;
    } else {
      await Linking.openURL(url);
    }
  } catch { /* nincs térkép-app */ }
}
