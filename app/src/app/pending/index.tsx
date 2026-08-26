// Függőben — áttekintő: kintlévőség, kifizetetlen bérek és közvetítői
// díjak, innen nyílnak a részletes, építkezésenkénti bontások.

import React, { useMemo } from 'react';
import { View, Text, Pressable } from 'react-native';
import { router } from 'expo-router';
import { Screen, Card, H2, Sub, Body } from '../../ui/kit';
import { C, S } from '../../ui/theme';
import { useTable } from '../../lib/hooks';
import { Attendance, Invoice } from '../../lib/types';

function PendingRow({ icon, label, amount, count, href }: {
  icon: string; label: string; amount: number; count: number; href: string;
}) {
  const done = amount <= 0;
  return (
    <Pressable onPress={() => router.push(href as any)} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
      <Card style={done ? undefined : { borderColor: C.accent }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.md }}>
          <Text style={{ fontSize: 26 }}>{icon}</Text>
          <View style={{ flex: 1 }}>
            <Body style={{ fontWeight: '700' }}>{label}</Body>
            <Sub>{done ? 'Nincs függő tétel ✅' : `${count} függő tétel ⚠️`}</Sub>
          </View>
          <Text style={{ color: C.sub, fontSize: 18 }}>›</Text>
        </View>
      </Card>
    </Pressable>
  );
}

export default function PendingOverview() {
  const attendance = useTable<Attendance>('attendance');
  const invoices = useTable<Invoice>('invoices');

  const stats = useMemo(() => {
    const unpaidInvoices = invoices.filter((i) => !i.paid_at);
    const unpaidWageRows = attendance.filter((a) =>
      a.pay_basis !== 'presence' && !a.paid_at && Number(a.amount) - Number(a.commission_amount) > 0);
    const unpaidCommRows = attendance.filter((a) =>
      a.referrer_external_id && Number(a.commission_amount) > 0 && !a.commission_paid_at);
    return {
      outstanding: unpaidInvoices.reduce((s, i) => s + Number(i.net_amount), 0),
      outstandingCount: unpaidInvoices.length,
      wages: unpaidWageRows.reduce((s, a) => s + Number(a.amount) - Number(a.commission_amount), 0),
      wagesCount: unpaidWageRows.length,
      commissions: unpaidCommRows.reduce((s, a) => s + Number(a.commission_amount), 0),
      commissionsCount: unpaidCommRows.length,
    };
  }, [attendance, invoices]);

  return (
    <Screen>
      <Sub>Koppints egy sorra a részletes, építkezésenkénti bontáshoz.</Sub>
      <PendingRow
        icon="🧾"
        label="Kintlévőség"
        amount={stats.outstanding}
        count={stats.outstandingCount}
        href="/invoices"
      />
      <PendingRow
        icon="👷"
        label="Kifizetetlen bérek"
        amount={stats.wages}
        count={stats.wagesCount}
        href="/pending/wages"
      />
      <PendingRow
        icon="🤝"
        label="Kifizetetlen közvetítői díjak"
        amount={stats.commissions}
        count={stats.commissionsCount}
        href="/pending/commissions"
      />
    </Screen>
  );
}
