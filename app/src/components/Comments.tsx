// Polimorf komment-szekció bármely entitáshoz, realtime frissüléssel

import React, { useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { Card, H2, Sub, Body, Input, Btn } from '../ui/kit';
import { C, S } from '../ui/theme';
import { useTable } from '../lib/hooks';
import { insertRow, softDeleteRow, getCurrentUserId } from '../lib/repo';
import { supabase } from '../lib/supabase';
import { store } from '../lib/store';
import { hdt } from '../lib/format';
import { Comment, Profile } from '../lib/types';

export function Comments({ entityType, entityId }: { entityType: Comment['entity_type']; entityId: string }) {
  const all = useTable<Comment>('comments');
  const profiles = useTable<Profile>('profiles');
  const [text, setText] = useState('');
  const me = getCurrentUserId();

  // realtime: más felhasználó kommentje azonnal megjelenik
  useEffect(() => {
    const channel = supabase
      .channel(`comments-${entityType}-${entityId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'comments' },
        (payload) => {
          // hard DELETE-nél a payload.old csak az id-t hozza — a csonk sorral
          // nem írjuk felül a kommentet, hanem eltávolítjuk a tükörből
          if (payload.eventType === 'DELETE') {
            const oldId = (payload.old as any)?.id;
            if (oldId) store.removeLocal('comments', String(oldId));
            return;
          }
          const row = payload.new as Comment | undefined;
          if (row?.id) store.putLocal('comments', row as any, true);
        })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [entityType, entityId]);

  const comments = all
    .filter((cm) => cm.entity_type === entityType && cm.entity_id === entityId)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));

  const send = () => {
    if (!text.trim()) return;
    insertRow('comments', {
      entity_type: entityType,
      entity_id: entityId,
      author_id: me,
      body: text.trim(),
    });
    setText('');
  };

  const authorName = (id: string) => profiles.find((p) => p.id === id)?.display_name ?? 'Ismeretlen';

  return (
    <Card>
      <H2>Kommentek {comments.length > 0 ? `(${comments.length})` : ''}</H2>
      {comments.map((cm) => (
        <View key={cm.id} style={{ backgroundColor: C.bg, borderRadius: 8, padding: S.md, gap: 2 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ fontWeight: '700', fontSize: 13, color: C.primary }}>{authorName(cm.author_id)}</Text>
            <Sub>{hdt(cm.created_at)}</Sub>
          </View>
          <Body>{cm.body}</Body>
          {cm.author_id === me ? (
            <Text onPress={() => softDeleteRow('comments', cm.id)} style={{ color: C.danger, fontSize: 12 }}>Törlés</Text>
          ) : null}
        </View>
      ))}
      <View style={{ flexDirection: 'row', gap: S.sm, alignItems: 'flex-end' }}>
        <View style={{ flex: 1 }}>
          <Input value={text} onChangeText={setText} placeholder="Írj kommentet…" />
        </View>
        <Btn title="Küld" small onPress={send} disabled={!text.trim()} />
      </View>
    </Card>
  );
}
