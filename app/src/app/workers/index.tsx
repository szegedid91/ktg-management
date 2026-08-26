import React, { useState } from 'react';
import { View, Text, Linking, Pressable } from 'react-native';
import { router } from 'expo-router';
import { Screen, Input, Row, Body, Sub, Btn, Empty, Badge } from '../../ui/kit';
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

  const filtered = workers
    .filter((w) => w.name.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name, 'hu'));

  return (
    <Screen>
      <Input value={q} onChangeText={setQ} placeholder="Keresés név szerint…" />
      {filtered.length === 0 ? <Empty text="Nincs munkavállaló." /> : null}
      {filtered.map((w) => (
        <Row key={w.id} onPress={() => router.push(`/worker/${w.id}`)}>
          <View style={{ flex: 1 }}>
            <Body style={{ fontWeight: '700' }}>{w.name}</Body>
            <Sub>
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
