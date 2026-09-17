import React, { useState } from 'react';
import { View, Text, Linking, Pressable } from 'react-native';
import { router } from 'expo-router';
import { Screen, Input, Row, Body, Sub, Btn, Empty, Badge } from '../../ui/kit';
import { InviteCard } from '../../components/InviteCard';
import { C } from '../../ui/theme';
import { useTable, useIsWorker } from '../../lib/hooks';
import { Worker, Profile, TaskAssignee, WorkerTask } from '../../lib/types';
import { isActiveTask } from '../../lib/tasks';
import { copyText } from '../../lib/clipboard';

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

/** Telefonszám vágólapra másolása (a gyorshívó mellé): felugró ablak helyett
 *  a gomb rövid időre zöldre vált és pipát mutat. */
export function CopyButton({ text, small }: { text: string; small?: boolean; label?: string }) {
  const [state, setState] = useState<'idle' | 'done' | 'fail'>('idle');
  return (
    <Pressable
      onPress={(e) => {
        // @ts-ignore – web esemény
        e?.stopPropagation?.();
        void copyText(text).then((ok) => {
          setState(ok ? 'done' : 'fail');
          setTimeout(() => setState('idle'), 1200);
        });
      }}
      style={{
        backgroundColor: state === 'done' ? C.success : state === 'fail' ? C.danger : C.card,
        borderWidth: 1, borderColor: state === 'idle' ? C.border : 'transparent', borderRadius: 999,
        paddingHorizontal: small ? 10 : 14, paddingVertical: small ? 6 : 9,
        transform: [{ scale: state === 'idle' ? 1 : 1.12 }],
      }}
    >
      <Text style={{ color: state === 'idle' ? C.text : '#fff', fontWeight: '700', fontSize: small ? 13 : 15 }}>
        {state === 'done' ? '✓' : state === 'fail' ? '✕' : '📋'}
      </Text>
    </Pressable>
  );
}

function WorkersInner() {
  const workers = useTable<Worker>('workers');
  // kinek van saját (összekapcsolt) fiókja — a többinél jelezzük, hogy még nincs
  const withAccount = new Set(useTable<Profile>('profiles').map((p) => p.worker_id).filter(Boolean) as string[]);
  const [q, setQ] = useState('');
  // aktív feladatok munkavállalónként: kiosztott / elfogadott / még nem elfogadott
  const tasks = useTable<WorkerTask>('worker_tasks');
  const activeIds = new Set(tasks.filter(isActiveTask).map((t) => t.id));
  const assignees = useTable<TaskAssignee>('task_assignees').filter((a) => activeIds.has(a.task_id));
  const loadOf = (wid: string) => {
    const mine = assignees.filter((a) => a.worker_id === wid);
    const acked = mine.filter((a) => a.acknowledged_at).length;
    return { total: mine.length, acked, pending: mine.length - acked };
  };

  const pending = workers.filter((w) => !w.approved_at).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const filtered = workers
    .filter((w) => !!w.approved_at)
    .filter((w) => `${w.name} ${w.nickname ?? ''} ${w.trade ?? ''}`.toLowerCase().includes(q.trim().toLowerCase()))
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
      <Input value={q} onChangeText={setQ} placeholder="Keresés név vagy szakma szerint…" />
      {filtered.length === 0 ? <Empty text="Nincs munkavállaló." /> : null}
      {ordered.map((w) => (
        <Row key={w.id} onPress={() => router.push(`/worker/${w.id}`)}>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <Body style={{ fontWeight: '700' }}>{w.contractor_id ? '   ↳ ' : ''}{w.name}{w.nickname ? ` „${w.nickname}”` : ''}{w.is_contractor ? ' 👥' : ''}</Body>
              {!withAccount.has(w.id) ? <Badge text="nincs fiókja" color={C.warning} /> : null}
            </View>
            <Sub>
              {w.contractor_id ? `${workers.find((c) => c.id === w.contractor_id)?.name ?? 'vállalkozó'} embere · ` : ''}
              {w.trade ? `${w.trade} · ` : ''}
              {w.worker_type === 'company' ? 'céges' : 'magánszemély'}
              {w.phones[0] ? ` · ${w.phones[0]}` : ''}
            </Sub>
            {(() => { const l = loadOf(w.id); return l.total ? (
              <Text style={{ fontSize: 12, marginTop: 2 }}>
                <Text style={{ color: C.text, fontWeight: '700' }}>🛠️ {l.total} feladat</Text>
                <Text style={{ color: C.sub }}> · </Text>
                <Text style={{ color: C.success, fontWeight: '700' }}>✓ {l.acked} elfogadva</Text>
                {l.pending ? <><Text style={{ color: C.sub }}> · </Text><Text style={{ color: C.warning, fontWeight: '800' }}>⏳ {l.pending} nincs elfogadva</Text></> : null}
              </Text>
            ) : <Text style={{ fontSize: 12, color: C.sub, marginTop: 2 }}>nincs aktív feladata</Text>; })()}
          </View>
          {w.phones[0] ? <CopyButton text={w.phones[0]} small /> : null}
          {w.phones[0] ? <CallButton phone={w.phones[0]} small /> : null}
        </Row>
      ))}
      <Btn title="+ Új munkavállaló" kind="secondary" onPress={() => router.push('/worker/new')} />
    </Screen>
  );
}

/** Vezetői oldal: munkavállalói fiók nem nyithatja meg (a hookok
 *  sorrendje miatt külön burkolóban, nem a komponensen belüli korai visszatéréssel). */
export default function Workers() {
  if (useIsWorker()) return <Screen><Empty text="Nincs jogosultságod ehhez az oldalhoz." /></Screen>;
  return <WorkersInner />;
}
