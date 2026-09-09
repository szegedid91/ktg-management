// Értesítések: olvasatlanok kiemelve; koppintásra a tételre ugrik és
// olvasottnak jelöl; „Mind olvasott” gomb.
import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { router } from 'expo-router';
import { Screen, Sub, Btn, Empty } from '../ui/kit';
import { C, S } from '../ui/theme';
import { useTable } from '../lib/hooks';
import { updateRow } from '../lib/repo';
import { hdt } from '../lib/format';
import { AppNotification } from '../lib/types';

function targetOf(n: AppNotification): string | null {
  const p = n.payload ?? {};
  if (p.task_id) return `/task/${p.task_id}`;
  if (p.site_id) return `/site/${p.site_id}`;
  if (p.worker_id) return `/worker/${p.worker_id}`;
  if (p.expense_id) return `/expense/${p.expense_id}`;
  if (p.request_id) return '/settings';
  if (p.entity_type && p.entity_id) {
    const map: Record<string, string> = { site: '/site/', expense: '/expense/', invoice: '/invoice/', worker: '/worker/' };
    return map[p.entity_type] ? `${map[p.entity_type]}${p.entity_id}` : null;
  }
  return null;
}

export default function Notifications() {
  // csak az olvasatlanok látszanak; koppintásra olvasott lesz és eltűnik
  const notes = [...useTable<AppNotification>('notification_queue')]
    .filter((n) => !n.read_at)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const markRead = (n: AppNotification) => updateRow('notification_queue', String(n.id), { read_at: new Date().toISOString() });

  return (
    <Screen>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Sub>{notes.length ? `${notes.length} olvasatlan — koppintásra olvasott lesz.` : 'Nincs új értesítésed.'}</Sub>
        {notes.length > 1 ? <Btn title="Mind olvasott" kind="ghost" small onPress={() => notes.forEach(markRead)} /> : null}
      </View>
      {notes.length === 0 ? <Empty text="Nincs új értesítés." /> : null}
      <View style={{ gap: 6 }}>
        {notes.slice(0, 200).map((n) => {
          const to = targetOf(n);
          return (
            <Pressable key={n.id} onPress={() => { markRead(n); if (to) router.push(to as any); }}
              style={({ pressed }) => ({
                backgroundColor: C.card, borderRadius: S.radiusSm, borderWidth: 1,
                borderColor: C.border, padding: S.md, gap: 2, opacity: pressed ? 0.8 : 1,
              })}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: S.sm }}>
                <Text style={{ fontWeight: '800', color: C.text, flex: 1 }} numberOfLines={1}>{n.title}</Text>
                <Text style={{ fontSize: 11, color: C.sub }}>{hdt(n.created_at)}</Text>
              </View>
              <Text style={{ fontSize: 13, color: C.text }}>{n.body}</Text>
              {to ? <Text style={{ fontSize: 11, color: C.primary }}>Megnyitás ›</Text> : null}
            </Pressable>
          );
        })}
      </View>
    </Screen>
  );
}
