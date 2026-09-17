import React, { useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Screen, Card, H2, Sub, Btn, Row, Body, Money, Badge, Empty, Segmented } from '../ui/kit';
import { C } from '../ui/theme';
import { useTable, useOnlineView, useIsWorker } from '../lib/hooks';
import { fetchView } from '../lib/repo';
import { ft, todayISO } from '../lib/format';
import { Site, SiteTotals, Expense } from '../lib/types';

function SitesInner() {
  const { filter: filterParam } = useLocalSearchParams<{ filter?: string }>();
  const sites = useTable<Site>('sites');
  const [filter, setFilter] = useState<'active' | 'closed' | 'all'>(
    filterParam === 'closed' ? 'closed' : filterParam === 'all' ? 'all' : 'active',
  );
  const totals = useOnlineView<SiteTotals[]>('site_totals', () => fetchView('v_site_totals'), []);
  // területhez nem kötött (közös) költségek — külön listájuk van
  const commonExpenses = useTable<Expense>('expenses').filter((e) => !e.site_id);
  const commonTotal = commonExpenses.reduce((s, e) => s + Number(e.net_amount), 0);

  const filtered = sites
    .filter((s) => filter === 'all' || s.status === filter)
    .sort((a, b) => a.name.localeCompare(b.name, 'hu'));

  return (
    <Screen>
      <Segmented
        options={[
          { value: 'active', label: 'Aktív' },
          { value: 'closed', label: 'Lezárt' },
          { value: 'all', label: 'Mind' },
        ]}
        value={filter}
        onChange={setFilter}
      />
      <Btn title="👷 + Jelenlét rögzítése (ma)" kind="secondary" onPress={() => router.push(`/day/${todayISO()}`)} />
      {commonExpenses.length > 0 ? (
        <Row onPress={() => router.push('/expenses/common')}>
          <View style={{ flex: 1 }}>
            <Body style={{ fontWeight: '700' }}>🧰 Közös költségek</Body>
            <Sub>{commonExpenses.length} tétel · {ft(commonTotal)} nettó — területhez nem kötött (pl. üzemanyag)</Sub>
          </View>
          <Badge text="közös" color={C.primary} />
        </Row>
      ) : null}
      {filtered.length === 0 ? <Empty text="Nincs építkezés ebben a szűrésben." /> : null}
      {filtered.map((s) => {
        const t = totals.data?.find((x) => x.site_id === s.id);
        return (
          <Row key={s.id} onPress={() => router.push(`/site/${s.id}`)}>
            <View style={{ flex: 1 }}>
              <Body style={{ fontWeight: '700' }}>{s.name}</Body>
              {s.address ? <Sub>{s.address}</Sub> : null}
              {t ? (
                <Sub>
                  Költség: {ft(t.cost_net)} · Befolyt: {ft(t.paid_net)}
                  {Number(t.outstanding_net) > 0 ? ` · Kintlévő: ${ft(t.outstanding_net)}` : ''}
                </Sub>
              ) : null}
            </View>
            <Badge
              text={s.status === 'active' ? 'aktív' : 'lezárt'}
              color={s.status === 'active' ? C.success : C.sub}
            />
          </Row>
        );
      })}
      <Btn title="+ Új építkezés" kind="secondary" onPress={() => router.push('/site/new')} />
    </Screen>
  );
}

/** Fő felhasználói oldal: munkavállalói fiók nem nyithatja meg (a hookok
 *  sorrendje miatt külön burkolóban, nem a komponensen belüli korai visszatéréssel). */
export default function Sites() {
  if (useIsWorker()) return <Screen><Empty text="Ez az oldal a fő felhasználóknak szól." /></Screen>;
  return <SitesInner />;
}
