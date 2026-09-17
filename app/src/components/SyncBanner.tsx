// Szinkron-állapot sáv: függő és elutasított műveletek — a fő felhasználó
// kezdőlapján és a munkavállalói kezdőlapon is, hogy a csendben visszagörgetett
// (szerver által elutasított) rögzítés ne maradjon észrevétlen.

import React from 'react';
import { View } from 'react-native';
import { Card, Sub, Btn } from '../ui/kit';
import { C, S } from '../ui/theme';
import { useSyncStatus } from '../lib/hooks';
import { store } from '../lib/store';
import { syncNow } from '../lib/sync';
import { confirmDialog } from '../lib/dialogs';

export function SyncBanner() {
  const sync = useSyncStatus();
  return (
    <>
      {sync.pendingOps > 0 ? (
        <Card style={{ backgroundColor: C.warnBg, borderColor: C.accent }}>
          <Sub style={{ color: C.warning }}>
            ⏳ {sync.pendingOps} művelet vár szinkronizálásra{sync.lastError ? ` — ${sync.lastError}` : ''}
          </Sub>
        </Card>
      ) : null}
      {sync.failedOps > 0 ? (
        <Card style={{ backgroundColor: C.dangerBg, borderColor: C.danger }}>
          <Sub style={{ color: C.danger, fontWeight: '700' }}>
            ⛔ {sync.failedOps} műveletet elutasított a szerver — ezek nem kerültek mentésre.
          </Sub>
          {store.getFailed()[0]?.lastError ? (
            <Sub style={{ color: C.danger }}>{store.getFailed()[0].lastError}</Sub>
          ) : null}
          <View style={{ flexDirection: 'row', gap: S.sm }}>
            <View style={{ flex: 1 }}>
              <Btn title="Újrapróbálás" kind="secondary" small onPress={() => {
                store.getFailed().forEach((o) => store.retryFailed(o.opId));
                void syncNow();
              }} />
            </View>
            <View style={{ flex: 1 }}>
              <Btn title="Elvetés" kind="ghost" small onPress={() => {
                void confirmDialog('Elutasított műveletek elvetése',
                  'A sikertelen műveletek végleg törlődnek a sorból. A szerver állapota marad érvényben.',
                  'Elvetés', true).then((ok) => {
                  if (!ok) return;
                  store.getFailed().forEach((o) => store.discardFailed(o.opId));
                  void syncNow();
                });
              }} />
            </View>
          </View>
        </Card>
      ) : null}
    </>
  );
}
