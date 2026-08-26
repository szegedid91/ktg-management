import React, { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { Screen, Card, H2, Sub, Btn, Row, Body, Money, Badge, Empty, Segmented } from '../../ui/kit';
import { C } from '../../ui/theme';
import { useTable, useOnlineView } from '../../lib/hooks';
import { fetchView } from '../../lib/repo';
import { ft } from '../../lib/format';
import { Site, SiteTotals } from '../../lib/types';

export default function Sites() {
  const sites = useTable<Site>('sites');
  const [filter, setFilter] = useState<'active' | 'closed' | 'all'>('active');
  const totals = useOnlineView<SiteTotals[]>('site_totals', () => fetchView('v_site_totals'), []);

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
