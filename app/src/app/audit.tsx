import React, { useMemo, useState } from 'react';
import { View, Text } from 'react-native';
import { Screen, Card, Sub, Body, Btn, Empty, Segmented, Picker, Loading } from '../ui/kit';
import { C, S } from '../ui/theme';
import { useTable, useOnlineView } from '../lib/hooks';
import { fetchView } from '../lib/repo';
import { hdt } from '../lib/format';
import { AuditLogRow, Profile, Site } from '../lib/types';

const TABLE_LABELS: Record<string, string> = {
  sites: 'Építkezés', expenses: 'Költség', expense_photos: 'Számlafotó',
  workers: 'Munkavállaló', external_people: 'Külsős személy', attendance: 'Jelenlét',
  comments: 'Komment', invoices: 'Számla', settlements: 'Elszámolás',
  equipment: 'Eszköz', equipment_moves: 'Eszközmozgatás', profiles: 'Profil',
  app_settings: 'Beállítások', expense_categories: 'Kategória',
};

const ACTION_LABELS: Record<string, string> = { INSERT: 'létrehozás', UPDATE: 'módosítás', DELETE: 'törlés' };

// a fontos mezők, amiknek a változását ember-olvashatóan mutatjuk
const SKIP_FIELDS = new Set(['updated_at', 'created_at', 'id', 'created_by']);

function diffSummary(row: AuditLogRow): string {
  if (row.action === 'INSERT' || !row.old_data || !row.new_data) return '';
  const changes: string[] = [];
  for (const key of Object.keys(row.new_data)) {
    if (SKIP_FIELDS.has(key)) continue;
    const oldV = JSON.stringify(row.old_data[key]);
    const newV = JSON.stringify(row.new_data[key]);
    if (oldV !== newV) changes.push(`${key}: ${oldV ?? '∅'} → ${newV ?? '∅'}`);
  }
  return changes.slice(0, 6).join('\n');
}

export default function Audit() {
  const profiles = useTable<Profile>('profiles');
  const [userFilter, setUserFilter] = useState<string | null>(null);
  const [tableFilter, setTableFilter] = useState<string | null>(null);
  const [limit, setLimit] = useState(50);

  const rows = useOnlineView<AuditLogRow[]>(
    `audit-${userFilter}-${tableFilter}-${limit}`,
    () => fetchView('audit_log', (q) => {
      let x = q.order('changed_at', { ascending: false }).limit(limit);
      if (userFilter) x = x.eq('changed_by', userFilter);
      if (tableFilter) x = x.eq('table_name', tableFilter);
      return x;
    }),
    [userFilter, tableFilter, limit],
  );

  const name = (id: string | null) => profiles.find((p) => p.id === id)?.display_name ?? 'rendszer';

  return (
    <Screen>
      <Sub>Minden létrehozás, módosítás és törlés naplózva — az adatbázis szintjén, megkerülhetetlenül.</Sub>
      <Picker
        label="Felhasználó"
        items={profiles}
        selectedId={userFilter}
        getId={(p) => p.id}
        getLabel={(p) => p.display_name}
        onSelect={setUserFilter}
        allowNull
        nullLabel="— mindenki —"
      />
      <Picker
        label="Terület"
        items={Object.entries(TABLE_LABELS).map(([k, v]) => ({ id: k, label: v }))}
        selectedId={tableFilter}
        getId={(i) => i.id}
        getLabel={(i) => i.label}
        onSelect={setTableFilter}
        allowNull
        nullLabel="— minden terület —"
      />

      {rows.loading ? <Loading /> : null}
      {rows.fromCache ? <Sub style={{ color: C.warning }}>⚠️ Offline — utolsó ismert napló.</Sub> : null}
      {(rows.data ?? []).length === 0 && !rows.loading ? <Empty text="Nincs naplóbejegyzés." /> : null}
      {(rows.data ?? []).map((r) => {
        const diff = diffSummary(r);
        return (
          <Card key={r.id} style={{ padding: S.md }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Body style={{ fontWeight: '700' }}>
                {TABLE_LABELS[r.table_name] ?? r.table_name} — {ACTION_LABELS[r.action]}
              </Body>
              <Sub>{hdt(r.changed_at)}</Sub>
            </View>
            <Sub>{name(r.changed_by)}</Sub>
            {r.action === 'INSERT' && r.new_data ? (
              <Text style={{ fontSize: 13, color: C.sub }} numberOfLines={2}>
                {String((r.new_data as any).name ?? (r.new_data as any).title ?? (r.new_data as any).body ?? '')}
              </Text>
            ) : null}
            {diff ? <Text style={{ fontSize: 12, color: C.sub, fontFamily: 'monospace' as any }}>{diff}</Text> : null}
          </Card>
        );
      })}
      {(rows.data ?? []).length >= limit ? (
        <Btn title="Több betöltése" kind="ghost" onPress={() => setLimit(limit + 50)} />
      ) : null}
    </Screen>
  );
}
