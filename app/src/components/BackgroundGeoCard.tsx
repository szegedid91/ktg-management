// Háttérbeli helyfigyelés (csak natív appban jelenik meg): engedélykérés egyszerű szöveggel,
// a figyelt területek frissítése, és a „távoztál, de fut a munkaidőd” eset kezelése.

import React, { useEffect, useState } from 'react';
import { AppState, Text } from 'react-native';
import { Card, Sub, Btn } from '../ui/kit';
import { C } from '../ui/theme';
import { Site, WorkSession } from '../lib/types';
import { updateRow } from '../lib/repo';
import { confirmDialog } from '../lib/dialogs';
import {
  backgroundGeoAvailable, backgroundGeoStatus, enableBackgroundGeo, syncGeofences,
  rememberOpenSession, takePendingExit,
} from '../lib/geofence';

const hm = (iso: string) => new Date(iso).toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' });

export function BackgroundGeoCard({ sites, openSession }: { sites: Site[]; openSession: WorkSession | undefined }) {
  const [status, setStatus] = useState<'unsupported' | 'off' | 'foreground-only' | 'on'>('unsupported');
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (backgroundGeoAvailable) void backgroundGeoStatus().then(setStatus); }, []);

  // a háttérfeladat innen tudja, hol fut most munkaidő
  useEffect(() => {
    if (!backgroundGeoAvailable) return;
    void rememberOpenSession(openSession ? { sessionId: openSession.id, siteId: openSession.site_id, startedAt: openSession.started_at } : null);
  }, [openSession?.id, openSession?.site_id]);

  // a figyelt területek kövessék a munkaterületek listáját
  const sitesKey = sites.map((s) => `${s.id}:${s.lat}:${s.lng}:${s.geofence_radius_m}:${s.status}`).join('|');
  useEffect(() => { if (backgroundGeoAvailable && status === 'on') void syncGeofences(sites); }, [sitesKey, status]);

  // app megnyitásakor: ha távozott egy területről, ahol még fut a munkaideje → lezárás a távozás idejére
  useEffect(() => {
    if (!backgroundGeoAvailable) return;
    const check = async () => {
      const exit = await takePendingExit();
      if (!exit || !openSession || openSession.site_id !== exit.siteId) return;
      if (new Date(exit.at).getTime() <= new Date(openSession.started_at).getTime()) return;
      const ok = await confirmDialog('Lezárjam a munkaidőt?',
        `${hm(exit.at)}-kor elhagytad ezt a területet: ${exit.siteName}\n\nA munkaidőd még fut. Lezárjam a távozásod időpontjával (${hm(exit.at)})?`,
        'Lezárom', false, 'Még dolgozom');
      if (ok) updateRow('work_sessions', openSession.id, { ended_at: exit.at });
    };
    void check();
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') void check(); });
    return () => sub.remove();
  }, [openSession?.id]);

  if (!backgroundGeoAvailable || status === 'on' || status === 'unsupported') return null;
  return (
    <Card style={{ borderColor: C.primary }}>
      <Text style={{ fontWeight: '800', fontSize: 15, color: C.text }}>📍 Szóljon a telefon, ha megérkeztél</Text>
      <Sub>Ha engedélyezed, a telefon jelez, amikor egy munkaterületre érsz (bejelentkezés), és akkor is, ha úgy mész el, hogy a munkaidőd még fut. Az útvonaladat nem rögzítjük — csak az érkezés és a távozás pillanatát figyeli.</Sub>
      <Sub style={{ fontWeight: '700' }}>A következő kérdésnél válaszd: „Mindig engedélyezem”.</Sub>
      <Btn title={busy ? '…' : 'Engedélyezem'} disabled={busy} onPress={() => {
        setBusy(true);
        void enableBackgroundGeo().then(async () => { setStatus(await backgroundGeoStatus()); setBusy(false); });
      }} />
    </Card>
  );
}
