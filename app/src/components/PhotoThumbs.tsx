// Fotó-bélyegképek: tárolóbeli (aláírt URL) és még fel nem töltött helyi
// képek egy sorban; koppintásra teljes méret, opcionális ✕ törlés.

import React, { useEffect, useState } from 'react';
import { View, Image, Pressable, Text, Linking } from 'react-native';
import { C } from '../ui/theme';
import { taskPhotoUrl, PickedPhoto } from '../lib/photo';

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

export function PhotoThumbs({ paths = [], local = [], onRemoveRemote, onRemoveLocal }: {
  paths?: string[]; local?: PickedPhoto[];
  onRemoveRemote?: (path: string) => void; onRemoveLocal?: (index: number) => void;
}) {
  const [urls, setUrls] = useState<Record<string, string | null>>({});
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
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingTop: 4 }}>
      {paths.map((p) => (
        <Thumb key={p} uri={urls[p] ?? null}
          onOpen={() => { const u = urls[p]; if (u) void Linking.openURL(u); }}
          onRemove={onRemoveRemote ? () => onRemoveRemote(p) : undefined} />
      ))}
      {local.map((ph, i) => (
        <Thumb key={`local-${i}`} uri={ph.uri} onRemove={onRemoveLocal ? () => onRemoveLocal(i) : undefined} />
      ))}
    </View>
  );
}
