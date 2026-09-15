// Feladatok csoportosítva: partnernél helyszín szerint (aktívak) + lezártak,
// vagy állapot szerint — csempékkel.

import React, { useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { Sub, Empty } from '../ui/kit';
import { C, S } from '../ui/theme';
import { useTable } from '../lib/hooks';
import { isActiveTask } from '../lib/tasks';
import { TaskRow } from './TaskRow';
import {
  WorkerTask, TaskAssignee, TaskMaterial, TaskMaterialPricing, TaskQuote, WorkSession, Worker, Site,
} from '../lib/types';

const STATUS_ORDER: WorkerTask['status'][] = ['assigned', 'acknowledged', 'done', 'failed', 'cancelled'];
const STATUS_TITLE: Record<string, string> = {
  assigned: '⏳ Elfogadásra vár', acknowledged: '🔧 Folyamatban', done: '✔️ Kész',
  failed: '⚠️ Nem sikerült', cancelled: '🚫 Visszavonva',
};

function Group({ title, count, children, collapsed: initial = false }: {
  title: string; count: number; children: React.ReactNode; collapsed?: boolean;
}) {
  const [open, setOpen] = useState(!initial);
  if (count === 0) return null;
  return (
    <View style={{ gap: S.sm }}>
      <Pressable onPress={() => setOpen(!open)} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ fontSize: 15, fontWeight: '800', color: C.text }}>{title} ({count})</Text>
        <Text style={{ color: C.sub }}>{open ? '▾' : '▸'}</Text>
      </Pressable>
      {open ? children : null}
    </View>
  );
}

/** mode: 'site' — helyszín szerinti csoportok (aktívak) + lezártak állapot szerint;
 *  'status' — csak állapot szerinti csoportok (pl. egy építkezésen belül). */
export function TaskGroups({ tasks, mode }: { tasks: WorkerTask[]; mode: 'site' | 'status' }) {
  const assignees = useTable<TaskAssignee>('task_assignees');
  const materials = useTable<TaskMaterial>('task_materials');
  const pricing = useTable<TaskMaterialPricing>('task_material_pricing');
  const sessions = useTable<WorkSession>('work_sessions');
  const workers = useTable<Worker>('workers');
  const sites = useTable<Site>('sites');
  const quotes = useTable<TaskQuote>('task_quotes');
  const running = new Set(sessions.filter((s) => !s.ended_at && s.task_id).map((s) => s.task_id as string));

  const tile = (t: WorkerTask) => (
    <TaskRow key={t.id} task={t} assignees={assignees.filter((a) => a.task_id === t.id)}
      materials={materials.filter((m) => m.task_id === t.id)} pricing={pricing} quotes={quotes}
      workers={workers} sites={sites} running={running.has(t.id)} showSite={mode === 'site' ? false : true} />
  );
  const byDate = (a: WorkerTask, b: WorkerTask) => b.created_at.localeCompare(a.created_at);

  if (tasks.length === 0) return <Empty text="Nincs feladat." />;
  const isUnassigned = (t: WorkerTask) => isActiveTask(t) && !assignees.some((a) => a.task_id === t.id);
  const unassigned = tasks.filter(isUnassigned).sort(byDate);

  if (mode === 'status') {
    return (
      <View style={{ gap: S.lg }}>
        <Group title="📋 Kiosztatlan" count={unassigned.length}>
          <View style={{ gap: S.sm }}>{unassigned.map(tile)}</View>
        </Group>
        {STATUS_ORDER.map((st) => {
          const list = tasks.filter((t) => t.status === st && !isUnassigned(t)).sort(byDate);
          return (
            <Group key={st} title={STATUS_TITLE[st]} count={list.length} collapsed={st === 'done' || st === 'cancelled'}>
              <View style={{ gap: S.sm }}>{list.map(tile)}</View>
            </Group>
          );
        })}
      </View>
    );
  }

  // helyszín szerint: aktív feladatok
  const active = tasks.filter((t) => isActiveTask(t) && !isUnassigned(t)).sort(byDate);
  const closed = tasks.filter((t) => !isActiveTask(t)).sort(byDate);
  const siteIds = Array.from(new Set(active.map((t) => t.site_id ?? '')));
  const siteName = (id: string) => (id ? sites.find((s) => s.id === id)?.name ?? 'Ismeretlen helyszín' : 'Helyszín nélkül');
  siteIds.sort((a, b) => siteName(a).localeCompare(siteName(b), 'hu'));

  return (
    <View style={{ gap: S.lg }}>
      <Group title="📋 Kiosztatlan" count={unassigned.length}>
        <View style={{ gap: S.sm }}>{unassigned.map(tile)}</View>
      </Group>
      {active.length === 0 && unassigned.length === 0 ? <Sub>Nincs aktív feladat.</Sub> : null}
      {siteIds.map((sid) => {
        const list = active.filter((t) => (t.site_id ?? '') === sid);
        return (
          <Group key={sid || 'none'} title={`🏗️ ${siteName(sid)}`} count={list.length}>
            <View style={{ gap: S.sm }}>{list.map(tile)}</View>
          </Group>
        );
      })}
      {STATUS_ORDER.filter((st) => st === 'done' || st === 'failed' || st === 'cancelled').map((st) => {
        const list = closed.filter((t) => t.status === st);
        return (
          <Group key={st} title={STATUS_TITLE[st]} count={list.length} collapsed>
            <View style={{ gap: S.sm }}>{list.map(tile)}</View>
          </Group>
        );
      })}
    </View>
  );
}
