// Monogram-kör: profilkép híján a névből képzett betűjel (magyar kettős betűkkel: „Szegedi Martin” → SzM),
// a névből származtatott állandó színnel.

import React from 'react';
import { View, Text } from 'react-native';

const DIGRAPHS = ['dzs', 'cs', 'dz', 'gy', 'ly', 'ny', 'sz', 'ty', 'zs'];
const SKIP = new Set(['és', 'dr', 'dr.', 'ifj', 'ifj.', 'id', 'id.', 'jr', 'jr.']);
const PALETTE = ['#2B6CB0', '#2F855A', '#B7791F', '#6B46C1', '#C05621', '#2C7A7B', '#B83280', '#4A5568'];

/** Betűjel a névből: az első két (nem kötőszó) szó kezdőbetűje, kettős betűt egyben (Sz, Cs, Gy…). */
export function initials(name: string | null | undefined): string {
  const words = String(name ?? '').trim().split(/[\s\-–]+/).filter((w) => w && !SKIP.has(w.toLowerCase())).slice(0, 2);
  if (words.length === 0) return '?';
  return words.map((w) => {
    const lower = w.toLowerCase();
    const dg = DIGRAPHS.find((d) => lower.startsWith(d));
    const head = dg ?? w.slice(0, 1);
    return head.charAt(0).toUpperCase() + head.slice(1).toLowerCase();
  }).join('');
}

export function avatarColor(name: string | null | undefined): string {
  let h = 0;
  for (const ch of String(name ?? '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export function Avatar({ name, size = 22 }: { name: string | null | undefined; size?: number }) {
  const text = initials(name);
  return (
    <View accessibilityLabel={name ?? undefined} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: avatarColor(name), alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: '#fff' }}>
      <Text style={{ color: '#fff', fontSize: text.length > 2 ? size * 0.36 : size * 0.42, fontWeight: '800' }}>{text}</Text>
    </View>
  );
}
