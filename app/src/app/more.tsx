import React from 'react';
import { View, Text } from 'react-native';
import { router } from 'expo-router';
import { Screen, Row, Body, Btn, Sub, Card } from '../ui/kit';
import { useAuth } from '../lib/auth';
import { useSyncStatus } from '../lib/hooks';
import { syncNow } from '../lib/sync';
import { hdt } from '../lib/format';
import { notify, confirmDialog } from '../lib/dialogs';

const ITEMS: { label: string; icon: string; href: string }[] = [
  { label: 'Munkavállalók', icon: '👷', href: '/workers' },
  { label: 'Kimenő számlák', icon: '🧾', href: '/invoices' },
  { label: 'Statisztika', icon: '📊', href: '/stats' },
  { label: 'Eszközök', icon: '🔨', href: '/equipment' },
  { label: 'Export könyvelőnek', icon: '📤', href: '/export' },
  { label: 'Audit napló', icon: '🕵️', href: '/audit' },
  { label: 'Beállítások', icon: '⚙️', href: '/settings' },
];

export default function More() {
  const { session, signOut } = useAuth();
  const sync = useSyncStatus();

  return (
    <Screen>
      {ITEMS.map((i) => (
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
        <Btn title="Szinkronizálás most" kind="ghost" small onPress={() => void syncNow()} />
        <Btn
          title="Kijelentkezés"
          kind="danger"
          small
          onPress={() => {
            if (sync.pendingOps > 0) {
              void confirmDialog(
                'Függő műveletek',
                `${sync.pendingOps} művelet még nem szinkronizált. Kijelentkezéskor ezek elvesznek. Biztosan kilépsz?`,
                'Kilépés', true,
              ).then((ok) => { if (ok) void signOut(); });
            } else {
              void signOut();
            }
          }}
        />
      </Card>
    </Screen>
  );
}
