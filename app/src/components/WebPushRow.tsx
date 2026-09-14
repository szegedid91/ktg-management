// „Push-értesítések ezen az eszközön” sor — Web Push be-/kikapcsolása
// (PWA). Csak weben jelenik meg; natívon az Expo push automatikus.

import React, { useEffect, useState } from 'react';
import { Platform, View } from 'react-native';
import { Btn, Sub, Body } from '../ui/kit';
import { C, S } from '../ui/theme';
import { notify } from '../lib/dialogs';
import { getWebPushState, subscribeWebPush, unsubscribeWebPush, WebPushState } from '../lib/webpush';

const isIOS = Platform.OS === 'web' && typeof navigator !== 'undefined' && /iPhone|iPad|iPod/.test(navigator.userAgent);
const isStandalone = Platform.OS === 'web' && typeof window !== 'undefined'
  && (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as any).standalone === true);

function statusText(s: WebPushState): string {
  switch (s) {
    case 'unsupported': return isIOS && !isStandalone
      ? 'iPhone-on előbb tedd az appot a főképernyőre (Megosztás → Főképernyőhöz adás), majd onnan indítva kapcsold be.'
      : 'Ez a böngésző nem támogatja a push-értesítéseket.';
    case 'denied': return 'Letiltva a böngészőben — a címsor melletti lakat/beállítások alatt engedélyezhető újra.';
    case 'granted-subscribed': return 'Bekapcsolva ezen az eszközön.';
    case 'granted-unsubscribed': return 'Engedélyezve, de nincs feliratkozás — kapcsold be.';
    default: return 'Kikapcsolva.';
  }
}

export function WebPushRow() {
  const [state, setState] = useState<WebPushState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    getWebPushState().then(setState).catch(() => setState('unsupported'));
  }, []);

  if (Platform.OS !== 'web' || state === null) return null;

  const on = state === 'granted-subscribed';
  const canToggle = state !== 'unsupported' && state !== 'denied';

  const toggle = async () => {
    setBusy(true);
    try {
      if (on) {
        await unsubscribeWebPush();
        setState(await getWebPushState());
      } else {
        const r = await subscribeWebPush();
        setState(r);
        if (r === 'granted-subscribed') notify('Bekapcsolva 🔔', 'Ezen az eszközön mostantól push-értesítést kapsz.');
        else if (r === 'denied') notify('Letiltva', 'A böngésző elutasította az értesítéseket.');
      }
    } catch (e: any) {
      notify('Hiba', String(e?.message ?? e));
      setState(await getWebPushState().catch(() => 'unsupported' as WebPushState));
    } finally { setBusy(false); }
  };

  return (
    <View style={{ gap: S.xs }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: S.sm }}>
        <Body style={{ fontWeight: '600', flex: 1 }}>🔔 Push-értesítések ezen az eszközön</Body>
        {canToggle ? (
          <Btn title={busy ? '…' : on ? 'Kikapcsolás' : 'Bekapcsolás'} kind={on ? 'ghost' : 'primary'} small
            onPress={() => void toggle()} disabled={busy} />
        ) : null}
      </View>
      <Sub style={state === 'denied' ? { color: C.warning } : undefined}>{statusText(state)}</Sub>
      {state !== 'unsupported' && isIOS ? (
        <Sub>iPhone-on csak a főképernyőre tett appban működik (Megosztás → Főképernyőhöz adás).</Sub>
      ) : null}
    </View>
  );
}
