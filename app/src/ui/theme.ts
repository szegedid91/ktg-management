// Közös téma — építőipari, kontrasztos, terepen (napfényben) is olvasható.
// Világos + esti (sötét) mód: a C objektum tartalma cserélődik, a gyökér
// layout témaváltáskor újrarendereli a teljes fát.

import AsyncStorage from '@react-native-async-storage/async-storage';

const LIGHT = {
  bg: '#F5F3EF',
  card: '#FFFFFF',
  text: '#1A1D21',
  sub: '#6B7076',
  border: '#E3DFD8',
  primary: '#1F4E5F',      // mélykék-zöld
  primaryText: '#FFFFFF',
  accent: '#F5A623',       // építőipari sárga
  accentDark: '#B97B0A',
  danger: '#C0392B',
  success: '#2E7D32',
  warning: '#B26A00',
  chipBg: '#EDE9E2',
  inputBg: '#FBFAF8',
  warnBg: '#FFF7E0',
  dangerBg: '#FDECEA',
};

const DARK: typeof LIGHT = {
  bg: '#14171A',
  card: '#1D2227',
  text: '#E9EBED',
  sub: '#9AA3AB',
  border: '#2C3238',
  primary: '#2C6E84',      // világosabb kék-zöld, sötét háttéren is él
  primaryText: '#FFFFFF',
  accent: '#F5A623',
  accentDark: '#D08E1B',
  danger: '#E57373',
  success: '#66BB6A',
  warning: '#FFB74D',
  chipBg: '#2A3036',
  inputBg: '#22272C',
  warnBg: '#3A2F14',
  dangerBg: '#3B2320',
};

export const C = { ...LIGHT };

export type ThemeMode = 'light' | 'dark';
let themeMode: ThemeMode = 'light';
const themeListeners = new Set<(m: ThemeMode) => void>();

export function getThemeMode(): ThemeMode {
  return themeMode;
}

export function setThemeMode(m: ThemeMode) {
  themeMode = m;
  Object.assign(C, m === 'dark' ? DARK : LIGHT);
  // az F stílusok modul-betöltéskor másolják a színt — frissítjük őket is
  F.title.color = C.text;
  F.h2.color = C.text;
  F.body.color = C.text;
  F.sub.color = C.sub;
  F.money.color = C.text;
  AsyncStorage.setItem('ktg:theme', m).catch(() => {});
  themeListeners.forEach((l) => l(m));
}

export function subscribeTheme(l: (m: ThemeMode) => void): () => void {
  themeListeners.add(l);
  return () => { themeListeners.delete(l); };
}

/** Mentett téma betöltése app-induláskor */
export async function loadThemeMode(): Promise<void> {
  try {
    const v = await AsyncStorage.getItem('ktg:theme');
    if (v === 'dark') setThemeMode('dark');
  } catch {
    // marad a világos
  }
}

export const S = {
  xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32,
  radius: 12, radiusSm: 8,
};

export const F = {
  title: { fontSize: 22, fontWeight: '700' as const, color: C.text },
  h2: { fontSize: 17, fontWeight: '700' as const, color: C.text },
  body: { fontSize: 15, color: C.text },
  sub: { fontSize: 13, color: C.sub },
  money: { fontSize: 15, fontWeight: '700' as const, color: C.text, fontVariant: ['tabular-nums'] as any },
};
