// Útvonaltervezés egy címhez: a telefon térkép-appja / böngészőben Google Maps.
import { Linking, Platform } from 'react-native';

export function directionsUrl(address: string): string {
  const q = encodeURIComponent(address.trim());
  if (Platform.OS === 'ios') return `maps://?daddr=${q}`;
  return `https://www.google.com/maps/dir/?api=1&destination=${q}`;
}

export async function openDirections(address: string | null | undefined): Promise<void> {
  if (!address?.trim()) return;
  const url = directionsUrl(address);
  try {
    if (Platform.OS === 'web' && typeof window !== 'undefined') window.open(url, '_blank', 'noopener');
    else await Linking.openURL(url);
  } catch { /* nincs térkép-app */ }
}
