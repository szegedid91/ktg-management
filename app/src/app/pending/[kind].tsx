// Függő kifizetések: kifizetetlen bérek vagy közvetítői díjak,
// építkezésenként csoportosítva, tételes pipálással.

import React, { useMemo } from 'react';
import { View, Text } from 'react-native';
import { useLocalSearchParams, Stack } from 'expo-router';
import { Screen, Card, H2, Sub, Btn, KV, Divider, Empty, Check, Badge } from '../../ui/kit';
import { C, S } from '../../ui/theme';
import { useTable } from '../../lib/hooks';
import { markAttendancePaid, markCommissionPaid } from '../../lib/repo';
import { ft, hd } from '../../lib/format';
import { Attendance, Worker, Site, ExternalPerson } from '../../lib/types';

interface Item {
  id: string;
  date: string;
  amount: number;
  detail: string;
}

interface PersonGroup {
  key: string;
  name: string;
  items: Item[];
  total: number;
}

interface SiteGroup {
  siteId: string;
  siteName: string;
  persons: PersonGroup[];
  total: number;
}

export default function PendingScreen() {
  const { kind } = useLocalSearchParams<{ kind: string }>();
  const isWages = kind !== 'commissions';
  const attendance = useTable<Attendance>('attendance');
  const workers = useTable<Worker>('workers');
  const sites = useTable<Site>('sites');
  const externals = useTable<ExternalPerson>('external_people');

  const groups = useMemo<SiteGroup[]>(() => {
    const bySite = new Map<string, Map<string, PersonGroup>>();

    for (const a of attendance) {
      let personKey: string; let personName: string;
      let amount: number; let detail: string;

      if (isWages) {
        const workerPart = Number(a.amount) - Number(a.commission_amount);
        if (a.pay_basis === 'presence' || a.paid_at || workerPart <= 0) continue;
        const w = workers.find((x) => x.id === a.worker_id);
        personKey = a.worker_id;
        personName = w?.name ?? '?';
        amount = workerPart;
        detail = a.pay_basis === 'hourly' ? `${a.hours} ó × ${ft(Number(a.applied_rate))}`
          : a.pay_basis === 'daily' ? (Number(a.day_multiplier) === 0.5 ? 'fél nap' : 'napi díj')
          : 'projektdíj';
        if (Number(a.commission_amount) > 0) detail += ` (bérrész, közvetítői nélkül)`;
      } else {
        if (!a.referrer_external_id || Number(a.commission_amount) <= 0 || a.commission_paid_at) continue;
        const ep = externals.find((x) => x.id === a.referrer_external_id);
        const w = workers.find((x) => x.id === a.worker_id);
        personKey = a.referrer_external_id;
        personName = ep?.name ?? '?';
        amount = Number(a.commission_amount);
        detail = `${w?.name ?? '?'} után`;
      }

      let persons = bySite.get(a.site_id);
      if (!persons) { persons = new Map(); bySite.set(a.site_id, persons); }
      let pg = persons.get(personKey);
      if (!pg) { pg = { key: personKey, name: personName, items: [], total: 0 }; persons.set(personKey, pg); }
      pg.items.push({ id: a.id, date: a.work_date, amount, detail });
      pg.total += amount;
    }

    return [...bySite.entries()]
      .map(([siteId, persons]) => {
        const list = [...persons.values()]
          .map((p) => ({ ...p, items: p.items.sort((a, b) => a.date.localeCompare(b.date)) }))
          .sort((a, b) => b.total - a.total);
        return {
          siteId,
          siteName: sites.find((s) => s.id === siteId)?.name ?? '?',
          persons: list,
          total: list.reduce((s, p) => s + p.total, 0),
        };
      })
      .sort((a, b) => b.total - a.total);
  }, [attendance, workers, sites, externals, isWages]);

  const grandTotal = groups.reduce((s, g) => s + g.total, 0);
  const payItems = (ids: string[]) => isWages ? markAttendancePaid(ids, true) : markCommissionPaid(ids, true);

  return (
    <Screen>
      <Stack.Screen options={{ title: isWages ? 'Kifizetetlen bérek' : 'Kifizetetlen közvetítői díjak' }} />

      <Card style={{ borderColor: grandTotal > 0 ? C.accent : C.border }}>
        <KV k={isWages ? 'Összes kifizetetlen bér (nettó)' : 'Összes kifizetetlen közvetítői díj'} v={ft(grandTotal)} strong />
        <Sub>A pipa rögzíti, hogy ki és mikor fizette — ez a te egyenlegedet terheli.</Sub>
      </Card>

      {groups.length === 0 ? <Empty text="Nincs függő tétel. ✅" /> : null}

      {groups.map((g) => (
        <Card key={g.siteId}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <H2>🏗️ {g.siteName}</H2>
            <Text style={{ fontWeight: '800', fontSize: 16 }}>{ft(g.total)}</Text>
          </View>
          <Divider />
          {g.persons.map((p) => (
            <View key={p.key} style={{ gap: 4, paddingVertical: 6 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm }}>
                <Text style={{ fontWeight: '700', fontSize: 15, color: C.text, flex: 1 }}>
                  {isWages ? '👷' : '🤝'} {p.name}
                </Text>
                <Badge text={`${p.items.length} nap`} />
                <Text style={{ fontWeight: '700' }}>{ft(p.total)}</Text>
              </View>
              {p.items.map((it) => (
                <View key={it.id} style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm, paddingLeft: S.md }}>
                  <View style={{ flex: 1 }}>
                    <Check
                      checked={false}
                      onToggle={() => payItems([it.id])}
                      label={`${hd(it.date)} — ${ft(it.amount)}`}
                      sub={it.detail}
                    />
                  </View>
                </View>
              ))}
              <View style={{ paddingLeft: S.md }}>
                <Btn
                  title={`${p.name}: mind kifizetve (${ft(p.total)})`}
                  kind="secondary"
                  small
                  onPress={() => payItems(p.items.map((i) => i.id))}
                />
              </View>
            </View>
          ))}
        </Card>
      ))}
    </Screen>
  );
}
