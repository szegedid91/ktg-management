// Egy koppintásos értesítés-bekapcsoló kártya a kezdőlapokon. A push csak
// akkor működik, ha a felhasználó a böngészőben engedélyezte és feliratkozott;
// ezt a beállítások mélyén kevesen találják meg. Amíg nincs bekapcsolva,
// itt egy nagy gomb kínálja fel (3 napig elhalasztható). iPhone-on a
// főképernyőre tett appból lehet csak bekapcsolni — erre is itt hívjuk fel a
// figyelmet.

import React, { useEffect, useState } from 'react';
import { Platform, View, Text } from 'react-native';
import { Card, Btn, Sub } from '../ui/kit';
import { C, S } from '../ui/theme';
import { notify } from '../lib/dialogs';
import { getWebPushState, subscribeWebPush, WebPushState } from '../lib/webpush';
import { getCurrentUserId } from '../lib/repo';

const SNOOZE_MS = 3 * 864e5;
const isIOS = Platform.OS === 'web' && typeof navigator !== 'undefined' && /iPhone|iPad|iPod/.test(navigator.userAgent);
const isStandalone = Platform.OS === 'web' && typeof window !== 'undefined'
  && (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as any).standalone === true);

function snoozeKey() { return `ktg:pushprompt:${getCurrentUserId() ?? 'anon'}`; }
function snoozed(): boolean {
  try { const v = localStorage.getItem(snoozeKey()); return !!v && Date.now() - Number(v) < SNOOZE_MS; } catch { return false; }
}

export function PushPrompt() {
  const [state, setState] = useState<WebPushState | null>(null);
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    if (snoozed()) { setHidden(true); return; }
    getWebPushState().then(setState).catch(() => setState('unsupported'));
  }, []);

  if (Platform.OS !== 'web' || hidden || state === null) return null;
  const needsInstall = isIOS && !isStandalone && state === 'unsupported';
  const canEnable = state === 'default' || state === 'granted-unsubscribed';
  if (!needsInstall && !canEnable) return null;

  const later = () => { try { localStorage.setItem(snoozeKey(), String(Date.now())); } catch { /* privát mód */ } setHidden(true); };
  const enable = async () => {
    setBusy(true);
    try {
      const r = await subscribeWebPush();
      setState(r);
      if (r === 'granted-subscribed') { notify('Bekapcsolva 🔔', 'Mostantól értesítést kapsz ezen a telefonon.'); setHidden(true); }
      else if (r === 'denied') notify('Nem engedélyezted', 'A böngésző beállításaiban (lakat ikon a címsorban) később engedélyezheted.');
    } catch (e: any) {
      notify('Hiba', String(e?.message ?? e));
    } finally { setBusy(false); }
  };

  return (
    <Card style={{ borderColor: C.primary, gap: S.sm }}>
      <Text style={{ fontWeight: '800', fontSize: 16, color: C.text }}>🔔 Értesítések</Text>
      {needsInstall ? (
        <>
          <Sub>Hogy értesítést kapj az új feladatokról, tedd az appot a főképernyőre: Megosztás ikon → „Főképernyőhöz adás”, majd onnan indítsd el, és kapcsold be itt az értesítéseket.</Sub>
          <Btn title="Értem, később" kind="ghost" small onPress={later} />
        </>
      ) : (
        <>
          <Sub>Kapj azonnal értesítést az új feladatokról és üzenetekről ezen a telefonon.</Sub>
          <Btn title={busy ? '…' : '🔔 Értesítések bekapcsolása'} disabled={busy} onPress={() => void enable()} />
          <View style={{ alignItems: 'center' }}><Btn title="Most nem" kind="ghost" small onPress={later} /></View>
        </>
      )}
    </Card>
  );
}
