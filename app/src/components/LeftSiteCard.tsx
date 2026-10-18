// „Úgy látjuk, nem vagy a munkaterületen” kártya a munkavállalói kezdőlapon: ha a helyi mérés (vagy a szerver
// jelzése) szerint a futó munkaidő helyszínének sugarán kívül van, egy koppintással lezárhatja a munkaidőt.
// „Itt vagyok” → 15 percig nem kérdezünk újra.

import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { Card, Sub, Btn } from '../ui/kit';
import { C, S } from '../ui/theme';
import type { Site, WorkSession } from '../lib/types';
import type { TrackState } from '../lib/tracker';

const SNOOZE_MS = 15 * 60_000;

export function LeftSiteCard({ track, openSession, sites, onStop }: {
  track: TrackState; openSession: WorkSession | undefined; sites: Site[]; onStop: () => void;
}) {
  const [snoozedAt, setSnoozedAt] = useState(0);
  if (!openSession) return null;
  // a helyi mérés az elsődleges; ha az app most nyílt és még nincs mérés, a szerver jelzése számít
  const left = track ? track.inside === false : !!openSession.left_site_at;
  if (!left) return null;
  if (snoozedAt && Date.now() - snoozedAt < SNOOZE_MS) return null;
  const site = track?.site ?? sites.find((s) => s.id === openSession.site_id) ?? null;
  const distance = track?.distance ?? openSession.last_distance_m ?? null;
  return (
    <Card style={{ borderColor: C.warning, borderWidth: 2, gap: S.sm }}>
      <Text style={{ fontWeight: '800', fontSize: 17, color: C.text }}>🚶 Úgy látjuk, nem vagy a munkaterületen</Text>
      <Sub>{site?.name ?? 'Munkaterület'}{distance != null ? ` · kb. ${distance} m-re vagy tőle` : ''}. A munkaidőd még fut — ha elmentél, zárd le.</Sub>
      <Btn title="⏹ Munkaidő lezárása" kind="danger" onPress={onStop} />
      <View style={{ alignItems: 'center' }}><Btn title="Itt vagyok, folytatom" kind="ghost" small onPress={() => setSnoozedAt(Date.now())} /></View>
    </Card>
  );
}
