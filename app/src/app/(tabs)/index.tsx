import React, { useMemo } from 'react';
import { View, Text } from 'react-native';
import { router } from 'expo-router';
import { Screen, Card, H2, Sub, Money, Btn, KV, Badge, Empty } from '../../ui/kit';
import { C, S } from '../../ui/theme';
import { useTable, useSyncStatus, useOnlineView } from '../../lib/hooks';
import { ft, todayISO, hd } from '../../lib/format';
import { fetchView } from '../../lib/repo';
import { Site, Expense, Attendance, Invoice, UserBalance } from '../../lib/types';
import { useAuth } from '../../lib/auth';

export default function Dashboard() {
  const { session } = useAuth();
  const sync = useSyncStatus();
  const sites = useTable<Site>('sites');
  const expenses = useTable<Expense>('expenses');
  const attendance = useTable<Attendance>('attendance');
  const invoices = useTable<Invoice>('invoices');

  const balances = useOnlineView<UserBalance[]>('balances', () => fetchView('v_user_balances'), []);

  const month = todayISO().slice(0, 7);
  const stats = useMemo(() => {
    const mExp = expenses.filter((e) => e.expense_date.startsWith(month)).reduce((s, e) => s + Number(e.net_amount), 0);
    const mWage = attendance.filter((a) => a.work_date.startsWith(month)).reduce((s, a) => s + Number(a.amount), 0);
    const mRev = invoices.filter((i) => i.paid_at?.startsWith(month)).reduce((s, i) => s + Number(i.net_amount), 0);
    const outstanding = invoices.filter((i) => !i.paid_at).reduce((s, i) => s + Number(i.net_amount), 0);
    const unpaidWages = attendance.filter((a) => a.pay_basis !== 'presence' && !a.paid_at)
      .reduce((s, a) => s + Number(a.amount) - Number(a.commission_amount), 0);
    const unpaidCommissions = attendance.filter((a) => a.referrer_external_id && Number(a.commission_amount) > 0 && !a.commission_paid_at)
      .reduce((s, a) => s + Number(a.commission_amount), 0);
    return { mExp, mWage, mRev, outstanding, unpaidWages, unpaidCommissions };
  }, [expenses, attendance, invoices, month]);

  const activeSites = sites.filter((s) => s.status === 'active');
  const myBalance = balances.data?.find((b) => b.user_id === session?.user.id);

  return (
    <Screen>
      {sync.pendingOps > 0 ? (
        <Card style={{ backgroundColor: '#FFF7E0', borderColor: C.accent }}>
          <Sub style={{ color: C.warning }}>
            ⏳ {sync.pendingOps} művelet vár szinkronizálásra{sync.lastError ? ` — ${sync.lastError}` : ''}
          </Sub>
        </Card>
      ) : null}

      <Card>
        <H2>Egyenlegem</H2>
        {myBalance ? (
          <>
            <Text style={{ fontSize: 28, fontWeight: '800', color: myBalance.balance >= 0 ? C.success : C.danger }}>
              {ft(myBalance.balance)}
            </Text>
            <Sub>{myBalance.balance >= 0 ? 'Ennyi jár neked a közösből' : 'Ennyivel tartozol a közösnek'}
              {balances.fromCache ? ' (offline, utolsó ismert)' : ''}</Sub>
          </>
        ) : <Sub>Egyenleg betöltése…</Sub>}
        <Btn title="Elszámolás megnyitása" kind="ghost" small onPress={() => router.push('/settlement')} />
      </Card>

      <Card>
        <H2>Ez a hónap</H2>
        <KV k="Költés (nettó)" v={ft(stats.mExp + stats.mWage)} />
        <KV k="— ebből anyag/egyéb" v={ft(stats.mExp)} />
        <KV k="— ebből bér" v={ft(stats.mWage)} />
        <KV k="Befolyt bevétel (nettó)" v={ft(stats.mRev)} />
        <KV k="Eredmény" v={ft(stats.mRev - stats.mExp - stats.mWage)} strong />
      </Card>

      {(stats.outstanding > 0 || stats.unpaidWages > 0 || stats.unpaidCommissions > 0) ? (
        <Card style={{ borderColor: C.accent }}>
          <H2>Függőben</H2>
          {stats.outstanding > 0 ? <KV k="Kintlévőség (számlázva, nem folyt be)" v={ft(stats.outstanding)} /> : null}
          {stats.unpaidWages > 0 ? <KV k="Kifizetetlen bérek" v={ft(stats.unpaidWages)} /> : null}
          {stats.unpaidCommissions > 0 ? <KV k="Kifizetetlen közvetítői díjak" v={ft(stats.unpaidCommissions)} /> : null}
        </Card>
      ) : null}

      <Card>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <H2>Aktív építkezések</H2>
          <Badge text={`${activeSites.length} db`} />
        </View>
        {activeSites.length === 0 ? <Empty text="Nincs aktív építkezés. Hozz létre egyet!" /> : null}
        {activeSites.map((s) => (
          <Btn key={s.id} title={s.name} kind="ghost" onPress={() => router.push(`/site/${s.id}`)} />
        ))}
        <Btn title="+ Új építkezés" kind="secondary" onPress={() => router.push('/site/new')} />
      </Card>

      <View style={{ flexDirection: 'row', gap: S.md }}>
        <View style={{ flex: 1 }}>
          <Btn title="+ Költség" onPress={() => router.push('/expense/new')} />
        </View>
        <View style={{ flex: 1 }}>
          <Btn title="+ Jelenlét" onPress={() => router.push(`/day/${todayISO()}`)} />
        </View>
      </View>

      <Sub style={{ textAlign: 'center' }}>
        {sync.lastSyncAt ? `Utolsó szinkron: ${hd(sync.lastSyncAt)} ${new Date(sync.lastSyncAt).toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' })}` : 'Még nem volt szinkron'}
      </Sub>
    </Screen>
  );
}
