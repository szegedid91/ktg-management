// Fotó-bélyegképek: tárolóbeli (aláírt URL) és még fel nem töltött helyi
// képek egy sorban; koppintásra beépített, lapozható teljes képes nézet
// (‹ › gombok, számláló), opcionális ✕ törlés a bélyegképen és 🗑️ a nézőben;
// a feltöltött képek a nézőben 90°-onként forgathatók (↺ ↻), ha a hívó megadja az onRotateRemote-ot.
// Nem nyit új böngészőlapot (főképernyős appban az üres lapot hagyna maga után).

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Image, Pressable, Text, Modal, useWindowDimensions, PanResponder } from 'react-native';
import { C } from '../ui/theme';
import { taskPhotoUrl, PickedPhoto, canRotatePhotos } from '../lib/photo';
import { notify } from '../lib/dialogs';

const SIZE = 76;

function Thumb({ uri, onOpen, onRemove }: { uri: string | null; onOpen?: () => void; onRemove?: () => void }) {
  return (
    <View style={{ width: SIZE, height: SIZE }}>
      <Pressable onPress={onOpen} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
        {uri
          ? <Image source={{ uri }} style={{ width: SIZE, height: SIZE, borderRadius: 8, backgroundColor: C.chipBg }} resizeMode="cover" />
          : <View style={{ width: SIZE, height: SIZE, borderRadius: 8, backgroundColor: C.chipBg, alignItems: 'center', justifyContent: 'center' }}><Text>📷</Text></View>}
      </Pressable>
      {onRemove ? (
        <Pressable onPress={onRemove} hitSlop={8} accessibilityLabel="Fotó törlése"
          style={{ position: 'absolute', top: -6, right: -6, width: 22, height: 22, borderRadius: 11, backgroundColor: C.danger, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12, lineHeight: 14 }}>✕</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function NavBtn({ label, onPress, disabled, accessibilityLabel }: { label: string; onPress: () => void; disabled?: boolean; accessibilityLabel: string }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} hitSlop={10} accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => ({ width: 52, height: 52, borderRadius: 26, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.25 : pressed ? 0.6 : 1 })}>
      <Text style={{ color: '#fff', fontSize: 26, fontWeight: '800', lineHeight: 30 }}>{label}</Text>
    </Pressable>
  );
}

/** Lapozható, teljes képes nézet. items: { uri, onRemove?, onRotate? } */
function Viewer({ items, index, onIndex, onClose }: {
  items: { uri: string | null; loading?: boolean; onRemove?: () => void; onRotate?: (clockwise: boolean) => Promise<void> }[];
  index: number; onIndex: (i: number) => void; onClose: () => void;
}) {
  const { width, height } = useWindowDimensions();
  const [rotating, setRotating] = useState(false);
  const rotate = async (clockwise: boolean) => {
    const it = items[index];
    if (!it?.onRotate || rotating) return;
    setRotating(true);
    try { await it.onRotate(clockwise); }
    catch { notify('Nem sikerült', 'A kép elforgatásához internet kell — próbáld újra kapcsolattal.'); }
    finally { setRotating(false); }
  };
  // lapozás húzással (ujjal vagy egérrel): vízszintes elhúzás 50 px felett lapoz
  const state = useRef({ index, count: items.length, onIndex });
  state.current = { index, count: items.length, onIndex };
  const pan = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
    onPanResponderRelease: (_, g) => {
      const { index: i, count, onIndex: go } = state.current;
      if (g.dx < -50 && i < count - 1) go(i + 1);
      else if (g.dx > 50 && i > 0) go(i - 1);
    },
  }), []);
  const cur = items[index];
  if (!cur) return null;
  return (
    <Modal transparent animationType="fade" visible onRequestClose={onClose}>
      <View {...pan.panHandlers} style={{ flex: 1, backgroundColor: '#0b0b0b', justifyContent: 'center', alignItems: 'center' }}>
        <View style={{ position: 'absolute', top: 14, left: 14, right: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', zIndex: 2 }}>
          <Text style={{ color: '#fff', fontWeight: '700', fontSize: 16 }}>{index + 1} / {items.length}</Text>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            {cur.onRotate ? (
              <>
                <Pressable onPress={() => void rotate(false)} disabled={rotating} hitSlop={6} accessibilityLabel="Forgatás balra"
                  style={({ pressed }) => ({ width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center', opacity: rotating ? 0.35 : pressed ? 0.7 : 1 })}>
                  <Text style={{ color: '#fff', fontWeight: '800', fontSize: 20 }}>↺</Text>
                </Pressable>
                <Pressable onPress={() => void rotate(true)} disabled={rotating} hitSlop={6} accessibilityLabel="Forgatás jobbra"
                  style={({ pressed }) => ({ width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center', opacity: rotating ? 0.35 : pressed ? 0.7 : 1 })}>
                  <Text style={{ color: '#fff', fontWeight: '800', fontSize: 20 }}>↻</Text>
                </Pressable>
              </>
            ) : null}
            {cur.onRemove ? (
              <Pressable onPress={cur.onRemove} hitSlop={10} accessibilityLabel="Ez a fotó törlése"
                style={({ pressed }) => ({ paddingHorizontal: 14, height: 40, borderRadius: 20, backgroundColor: C.danger, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.7 : 1 })}>
                <Text style={{ color: '#fff', fontWeight: '800' }}>🗑️ Törlés</Text>
              </Pressable>
            ) : null}
            <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Bezárás"
              style={({ pressed }) => ({ width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.7 : 1 })}>
              <Text style={{ color: '#fff', fontWeight: '800', fontSize: 18 }}>✕</Text>
            </Pressable>
          </View>
        </View>
        {cur.uri
          ? <Image source={{ uri: cur.uri }} style={{ width: width - 24, height: height - 160 }} resizeMode="contain" />
          : <Text style={{ color: '#fff' }}>{cur.loading ? 'Betöltés…' : 'A kép nem tölthető be.'}</Text>}
        {rotating ? (
          <View style={{ position: 'absolute', top: 70, alignSelf: 'center', backgroundColor: 'rgba(0,0,0,0.7)', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16 }}>
            <Text style={{ color: '#fff', fontWeight: '700' }}>Forgatás…</Text>
          </View>
        ) : null}
        {items.length > 1 ? (
          <View style={{ position: 'absolute', bottom: 24, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 40 }}>
            <NavBtn label="‹" accessibilityLabel="Előző fotó" disabled={index === 0} onPress={() => onIndex(index - 1)} />
            <NavBtn label="›" accessibilityLabel="Következő fotó" disabled={index >= items.length - 1} onPress={() => onIndex(index + 1)} />
          </View>
        ) : null}
        {items.length > 1 ? <Text style={{ position: 'absolute', bottom: 6, color: 'rgba(255,255,255,0.5)', fontSize: 11 }}>húzd oldalra a lapozáshoz</Text> : null}
      </View>
    </Modal>
  );
}

export function PhotoThumbs({ paths = [], local = [], onRemoveRemote, onRemoveLocal, onRotateRemote }: {
  paths?: string[]; local?: PickedPhoto[];
  onRemoveRemote?: (path: string) => void; onRemoveLocal?: (index: number) => void;
  /** feltöltött kép elforgatása: a hívó elvégzi a cserét, és visszaadja az ÚJ útvonalat (a néző azon marad) */
  onRotateRemote?: (path: string, clockwise: boolean) => Promise<string | void>;
}) {
  const [urls, setUrls] = useState<Record<string, string | null>>({});
  const [open, setOpen] = useState<number | null>(null);
  // forgatás után a néző az új képen maradjon akkor is, ha az a lista másik helyére került
  const focusPath = useRef<string | null>(null);
  useEffect(() => {
    if (!focusPath.current) return;
    const i = paths.indexOf(focusPath.current);
    if (i >= 0) { focusPath.current = null; setOpen((o) => (o === null ? o : i)); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paths.join('|')]);
  const rotatable = canRotatePhotos && !!onRotateRemote;
  useEffect(() => {
    let alive = true;
    for (const p of paths) {
      if (urls[p] !== undefined) continue;
      taskPhotoUrl(p).then((u) => { if (alive) setUrls((m) => ({ ...m, [p]: u })); }).catch(() => {});
    }
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paths.join('|')]);

  if (paths.length === 0 && local.length === 0) return null;
  const items = [
    ...paths.map((p) => ({
      uri: urls[p] ?? null, loading: urls[p] === undefined,
      onRemove: onRemoveRemote ? () => { onRemoveRemote(p); } : undefined,
      onRotate: rotatable ? async (cw: boolean) => { const np = await onRotateRemote!(p, cw); if (np) focusPath.current = np; } : undefined,
    })),
    ...local.map((ph, i) => ({ uri: ph.uri as string | null, loading: false, onRemove: onRemoveLocal ? () => { onRemoveLocal(i); } : undefined, onRotate: undefined })),
  ];
  // törlés után a nézőben az előző képre lépünk (vagy bezárjuk, ha nem maradt)
  const viewerItems = items.map((it, i) => ({
    uri: it.uri, loading: it.loading, onRotate: it.onRotate,
    onRemove: it.onRemove ? () => { it.onRemove!(); setOpen(items.length <= 1 ? null : Math.max(0, Math.min(i, items.length - 2))); } : undefined,
  }));
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingTop: 4 }}>
      {paths.map((p, i) => (
        <Thumb key={p} uri={urls[p] ?? null} onOpen={() => setOpen(i)}
          onRemove={onRemoveRemote ? () => onRemoveRemote(p) : undefined} />
      ))}
      {local.map((ph, i) => (
        <Thumb key={`local-${i}`} uri={ph.uri} onOpen={() => setOpen(paths.length + i)} onRemove={onRemoveLocal ? () => onRemoveLocal(i) : undefined} />
      ))}
      {open !== null && open < items.length ? (
        <Viewer items={viewerItems} index={open} onIndex={setOpen} onClose={() => setOpen(null)} />
      ) : null}
    </View>
  );
}
