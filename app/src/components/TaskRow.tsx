// Kompakt, egysoros feladat-sor: sok (100+) feladatnál is átlátható telefonon.
// Bal színcsík = állapot; 1. sor kód · cím; 2. sor helyszín · emberek · anyag · fut.

import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { router } from 'expo-router';
import { C, S } from '../ui/theme';
import { ft, todayISO } from '../lib/format';
import { wname, quoteLabel, isOverdue } from '../lib/tasks';
import { WorkerTask, TaskAssignee, TaskMaterial, TaskMaterialPricing, TaskQuote, Worker, Site } from '../lib/types';

export const STATUS_COLOR: Record<string, string> = {
  assigned: '#B7791F', acknowledged: '#2B6CB0', done: '#2F855A', failed: '#C53030', cancelled: '#718096',
};
export const STATUS_SHORT: Record<string, string> = {
  assigned: 'elfogadásra vár', acknowledged: 'folyamatban', done: 'kész', failed: 'nem sikerült', cancelled: 'visszavonva',
};

export function TaskRow({ task, assignees, materials, pricing = [], workers, sites, running, showSite = true, quotes = [], myWorkerId = null }: {
  task: WorkerTask; assignees: TaskAssignee[]; materials: TaskMaterial[]; pricing?: TaskMaterialPricing[];
  workers: Worker[]; sites: Site[]; running?: boolean; showSite?: boolean; quotes?: TaskQuote[]; myWorkerId?: string | null;
}) {
  const names = assignees.map((a) => wname(workers.find((w) => w.id === a.worker_id)));
  const acked = assignees.filter((a) => a.acknowledged_at).length;
  const site = sites.find((s) => s.id === task.site_id);
  const matCost = materials.reduce((s, m) => s + Number(m.amount), 0);
  const unpriced = materials.filter((m) => !pricing.some((p) => p.material_id === m.id)).length;
  const color = STATUS_COLOR[task.status] ?? C.sub;
  const quote = quoteLabel(task, quotes, myWorkerId);
  const overdue = isOverdue(task, todayISO());
  const status = quote ?? `${STATUS_SHORT[task.status]}${task.status === 'assigned' && assignees.length > 1 ? ` ${acked}/${assignees.length}` : ''}`;
  return (
    <Pressable
      onPress={() => router.push(`/task/${task.id}`)}
      style={({ pressed }) => ({
        backgroundColor: C.card, borderRadius: S.radiusSm, borderWidth: 1, borderColor: C.border,
        borderLeftWidth: 4, borderLeftColor: color, paddingVertical: 6, paddingHorizontal: S.md,
        opacity: pressed ? 0.8 : 1, gap: 1,
      })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Text style={{ fontWeight: '700', fontSize: 14, color: C.text, flex: 1 }} numberOfLines={1}>
          {task.priority ? '🆘 ' : ''}{task.code ? `${task.code} · ` : ''}{task.title}
        </Text>
        {running ? <Text style={{ fontSize: 11, color: C.success, fontWeight: '800' }}>● fut</Text> : null}
        {task.due_date && task.status !== 'done' && task.status !== 'cancelled' ? (
          <Text style={{ fontSize: 11, color: overdue ? C.danger : C.sub, fontWeight: overdue ? '800' : '600' }}>
            {overdue ? '⏰ késik' : `📅 ${task.due_date.slice(5).replace('-', '.')}`}
          </Text>
        ) : null}
        <Text style={{ fontSize: 11, color: quote ? C.primary : color, fontWeight: '700' }} numberOfLines={1}>{status}</Text>
      </View>
      <Text style={{ fontSize: 12, color: C.sub }} numberOfLines={1}>
        {showSite && site ? `📍 ${site.name} · ` : ''}👷 {names.join(', ') || '—'}
        {matCost > 0 ? ` · 📦 ${ft(matCost)}${unpriced ? ` (${unpriced} beárazandó)` : ''}` : ''}
      </Text>
    </Pressable>
  );
}
