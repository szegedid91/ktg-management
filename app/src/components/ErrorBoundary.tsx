// Globális hibafogó: ha egy oldal renderelés közben hibára fut, fehér lap
// helyett kiírjuk a hibát, és egy gombbal újratölthető az app. A hiba
// szövege a Beállításokban is visszanézhető (utolsó hiba).

import React from 'react';
import { View, Text, Pressable, Platform, ScrollView } from 'react-native';
import { APP_VERSION } from '../lib/version';
import { logError } from '../lib/errlog';

type State = { error: Error | null };

const KEY = 'ktg:last-crash';

export function rememberCrash(msg: string) {
  try { if (Platform.OS === 'web') localStorage.setItem(KEY, `${new Date().toISOString()} · ${APP_VERSION}\n${msg}`); } catch { /* nincs tároló */ }
}
/** Az utolsó hiba — csak ha a most futó verzióból származik; egy régebbi
 *  verzió hibáját frissítés után töröljük, hogy ne tűnjön élőnek. */
export function lastCrash(): string | null {
  try {
    if (Platform.OS !== 'web') return null;
    const v = localStorage.getItem(KEY);
    if (v && !v.includes(APP_VERSION)) { localStorage.removeItem(KEY); return null; }
    return v;
  } catch { return null; }
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null };
  static getDerivedStateFromError(error: Error): State { return { error }; }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    logError('crash', String(error?.message ?? error), { componentStack: (info?.componentStack ?? '').split('\n').slice(0, 8).join('\n'), stack: error?.stack?.split('\n').slice(0, 6).join('\n') });
    rememberCrash(`${error?.message ?? error}\n${(info?.componentStack ?? '').split('\n').slice(0, 6).join('\n')}`);
  }
  reload = () => {
    if (Platform.OS === 'web' && typeof location !== 'undefined') location.replace('/');
    else this.setState({ error: null });
  };
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <ScrollView contentContainerStyle={{ flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: '#F6F4EF' }}>
        <View style={{ maxWidth: 480, width: '100%', gap: 12, backgroundColor: '#fff', borderRadius: 16, borderWidth: 1, borderColor: '#E2DCD0', padding: 20 }}>
          <Text style={{ fontSize: 40, textAlign: 'center' }}>😵</Text>
          <Text style={{ fontSize: 18, fontWeight: '800', color: '#1F2937', textAlign: 'center' }}>Hiba történt az oldalon</Text>
          <Text style={{ color: '#6B7280', textAlign: 'center' }}>Az adataid biztonságban vannak. Töltsd újra az appot — ha újra előjön, küldd el ezt a szöveget:</Text>
          <Text selectable style={{ fontFamily: Platform.OS === 'web' ? 'monospace' : undefined, fontSize: 12, color: '#B91C1C', backgroundColor: '#FEF2F2', padding: 10, borderRadius: 8 }}>
            {String(this.state.error?.message ?? this.state.error)}{'\n'}{APP_VERSION}
          </Text>
          <Pressable onPress={this.reload} style={{ backgroundColor: '#B45309', borderRadius: 10, paddingVertical: 12, alignItems: 'center' }}>
            <Text style={{ color: '#fff', fontWeight: '700' }}>Újratöltés</Text>
          </Pressable>
        </View>
      </ScrollView>
    );
  }
}
