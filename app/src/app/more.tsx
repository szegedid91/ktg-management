import React, { useState } from 'react';
import { View, Text } from 'react-native';
import { router } from 'expo-router';
import { Screen, Row, Body, Btn, Sub, Card } from '../ui/kit';
import { useAuth } from '../lib/auth';
import { useSyncStatus } from '../lib/hooks';
import { syncNow } from '../lib/sync';
import { hdt } from '../lib/format';
import { APP_VERSION } from '../lib/version';
import { lastCrash } from '../components/ErrorBoundary';
import { notify, confirmDialog } from '../lib/dialogs';
import { useTable } from '../lib/hooks';
import { Profile } from '../lib/types';
import { WorkerAccountCard } from '../components/WorkerAccountCard';

const ITEMS: { label: string; icon: string; href: string }[] = [
  { label: 'Munkavállalók', icon: '👷', href: '/workers' },
  { label: 'Óralapok', icon: '🗓️', href: '/timesheets' },
  { label: 'Pénzügy', icon: '💰', href: '/finance' },
  { label: 'Eszközök', icon: '🔨', href: '/equipment' },
  { label: 'Audit napló', icon: '🕵️', href: '/audit' },
  { label: 'Beállítások', icon: '⚙️', href: '/settings' },
];

export default function More() {
  const [leaving, setLeaving] = useState(false);
  const { session, signOut } = useAuth();
  const sync = useSyncStatus();
  // munkavállalói fiók: nincs Beállítások/menü — csak a saját alapadatok
  const myProfile = useTable<Profile>('profiles').find((p) => p.id === session?.user.id);
  const isWorker = !!myProfile?.worker_id;
  // a hibanaplót csak az admin látja
  const items = myProfile?.is_admin ? [...ITEMS, { label: 'Hibanapló', icon: '🐞', href: '/errors' }] : ITEMS;

  return (
    <Screen>
      {isWorker ? <WorkerAccountCard /> : null}
      {(isWorker ? [] : items).map((i) => (
        <Row key={i.href} onPress={() => router.push(i.href as any)}>
          <Text style={{ fontSize: 20 }}>{i.icon}</Text>
          <Body style={{ fontWeight: '600', flex: 1 }}>{i.label}</Body>
          <Text>›</Text>
        </Row>
      ))}
      <Card>
        <Sub>Bejelentkezve: {session?.user.email}</Sub>
        <Sub>Utolsó szinkron: {sync.lastSyncAt ? hdt(sync.lastSyncAt) : 'még nem volt'}
          {sync.pendingOps > 0 ? ` · ${sync.pendingOps} függő művelet` : ''}</Sub>
        <Sub>Verzió: {APP_VERSION}</Sub>
        {lastCrash() ? <Sub style={{ fontSize: 11, color: '#C53030' }}>Utolsó hiba: {lastCrash()}</Sub> : null}
        <Btn title="Szinkronizálás most" kind="ghost" small onPress={() => void syncNow()} />
        <Btn
          title={leaving ? 'Kijelentkezés…' : 'Kijelentkezés'}
          kind="danger"
          small
          disabled={leaving}
          onPress={() => {
            const doSignOut = () => { setLeaving(true); void signOut().finally(() => setLeaving(false)); };
            if (sync.pendingOps > 0) {
              void confirmDialog(
                'Függő műveletek',
                `${sync.pendingOps} művelet még nem szinkronizált. Kijelentkezéskor ezek elvesznek. Biztosan kilépsz?`,
                'Kilépés', true,
              ).then((ok) => { if (ok) doSignOut(); });
            } else {
              doSignOut();
            }
          }}
        />
      </Card>
    </Screen>
  );
}
