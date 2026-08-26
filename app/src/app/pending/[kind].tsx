// Függő kifizetések: kifizetetlen bérek vagy közvetítői díjak,
// építkezésenként csoportosítva, tételes pipálással.

import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { useLocalSearchParams, Stack } from 'expo-router';
import { Screen, Card, H2, Sub, Btn, KV, Divider, Empty, Check, Badge, Input } from '../../ui/kit';
import { C, S } from '../../ui/theme';
import { useTable } from '../../lib/hooks';
import { markAttendancePaid, markCommissionPaid } from '../../lib/repo';
import { ft, hd } from '../../lib/format';
import { Attendance, Worker, Site, ExternalPerson } from '../../lib/types';

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        backgroundColor: on ? C.primary : C.chipBg,
        paddingHorizontal: S.md, paddingVertical: 7, borderRadius: 999,
      }}
    >
      <Text style={{ color: on ? '#fff' : C.text, fontSize: 13, fontWeight: '600' }}>
        {on ? '✓ ' : ''}{label}
      </Text>
    </Pressable>
  );
}

interface Item {
  id: string;
  date: string;
  amount: number;
  detail: string;
}

// a kijelölés 5 percig megmarad akkor is, ha a felhasználó elnavigál,
// majd visszatér erre a képernyőre
const SELECTION_TTL_MS = 5 * 60 * 1000;
const selectionCache = new Map<string, { ids: string[]; note: string; savedAt: number }>();
function restoreSelection(key: string) {
  const c = selectionCache.get(key);
  return c && Date.now() - c.savedAt < SELECTION_TTL_MS ? c : null;
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

  // terület-szűrő: üres kiválasztás = minden építkezés látszik
  const [siteFilter, setSiteFilter] = useState<Set<string>>(new Set());
  // ember-szűrő: üres kiválasztás = mindenki látszik
  const [personFilter, setPersonFilter] = useState<Set<string>>(new Set());
  // egyszerre csak egy ember napjai vannak nyitva; másik kinyitása bezárja az előzőt
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  // a pipa csak kijelöl — a kifizetés a "Kijelöltek kifizetése" gombbal történik;
  // a kijelölés 5 percig visszatölthető (lásd selectionCache)
  const cacheKey = isWages ? 'wages' : 'commissions';
  const [selected, setSelected] = useState<Set<string>>(() => new Set(restoreSelection(cacheKey)?.ids ?? []));
  const [payNote, setPayNote] = useState(() => restoreSelection(cacheKey)?.note ?? '');
  useEffect(() => {
    selectionCache.set(cacheKey, { ids: [...selected], note: payNote, savedAt: Date.now() });
  }, [selected, payNote, cacheKey]);

  const toggleIn = (set: Set<string>, setter: (s: Set<string>) => void, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id); else next.add(id);
    setter(next);
  };

  const siteFiltered = siteFilter.size === 0 ? groups : groups.filter((g) => siteFilter.has(g.siteId));

  // a szűrhető emberek listája (a terület-szűrés után)
  const personList = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of siteFiltered) for (const p of g.persons) m.set(p.key, p.name);
    return [...m.entries()].map(([key, name]) => ({ key, name }))
      .sort((a, b) => a.name.localeCompare(b.name, 'hu'));
  }, [siteFiltered]);

  const visibleGroups = useMemo(() => {
    // csak a jelenlegi terület-szűrés alatt létező emberek szűrője él;
    // a "beragadt" (itt nem dolgozó) kijelölés nem üresíti ki a listát
    const available = new Set(personList.map((p) => p.key));
    const effective = new Set([...personFilter].filter((k) => available.has(k)));
    return siteFiltered
      .map((g) => {
        const persons = effective.size === 0 ? g.persons : g.persons.filter((p) => effective.has(p.key));
        return { ...g, persons, total: persons.reduce((s, p) => s + p.total, 0) };
      })
      .filter((g) => g.persons.length > 0);
  }, [siteFiltered, personFilter, personList]);

  const grandTotal = visibleGroups.reduce((s, g) => s + g.total, 0);
  const isFiltered = siteFilter.size > 0 || personFilter.size > 0;

  // a lenti sáv csak az éppen nyitva lévő ember kijelölt tételeit mutatja
  // és fizeti ki — a többi ember kijelölése megmarad későbbre
  const openPerson = useMemo(() => {
    if (!expandedKey) return null;
    for (const g of groups) {
      for (const p of g.persons) {
        if (`${g.siteId}:${p.key}` === expandedKey) return p;
      }
    }
    return null;
  }, [groups, expandedKey]);

  const openItemIds = new Set((openPerson?.items ?? []).map((i) => i.id));
  const selectedIds = [...selected].filter((id) => openItemIds.has(id));
  const amountById = new Map((openPerson?.items ?? []).map((i) => [i.id, i.amount]));
  const selectedTotal = selectedIds.reduce((s, id) => s + (amountById.get(id) ?? 0), 0);

  const paySelected = () => {
    if (selectedIds.length === 0) return;
    if (isWages) markAttendancePaid(selectedIds, true, payNote);
    else markCommissionPaid(selectedIds, true, payNote);
    setSelected((prev) => {
      const next = new Set(prev);
      selectedIds.forEach((id) => next.delete(id));
      return next;
    });
    setPayNote('');
  };

  // kompakt kifizető sáv az alsó menüsor felett, két sorban
  const payFooter = selectedIds.length > 0 ? (
    <View style={{
      backgroundColor: C.card, borderTopWidth: 1, borderTopColor: C.primary,
      paddingHorizontal: S.lg, paddingVertical: 8, gap: 6,
    }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ fontWeight: '700', fontSize: 14, color: C.text }}>
          {openPerson?.name}: {selectedIds.length} tétel · {ft(selectedTotal)}
        </Text>
        <Text
          onPress={() => setSelected((prev) => {
            const next = new Set(prev);
            selectedIds.forEach((id) => next.delete(id));
            return next;
          })}
          style={{ color: C.sub, fontSize: 13, fontWeight: '600' }}
        >
          ✕ törlés
        </Text>
      </View>
      <View style={{ flexDirection: 'row', gap: S.sm, alignItems: 'center' }}>
        <View style={{ flex: 1 }}>
          <Input value={payNote} onChangeText={setPayNote} placeholder="Megjegyzés (nem kötelező)" />
        </View>
        <Btn title="✓ Kifizetés" small onPress={paySelected} />
      </View>
    </View>
  ) : undefined;

  return (
    <Screen footer={payFooter}>
      <Stack.Screen options={{ title: isWages ? 'Kifizetetlen bérek' : 'Kifizetetlen közvetítői díjak' }} />

      {groups.length > 0 ? (
        <Card>
          {groups.length > 1 ? (
            <>
              <Sub>Terület:</Sub>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S.sm }}>
                <Chip label="Mind" on={siteFilter.size === 0} onPress={() => setSiteFilter(new Set())} />
                {groups.map((g) => (
                  <Chip
                    key={g.siteId}
                    label={`${g.siteName} · ${ft(g.total)}`}
                    on={siteFilter.has(g.siteId)}
                    onPress={() => toggleIn(siteFilter, setSiteFilter, g.siteId)}
                  />
                ))}
              </View>
            </>
          ) : null}
          {personList.length > 1 ? (
            <>
              <Sub>{isWages ? 'Munkavállaló:' : 'Közvetítő:'}</Sub>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S.sm }}>
                <Chip label="Mindenki" on={personFilter.size === 0} onPress={() => setPersonFilter(new Set())} />
                {personList.map((p) => (
                  <Chip
                    key={p.key}
                    label={p.name}
                    on={personFilter.has(p.key)}
                    onPress={() => toggleIn(personFilter, setPersonFilter, p.key)}
                  />
                ))}
              </View>
            </>
          ) : null}
        </Card>
      ) : null}

      <Card style={{ borderColor: grandTotal > 0 ? C.accent : C.border }}>
        <KV
          k={(isWages ? 'Kifizetetlen bér' : 'Kifizetetlen közvetítői díj')
            + (isFiltered ? ' (szűrt)' : ' összesen')}
          v={ft(grandTotal)}
          strong
        />
        <Sub>A pipa kijelöli a tételeket — a kifizetést az alul megjelenő sáv gombja rögzíti.</Sub>
      </Card>

      {visibleGroups.length === 0 ? <Empty text="Nincs függő tétel. ✅" /> : null}

      {visibleGroups.map((g) => (
        <Card key={g.siteId}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <H2>🏗️ {g.siteName}</H2>
            <Text style={{ fontWeight: '800', fontSize: 16 }}>{ft(g.total)}</Text>
          </View>
          <Divider />
          {g.persons.map((p) => {
            const expKey = `${g.siteId}:${p.key}`;
            const isOpen = expandedKey === expKey;
            return (
              <View key={p.key} style={{ gap: 4, paddingVertical: 6 }}>
                <Pressable
                  onPress={() => setExpandedKey(isOpen ? null : expKey)}
                  style={({ pressed }) => ({
                    flexDirection: 'row', alignItems: 'center', gap: S.sm,
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <Text style={{ fontSize: 13, color: C.sub, width: 14 }}>{isOpen ? '▾' : '▸'}</Text>
                  <Text style={{ fontWeight: '700', fontSize: 15, color: C.text, flex: 1 }}>
                    {isWages ? '👷' : '🤝'} {p.name}
                  </Text>
                  <Badge text={`${p.items.length} nap`} />
                  {isOpen ? <Text style={{ fontWeight: '700' }}>{ft(p.total)}</Text> : null}
                </Pressable>
                {isOpen ? (
                  <>
                    {p.items.map((it) => (
                      <View key={it.id} style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm, paddingLeft: S.lg }}>
                        <View style={{ flex: 1 }}>
                          <Check
                            checked={selected.has(it.id)}
                            onToggle={() => toggleIn(selected, setSelected, it.id)}
                            label={`${hd(it.date)} — ${ft(it.amount)}`}
                            sub={it.detail}
                          />
                        </View>
                      </View>
                    ))}
                    <View style={{ paddingLeft: S.lg }}>
                      <Btn
                        title={p.items.every((i) => selected.has(i.id))
                          ? `${p.name}: kijelölés törlése`
                          : `${p.name}: mind kijelölése (${ft(p.total)})`}
                        kind="secondary"
                        small
                        onPress={() => {
                          const next = new Set(selected);
                          const all = p.items.every((i) => next.has(i.id));
                          p.items.forEach((i) => { if (all) next.delete(i.id); else next.add(i.id); });
                          setSelected(next);
                        }}
                      />
                    </View>
                  </>
                ) : null}
              </View>
            );
          })}
        </Card>
      ))}
    </Screen>
  );
}
