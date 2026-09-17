// Munkavállalói fiók kapuja: a meghívóval regisztrált fiók addig nem
// használhatja az appot, amíg egy vezető jóvá nem hagyja. A státuszt
// RPC-n kérdezzük (a függő fiók a saját munkavállaló-sorát sem látja), és
// félpercenként + minden szinkron után újra ellenőrizzük.

import React, { useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { useAuth } from '../lib/auth';
import { useTable, useSyncStatus } from '../lib/hooks';
import { callRpc } from '../lib/repo';
import { Btn, Sub } from '../ui/kit';
import { C, S } from '../ui/theme';
import { Profile } from '../lib/types';

type Status = 'none' | 'pending' | 'approved' | 'rejected';

export function WorkerApprovalGate() {
  const { session, signOut } = useAuth();
  const sync = useSyncStatus();
  const me = useTable<Profile>('profiles').find((p) => p.id === session?.user.id);
  const isWorker = !!me?.worker_id;
  const [status, setStatus] = useState<Status | null>(null);
  const [checking, setChecking] = useState(false);

  const check = async () => {
    if (!isWorker) return;
    setChecking(true);
    try {
      const r = await callRpc<{ status: Status }>('my_worker_status');
      setStatus(r?.status ?? 'approved');
    } catch {
      // offline: nem zárjuk ki — az RLS úgyis nem ad adatot, amíg függő
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => { void check(); }, [isWorker, session?.user.id, sync.lastSyncAt]);
  useEffect(() => {
    if (!isWorker || status === 'approved') return;
    const t = setInterval(() => { void check(); }, 30_000);
    return () => clearInterval(t);
  }, [isWorker, status]);

  if (!session || !isWorker || !status || status === 'approved' || status === 'none') return null;

  const pending = status === 'pending';
  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: C.bg,
      alignItems: 'center', justifyContent: 'center', padding: S.lg, zIndex: 1000 }}>
      <View style={{ maxWidth: 420, width: '100%', gap: S.md, backgroundColor: C.card, borderRadius: S.radius,
        borderWidth: 1, borderColor: C.border, padding: S.lg, alignItems: 'center' }}>
        <Text style={{ fontSize: 44 }}>{pending ? '⏳' : '🚫'}</Text>
        <Text style={{ fontSize: 18, fontWeight: '800', color: C.text, textAlign: 'center' }}>
          {pending ? 'Regisztrációd jóváhagyásra vár' : 'Regisztrációd elutasítva'}
        </Text>
        <Sub style={{ textAlign: 'center' }}>
          {pending
            ? `Szia ${me?.display_name ?? ''}! A fiókod elkészült, de egy vezetőnek még jóvá kell hagynia, mielőtt beléphetsz. Értesítést kapsz, amint megtörtént — ez az oldal magától frissül.`
            : 'A vezetők nem hagyták jóvá a regisztrációdat. Ha szerinted tévedés, kérdezz rá náluk.'}
        </Sub>
        {pending ? <Btn title={checking ? 'Ellenőrzés…' : 'Frissítés'} kind="secondary" small disabled={checking} onPress={() => void check()} /> : null}
        <Btn title="Kijelentkezés" kind="ghost" small onPress={() => void signOut()} />
      </View>
    </View>
  );
}
