// Közös téma — építőipari, kontrasztos, terepen (napfényben) is olvasható

export const C = {
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
};

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
