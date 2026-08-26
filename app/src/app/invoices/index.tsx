import React, { useMemo, useState } from 'react';
import { View, Text } from 'react-native';
import { router } from 'expo-router';
import { Screen, Card, Sub, Body, Btn, Row, Badge, Empty, Segmented, KV } from '../../ui/kit';
import { C } from '../../ui/theme';
import { useTable } from '../../lib/hooks';
import { ft, hd } from '../../lib/format';
import { Invoice, Site } from '../../lib/types';

export default function Invoices() {
  const invoices = useTable<Invoice>('invoices');
  const sites = useTable<Site>('sites');
  const [filter, setFilter] = useState<'all' | 'unpaid' | 'paid'>('all');

  const filtered = invoices
    .filter((i) => filter === 'all' || (filter === 'paid' ? !!i.paid_at : !i.paid_at))
    .sort((a, b) => b.invoice_date.localeCompare(a.invoice_date));

  const outstanding = useMemo(
    () => invoices.filter((i) => !i.paid_at).reduce((s, i) => s + Number(i.net_amount), 0),
    [invoices],
  );

  return (
    <Screen>
      <Card style={{ borderColor: outstanding > 0 ? C.accent : C.border }}>
        <KV k="Kintlévőség összesen (nettó)" v={ft(outstanding)} strong />
        <Sub>Számlázva, de még nem folyt be.</Sub>
      </Card>
      <Segmented
        options={[
          { value: 'all', label: 'Mind' },
          { value: 'unpaid', label: 'Kintlévő' },
          { value: 'paid', label: 'Befolyt' },
        ]}
        value={filter}
        onChange={setFilter}
      />
      {filtered.length === 0 ? <Empty text="Nincs számla ebben a szűrésben." /> : null}
      {filtered.map((i) => (
        <Row key={i.id} onPress={() => router.push(`/invoice/${i.id}`)}>
          <View style={{ flex: 1 }}>
            <Body style={{ fontWeight: '600' }}>{i.title || 'Számla'}</Body>
            <Sub>{sites.find((s) => s.id === i.site_id)?.name ?? '?'} · {hd(i.invoice_date)}</Sub>
          </View>
          <View style={{ alignItems: 'flex-end', gap: 2 }}>
            <Text style={{ fontWeight: '700' }}>{ft(i.net_amount)}</Text>
            <Badge text={i.paid_at ? `befolyt ${hd(i.paid_at)}` : 'kintlévő'} color={i.paid_at ? C.success : C.warning} />
          </View>
        </Row>
      ))}
      <Btn title="+ Új kimenő számla" kind="secondary" onPress={() => router.push('/invoice/new')} />
    </Screen>
  );
}
