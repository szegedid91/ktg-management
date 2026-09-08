// Feladat-csempe a kezdőlapra: kód/cím, ki adta ki, kiknek, anyag, állapot.

import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { router } from 'expo-router';
import { C, S } from '../ui/theme';
import { ft } from '../lib/format';
import { WorkerTask, TaskAssignee, TaskMaterial, Worker, Profile, Site } from '../lib/types';
import { wname } from '../lib/tasks';

const STATUS_COLOR: Record<string, string> = {
  assigned: '#B7791F', acknowledged: '#2B6CB0', done: '#2F855A', failed: '#C53030', cancelled: '#718096',
};
const STATUS_SHORT: Record<string, string> = {
  assigned: 'elfogadásra vár', acknowledged: 'folyamatban', done: 'kész', failed: 'nem sikerült', cancelled: 'visszavonva',
};

export function TaskTile({ task, assignees, materials, workers, profiles, sites, running }: {
  task: WorkerTask; assignees: TaskAssignee[]; materials: TaskMaterial[];
  workers: Worker[]; profiles: Profile[]; sites: Site[]; running?: boolean;
}) {
  const names = assignees.map((a) => wname(workers.find((w) => w.id === a.worker_id)));
  const acked = assignees.filter((a) => a.acknowledged_at).length;
  const creator = profiles.find((p) => p.id === task.created_by)?.display_name ?? '?';
  const site = sites.find((s) => s.id === task.site_id);
  const matCost = materials.reduce((s, m) => s + Number(m.amount), 0);
  const unpriced = materials.filter((m) => m.resale_net == null).length;
  const color = STATUS_COLOR[task.status] ?? C.sub;
  return (
    <Pressable
      onPress={() => router.push(`/task/${task.id}`)}
      style={({ pressed }) => ({
        backgroundColor: C.card, borderRadius: S.radius, borderWidth: 1, borderColor: C.border,
        borderLeftWidth: 5, borderLeftColor: color, padding: S.md, gap: 4, opacity: pressed ? 0.8 : 1,
        width: '100%',
      })}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ fontWeight: '800', fontSize: 15, color: C.text, flex: 1 }} numberOfLines={2}>
          {task.code ? `${task.code} · ` : ''}{task.title}
        </Text>
        {running ? <Text style={{ fontSize: 11, color: C.success, fontWeight: '700' }}>● fut</Text> : null}
      </View>
      <Text style={{ fontSize: 12, color: color, fontWeight: '700' }}>
        {STATUS_SHORT[task.status]}{task.status === 'assigned' && assignees.length > 1 ? ` (${acked}/${assignees.length})` : ''}
        {task.quote_requested && !task.quote_accepted_at ? (task.quote_amount != null ? ' · ajánlat elfogadásra vár' : ' · ajánlatra vár') : ''}
      </Text>
      <Text style={{ fontSize: 12, color: C.sub }}>👷 {names.join(', ') || '—'}</Text>
      <Text style={{ fontSize: 12, color: C.sub }}>Kiadta: {creator}{site ? ` · 📍 ${site.name}` : ''}</Text>
      {matCost > 0 ? (
        <Text style={{ fontSize: 12, color: unpriced ? C.warning : C.sub, fontWeight: '600' }}>
          📦 Anyag: {ft(matCost)}{unpriced ? ` · ${unpriced} beárazandó` : ''}
        </Text>
      ) : null}
    </Pressable>
  );
}
