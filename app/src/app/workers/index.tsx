import React, { useState } from 'react';
import { View, Text, Linking, Pressable } from 'react-native';
import { router } from 'expo-router';
import { Screen, Input, Row, Body, Sub, Btn, Empty, Badge } from '../../ui/kit';
import { InviteCard } from '../../components/InviteCard';
import { C } from '../../ui/theme';
import { useTable } from '../../lib/hooks';
import { Worker } from '../../lib/types';

export function CallButton({ phone, small }: { phone: string; small?: boolean }) {
  return (
    <Pressable
      onPress={(e) => {
        // @ts-ignore – web esemény
        e?.stopPropagation?.();
        void Linking.openURL(`tel:${phone.replace(/\s/g, '')}`);
      }}
      style={{
        backgroundColor: C.success, borderRadius: 999,
        paddingHorizontal: small ? 10 : 14, paddingVertical: small ? 6 : 9,
      }}
    >
      <Text style={{ color: '#fff', fontWeight: '700', fontSize: small ? 13 : 15 }}>📞</Text>
    </Pressable>
  );
}

export default function Workers() {
  const workers = useTable<Worker>('workers');
  const [q, setQ] = useState('');

  const pending = workers.filter((w) => !w.approved_at).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const filtered = workers
    .filter((w) => !!w.approved_at)
    .filter((w) => `${w.name} ${w.nickname ?? ''}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name, 'hu'));
  // a vállalkozó emberei közvetlenül a vállalkozó alatt
  const ordered = filtered.filter((w) => !w.contractor_id).flatMap((w) => [w, ...filtered.filter((c) => c.contractor_id === w.id)])
    .concat(filtered.filter((w) => w.contractor_id && !filtered.some((c) => c.id === w.contractor_id)));

  return (
    <Screen>
      <InviteCard />
      {pending.length ? (
        <View style={{ gap: 6 }}>
          <Body style={{ fontWeight: '800' }}>⏳ Jóváhagyásra váró regisztráció ({pending.length})</Body>
          {pending.map((w) => (
            <Row key={w.id} onPress={() => router.push(`/worker/${w.id}`)} style={{ borderColor: '#B7791F', borderWidth: 1, backgroundColor: C.warnBg }}>
              <View style={{ flex: 1 }}>
                <Body style={{ fontWeight: '700' }}>{w.name}</Body>
                <Sub>{w.trade ? `${w.trade} · ` : ''}{w.email ?? ''}{w.phones[0] ? ` · ${w.phones[0]}` : ''}</Sub>
              </View>
              <Badge text="jóváhagyás" color="#B7791F" />
            </Row>
          ))}
        </View>
      ) : null}
      <Input value={q} onChangeText={setQ} placeholder="Keresés név szerint…" />
      {filtered.length === 0 ? <Empty text="Nincs munkavállaló." /> : null}
      {ordered.map((w) => (
        <Row key={w.id} onPress={() => router.push(`/worker/${w.id}`)}>
          <View style={{ flex: 1 }}>
            <Body style={{ fontWeight: '700' }}>{w.contractor_id ? '   ↳ ' : ''}{w.name}{w.nickname ? ` „${w.nickname}”` : ''}{w.is_contractor ? ' 👥' : ''}</Body>
            <Sub>
              {w.contractor_id ? `${workers.find((c) => c.id === w.contractor_id)?.name ?? 'vállalkozó'} embere · ` : ''}
              {w.trade ? `${w.trade} · ` : ''}
              {w.worker_type === 'company' ? 'céges' : 'magánszemély'}
              {w.phones[0] ? ` · ${w.phones[0]}` : ''}
            </Sub>
          </View>
          {w.phones[0] ? <CallButton phone={w.phones[0]} small /> : null}
        </Row>
      ))}
      <Btn title="+ Új munkavállaló" kind="secondary" onPress={() => router.push('/worker/new')} />
    </Screen>
  );
}
