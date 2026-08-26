import React, { useMemo, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { router } from 'expo-router';
import { Screen, Card, Sub, Body, Btn, Row, Badge, Empty, Segmented, KV } from '../../ui/kit';
import { C, S } from '../../ui/theme';
import { useTable } from '../../lib/hooks';
import { ft, hd } from '../../lib/format';
import { Invoice, Site } from '../../lib/types';

export default function Invoices() {
  const invoices = useTable<Invoice>('invoices');
  const sites = useTable<Site>('sites');
  const [filter, setFilter] = useState<'all' | 'unpaid' | 'paid'>('all');
  // terület-szűrő: üres kiválasztás = minden építkezés
  const [siteFilter, setSiteFilter] = useState<Set<string>>(new Set());
  const toggleSite = (id: string) => {
    const next = new Set(siteFilter);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSiteFilter(next);
  };

  const invoiceSites = useMemo(() => {
    const ids = new Set(invoices.map((i) => i.site_id));
    return sites.filter((s) => ids.has(s.id)).sort((a, b) => a.name.localeCompare(b.name, 'hu'));
  }, [invoices, sites]);

  const siteFiltered = siteFilter.size === 0
    ? invoices
    : invoices.filter((i) => siteFilter.has(i.site_id));

  const filtered = siteFiltered
    .filter((i) => filter === 'all' || (filter === 'paid' ? !!i.paid_at : !i.paid_at))
    .sort((a, b) => b.invoice_date.localeCompare(a.invoice_date));

  const outstanding = useMemo(
    () => siteFiltered.filter((i) => !i.paid_at).reduce((s, i) => s + Number(i.net_amount), 0),
    [siteFiltered],
  );

  return (
    <Screen>
      {invoiceSites.length > 1 ? (
        <Card>
          <Sub>Terület — pipáld ki, amelyikre szűrni akarsz:</Sub>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S.sm }}>
            <Pressable
              onPress={() => setSiteFilter(new Set())}
              style={{
                backgroundColor: siteFilter.size === 0 ? C.primary : C.chipBg,
                paddingHorizontal: S.md, paddingVertical: 7, borderRadius: 999,
              }}
            >
              <Text style={{ color: siteFilter.size === 0 ? '#fff' : C.text, fontSize: 13, fontWeight: '600' }}>Mind</Text>
            </Pressable>
            {invoiceSites.map((s) => {
              const on = siteFilter.has(s.id);
              return (
                <Pressable
                  key={s.id}
                  onPress={() => toggleSite(s.id)}
                  style={{
                    backgroundColor: on ? C.primary : C.chipBg,
                    paddingHorizontal: S.md, paddingVertical: 7, borderRadius: 999,
                  }}
                >
                  <Text style={{ color: on ? '#fff' : C.text, fontSize: 13, fontWeight: '600' }}>
                    {on ? '✓ ' : ''}{s.name}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </Card>
      ) : null}

      <Card style={{ borderColor: outstanding > 0 ? C.accent : C.border }}>
        <KV k={`Kintlévőség${siteFilter.size > 0 ? ' (szűrt)' : ' összesen'} (nettó)`} v={ft(outstanding)} strong />
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
