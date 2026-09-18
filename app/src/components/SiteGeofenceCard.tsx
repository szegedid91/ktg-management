// Bejelentkezési terület beállítása egy építkezéshez (vezetőknek): a hely
// koordinátája (cím alapján vagy a jelenlegi helyzetből) és a sugár. A
// munkavállalói app ezen belül ajánlja fel a bejelentkezést.

import React, { useState } from 'react';
import { View, Text } from 'react-native';
import { Card, Sub, Btn, Input } from '../ui/kit';
import { C, S } from '../ui/theme';
import { updateRow } from '../lib/repo';
import { useIsWorker } from '../lib/hooks';
import { notify, confirmDialog } from '../lib/dialogs';
import { geocodeAddress, getPosition } from '../lib/geo';
import { Site } from '../lib/types';

export function SiteGeofenceCard({ site }: { site: Site }) {
  const isWorker = useIsWorker();
  const [busy, setBusy] = useState<'addr' | 'here' | null>(null);
  const [radius, setRadius] = useState<string | null>(null);
  if (isWorker || site.status !== 'active') return null;
  const hasLoc = site.lat != null && site.lng != null;

  const fromAddress = async () => {
    if (!site.address) return;
    setBusy('addr');
    try {
      const hit = await geocodeAddress(site.address);
      if (!hit) { notify('Nem találtam a címet', 'Pontosítsd a címet, vagy állítsd be a helyszínen állva a „Jelenlegi helyzetemből” gombbal.'); return; }
      if (!await confirmDialog('Hely beállítása', `Találat: ${hit.label}\n\nEzt állítsam be a terület helyének?`, 'Beállítom')) return;
      updateRow('sites', site.id, { lat: hit.lat, lng: hit.lng });
    } finally { setBusy(null); }
  };
  const fromHere = async () => {
    setBusy('here');
    try {
      const pos = await getPosition();
      if (!pos) { notify('Nincs helyadat', 'Engedélyezd a helymeghatározást a böngészőben, és próbáld újra.'); return; }
      updateRow('sites', site.id, { lat: pos.lat, lng: pos.lng });
      notify('Hely beállítva 📍', `A terület helye a mostani pozíciód (pontosság kb. ${Math.round(pos.accuracy)} m).`);
    } finally { setBusy(null); }
  };
  const saveRadius = () => {
    const n = Math.round(Number(String(radius ?? '').replace(/\s/g, '')));
    if (!isFinite(n) || n < 30 || n > 5000) { notify('Hiba', 'A sugár 30 és 5000 méter között lehet.'); return; }
    updateRow('sites', site.id, { geofence_radius_m: n });
    setRadius(null);
  };

  return (
    <Card style={{ gap: S.sm }}>
      <Text style={{ fontWeight: '800', fontSize: 15, color: C.text }}>📍 Bejelentkezési terület</Text>
      <Sub>{hasLoc
        ? `Beállítva · sugár ${site.geofence_radius_m ?? 150} m. A munkavállaló appja jelzi, ha a területen van, és felajánlja a bejelentkezést.`
        : 'Nincs beállítva. Add meg a terület helyét, és a munkavállaló appja jelzi, ha megérkezett.'}</Sub>
      <View style={{ flexDirection: 'row', gap: S.sm, flexWrap: 'wrap' }}>
        {site.address ? <Btn title={busy === 'addr' ? 'Keresés…' : 'Cím alapján'} kind="secondary" small disabled={busy !== null} onPress={() => void fromAddress()} /> : null}
        <Btn title={busy === 'here' ? 'Helymeghatározás…' : 'Jelenlegi helyzetemből'} kind="secondary" small disabled={busy !== null} onPress={() => void fromHere()} />
        {hasLoc ? <Btn title="Törlés" kind="ghost" small onPress={() => updateRow('sites', site.id, { lat: null, lng: null })} /> : null}
      </View>
      {hasLoc ? (
        radius === null ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Sub>Sugár: <Text style={{ fontWeight: '700', color: C.text }}>{site.geofence_radius_m ?? 150} m</Text></Sub>
            <Btn title="Módosít" kind="ghost" small onPress={() => setRadius(String(site.geofence_radius_m ?? 150))} />
          </View>
        ) : (
          <View style={{ flexDirection: 'row', gap: S.sm, alignItems: 'flex-end' }}>
            <View style={{ flex: 1 }}><Input label="Sugár (méter, 30–5000)" value={radius} onChangeText={setRadius} keyboardType="numeric" /></View>
            <Btn title="Mentés" small onPress={saveRadius} />
          </View>
        )
      ) : null}
    </Card>
  );
}
