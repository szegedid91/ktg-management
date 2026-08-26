import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { Screen, Card, H2, Sub, Body, Btn, Input, Picker, Empty, Badge } from '../ui/kit';
import { C, S } from '../ui/theme';
import { useTable } from '../lib/hooks';
import { insertRow, softDeleteRow, getCurrentUserId } from '../lib/repo';
import { hdt } from '../lib/format';
import { Equipment, EquipmentMove, Site, Profile } from '../lib/types';
import { Comments } from '../components/Comments';
import { confirmDialog } from '../lib/dialogs';

export default function EquipmentScreen() {
  const equipment = useTable<Equipment>('equipment');
  const moves = useTable<EquipmentMove>('equipment_moves');
  const sites = useTable<Site>('sites');
  const profiles = useTable<Profile>('profiles');

  const [newName, setNewName] = useState('');
  const [movingId, setMovingId] = useState<string | null>(null);
  const [targetSite, setTargetSite] = useState<string | null>(null);
  const [takenBy, setTakenBy] = useState('');
  const [openComments, setOpenComments] = useState<string | null>(null);

  const currentLocation = (eqId: string): { label: string; move?: EquipmentMove } => {
    const ms = moves.filter((m) => m.equipment_id === eqId).sort((a, b) => b.moved_at.localeCompare(a.moved_at));
    const last = ms[0];
    if (!last) return { label: 'Raktár / nálam' };
    if (last.site_id) return { label: sites.find((s) => s.id === last.site_id)?.name ?? '?', move: last };
    return { label: last.location_label || 'Raktár / nálam', move: last };
  };

  const doMove = (eqId: string) => {
    insertRow('equipment_moves', {
      equipment_id: eqId,
      site_id: targetSite,
      location_label: targetSite ? null : 'Raktár / nálam',
      taken_by: takenBy.trim() || (profiles.find((p) => p.id === getCurrentUserId())?.display_name ?? null),
      moved_at: new Date().toISOString(),
    });
    setMovingId(null);
    setTargetSite(null);
    setTakenBy('');
  };

  // csoportosítás helyszín szerint
  const grouped = useMemo(() => {
    const g = new Map<string, { eq: Equipment; loc: ReturnType<typeof currentLocation> }[]>();
    for (const e of equipment) {
      const loc = currentLocation(e.id);
      const arr = g.get(loc.label) ?? [];
      arr.push({ eq: e, loc });
      g.set(loc.label, arr);
    }
    return [...g.entries()].sort((a, b) => a[0].localeCompare(b[0], 'hu'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [equipment, moves, sites]);

  return (
    <Screen>
      <Card>
        <H2>Új eszköz</H2>
        <View style={{ flexDirection: 'row', gap: S.sm, alignItems: 'flex-end' }}>
          <View style={{ flex: 1 }}>
            <Input value={newName} onChangeText={setNewName} placeholder="pl. Hilti fúró" />
          </View>
          <Btn title="Felvesz" small onPress={() => {
            if (!newName.trim()) return;
            insertRow('equipment', { name: newName.trim() });
            setNewName('');
          }} />
        </View>
      </Card>

      {grouped.length === 0 ? <Empty text="Még nincs eszköz felvéve." /> : null}
      {grouped.map(([locLabel, items]) => (
        <Card key={locLabel}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm }}>
            <H2>📍 {locLabel}</H2>
            <Badge text={`${items.length} db`} />
          </View>
          {items.map(({ eq, loc }) => (
            <View key={eq.id} style={{ paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: C.border, gap: 4 }}>
              <Body style={{ fontWeight: '600' }}>{eq.name}</Body>
              {loc.move ? (
                <Sub>vitte: {loc.move.taken_by ?? '?'} · {hdt(loc.move.moved_at)}</Sub>
              ) : null}
              {movingId === eq.id ? (
                <View style={{ gap: S.sm }}>
                  <Picker
                    label="Hová?"
                    items={sites.filter((s) => s.status === 'active')}
                    selectedId={targetSite}
                    getId={(s) => s.id}
                    getLabel={(s) => s.name}
                    onSelect={setTargetSite}
                    allowNull
                    nullLabel="🏠 Raktár / nálam"
                  />
                  <Input label="Ki viszi?" value={takenBy} onChangeText={setTakenBy} placeholder="alapból: én" />
                  <View style={{ flexDirection: 'row', gap: S.sm }}>
                    <View style={{ flex: 1 }}><Btn title="Mégse" kind="ghost" small onPress={() => setMovingId(null)} /></View>
                    <View style={{ flex: 1 }}><Btn title="Áthelyez" small onPress={() => doMove(eq.id)} /></View>
                  </View>
                </View>
              ) : (
                <View style={{ flexDirection: 'row', gap: S.sm, flexWrap: 'wrap' }}>
                  <Btn title="Áthelyezés" kind="ghost" small onPress={() => { setMovingId(eq.id); setTargetSite(null); }} />
                  <Btn title="Kommentek" kind="ghost" small onPress={() => setOpenComments(openComments === eq.id ? null : eq.id)} />
                  {eq.created_by === getCurrentUserId() ? (
                    <Btn title="🗑️ Törlés" kind="ghost" small onPress={() => {
                      void confirmDialog('Eszköz törlése', `Biztosan törlöd? (${eq.name})`, 'Törlés', true).then((ok) => {
                        if (ok) softDeleteRow('equipment', eq.id);
                      });
                    }} />
                  ) : null}
                </View>
              )}
              {openComments === eq.id ? <Comments entityType="equipment" entityId={eq.id} /> : null}
            </View>
          ))}
        </Card>
      ))}
    </Screen>
  );
}
