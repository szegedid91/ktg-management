import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Platform } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import QRCode from 'react-native-qrcode-svg';
import { Screen, Card, H2, Sub, Body, Btn, Input, Picker, Empty, Badge } from '../ui/kit';
import { removeStoragePaths } from '../lib/photo';
import { C, S } from '../ui/theme';
import { useTable } from '../lib/hooks';
import { insertRow, softDeleteRow, getCurrentUserId } from '../lib/repo';
import { hdt } from '../lib/format';
import { Equipment, EquipmentMove, Site, Profile } from '../lib/types';
import { Comments } from '../components/Comments';
import { QrScanner } from '../components/QrScanner';
import { confirmDialog, notify } from '../lib/dialogs';
import { equipmentQrUrl, parseEquipmentCode, printEquipmentLabels } from '../lib/qr';

export default function EquipmentScreen() {
  const equipment = useTable<Equipment>('equipment');
  const moves = useTable<EquipmentMove>('equipment_moves');
  const sites = useTable<Site>('sites');
  const profiles = useTable<Profile>('profiles');
  // ?eq=<id>: QR-kódról (telefon kamerája) érkezve az eszköz áthelyezés-űrlapja nyílik
  const { eq: eqParam } = useLocalSearchParams<{ eq?: string | string[] }>();

  const [newName, setNewName] = useState('');
  const [movingId, setMovingId] = useState<string | null>(null);
  const [targetSite, setTargetSite] = useState<string | null>(null);
  const [takenBy, setTakenBy] = useState('');
  const [openComments, setOpenComments] = useState<string | null>(null);
  const [qrOpenId, setQrOpenId] = useState<string | null>(null);
  const [scanOpen, setScanOpen] = useState(false);
  // beolvasással/linkkel kiválasztott eszköz: a lista tetején, nyitott űrlappal
  const [focusId, setFocusId] = useState<string | null>(null);
  const handledParam = useRef<string | null>(null);

  const me = profiles.find((p) => p.id === getCurrentUserId());
  const isWorker = !!me?.worker_id;

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
    setFocusId(null);
    setTargetSite(null);
    setTakenBy('');
  };

  const cancelMove = () => {
    setMovingId(null);
    setFocusId(null);
  };

  /** beolvasás = mozgatás rögzítése: az eszköz űrlapja nyílik a lista tetején */
  const startMove = (eqId: string) => {
    setScanOpen(false);
    setFocusId(eqId);
    setMovingId(eqId);
    setTargetSite(null);
    setTakenBy('');
  };

  useEffect(() => {
    const raw = Array.isArray(eqParam) ? eqParam[0] : eqParam;
    const id = raw ? parseEquipmentCode(raw) : null;
    if (!id || handledParam.current === id) return;
    if (!equipment.some((e) => e.id === id)) return; // még nincs a helyi tükörben — megvárjuk a szinkront
    handledParam.current = id;
    startMove(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eqParam, equipment]);

  const onScanned = (text: string) => {
    const id = parseEquipmentCode(text);
    const eq = id ? equipment.find((e) => e.id === id) : undefined;
    if (!eq) {
      notify('Ismeretlen kód', id ? 'Ehhez a kódhoz nem tartozik eszköz (lehet, hogy törölték).' : 'Ez nem eszköz-QR-kód.');
      setScanOpen(false);
      return;
    }
    startMove(eq.id);
  };

  const onManual = (text: string) => {
    const id = parseEquipmentCode(text);
    let eq = id ? equipment.find((e) => e.id === id) : undefined;
    if (!eq) {
      const q = text.trim().toLowerCase();
      const exact = equipment.filter((e) => e.name.toLowerCase() === q);
      const partial = equipment.filter((e) => e.name.toLowerCase().includes(q));
      eq = exact[0] ?? (partial.length === 1 ? partial[0] : undefined);
      if (!eq && partial.length > 1) {
        notify('Több találat', `${partial.length} eszköz neve illik rá — adj meg pontosabb nevet.`);
        return;
      }
    }
    if (!eq) { notify('Nem található', `Nincs ilyen eszköz: ${text.trim()}`); return; }
    startMove(eq.id);
  };

  const printLabels = (items: Equipment[]) => {
    void printEquipmentLabels(items.map((e) => ({ id: e.id, name: e.name }))).then((r) => {
      if (r === 'unsupported') notify('Nyomtatás', 'A címkenyomtatás a webes változatban érhető el (ktg.szakify.hu).');
      else if (r === 'blocked') notify('Felugró ablak blokkolva', 'Engedélyezd a felugró ablakokat ehhez az oldalhoz, majd próbáld újra.');
    });
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

  // Munkavállalói fiók: az eszközök a vezetők (partnerek) területe.
  if (isWorker) {
    return (
      <Screen>
        <Card>
          <H2>Eszközök</H2>
          <Sub>Nincs jogosultságod ehhez a részhez.</Sub>
        </Card>
      </Screen>
    );
  }

  const moveForm = (eq: Equipment) => (
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
        <View style={{ flex: 1 }}><Btn title="Mégse" kind="ghost" small onPress={cancelMove} /></View>
        <View style={{ flex: 1 }}><Btn title="Áthelyez" small onPress={() => doMove(eq.id)} /></View>
      </View>
    </View>
  );

  const qrCard = (eq: Equipment) => (
    <View style={{ alignItems: 'center', gap: S.sm, paddingVertical: S.sm }}>
      <View style={{ backgroundColor: '#fff', padding: S.md, borderRadius: S.radiusSm }}>
        <QRCode value={equipmentQrUrl(eq.id)} size={160} />
      </View>
      <Body style={{ fontWeight: '700' }}>{eq.name}</Body>
      {Platform.OS !== 'web' ? <Sub>A címke nyomtatása a webes változatban érhető el.</Sub> : null}
      <View style={{ flexDirection: 'row', gap: S.sm }}>
        <Btn title="🖨️ Nyomtatás" kind="secondary" small onPress={() => printLabels([eq])} />
        <Btn title="Bezár" kind="ghost" small onPress={() => setQrOpenId(null)} />
      </View>
    </View>
  );

  const focused = focusId ? equipment.find((e) => e.id === focusId) : undefined;

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

      <Card>
        <View style={{ flexDirection: 'row', gap: S.sm, flexWrap: 'wrap' }}>
          <Btn title={scanOpen ? 'Beolvasás bezárása' : '📷 QR beolvasás'} kind="secondary" small onPress={() => setScanOpen((v) => !v)} />
          <Btn title="🖨️ Mind nyomtatása" kind="ghost" small disabled={equipment.length === 0} onPress={() => printLabels(equipment)} />
        </View>
        <Sub>Beolvasás = mozgatás rögzítése: a QR-kód után csak a célhelyszínt kell megadni.</Sub>
        {scanOpen ? <QrScanner onCode={onScanned} onManual={onManual} onClose={() => setScanOpen(false)} /> : null}
      </Card>

      {focused && movingId === focused.id ? (
        <Card style={{ borderColor: C.primary }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm }}>
            <H2>📷 {focused.name}</H2>
            <Badge text="beolvasva" />
          </View>
          <Sub>Jelenleg: {currentLocation(focused.id).label}</Sub>
          {moveForm(focused)}
        </Card>
      ) : null}

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
              {movingId === eq.id && focusId !== eq.id ? moveForm(eq) : (
                <View style={{ flexDirection: 'row', gap: S.sm, flexWrap: 'wrap' }}>
                  <Btn title="Áthelyezés" kind="ghost" small onPress={() => { setFocusId(null); setMovingId(eq.id); setTargetSite(null); }} />
                  <Btn title="QR-kód" kind="ghost" small onPress={() => setQrOpenId(qrOpenId === eq.id ? null : eq.id)} />
                  <Btn title="Kommentek" kind="ghost" small onPress={() => setOpenComments(openComments === eq.id ? null : eq.id)} />
                  {eq.created_by === getCurrentUserId() ? (
                    <Btn title="🗑️ Törlés" kind="ghost" small onPress={() => {
                      void confirmDialog('Eszköz törlése', `Biztosan törlöd? (${eq.name})`, 'Törlés', true).then((ok) => {
                        if (ok) { void removeStoragePaths('equipment', [eq.photo_path]); softDeleteRow('equipment', eq.id); }
                      });
                    }} />
                  ) : null}
                </View>
              )}
              {qrOpenId === eq.id ? qrCard(eq) : null}
              {openComments === eq.id ? <Comments entityType="equipment" entityId={eq.id} /> : null}
            </View>
          ))}
        </Card>
      ))}
    </Screen>
  );
}
