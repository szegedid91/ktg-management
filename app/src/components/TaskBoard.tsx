// Feladat-tábla sok feladathoz: állapot-számlálók (egyben szűrők), keresés,
// helyszín/munkavállaló szűrő, lista vagy helyszín szerinti csoportosítás,
// lapozás — telefonon is átlátható 100+ nyitott feladatnál.

import React, { useMemo, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { Sub, Btn, Input, Picker, Segmented } from '../ui/kit';
import { C, S } from '../ui/theme';
import { useTable } from '../lib/hooks';
import { isActiveTask, wname, openQuotes, isOverdue } from '../lib/tasks';
import { todayISO } from '../lib/format';
import { TaskRow, STATUS_COLOR } from './TaskRow';
import {
  WorkerTask, TaskAssignee, TaskMaterial, TaskMaterialPricing, TaskQuote, WorkSession, Worker, Site,
} from '../lib/types';

export type BoardFilter = 'active' | 'assigned' | 'acknowledged' | 'running' | 'unpriced' | 'priority' | 'quote' | 'overdue' | 'done' | 'failed' | 'all';
type Filter = BoardFilter;
const PAGE = 25;

function Chip({ label, count, color, on, onPress }: { label: string; count: number; color?: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={{
      flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999,
      backgroundColor: on ? C.primary : C.chipBg, borderWidth: color && !on ? 1 : 0, borderColor: color ?? 'transparent',
    }}>
      <Text style={{ fontSize: 12, fontWeight: '700', color: on ? '#fff' : C.text }}>{label}</Text>
      <Text style={{ fontSize: 12, fontWeight: '800', color: on ? '#fff' : (color ?? C.sub) }}>{count}</Text>
    </Pressable>
  );
}

export function TaskBoard({ tasks, includeClosed = false, initialFilter = 'active' }: { tasks: WorkerTask[]; includeClosed?: boolean; initialFilter?: BoardFilter }) {
  const assignees = useTable<TaskAssignee>('task_assignees');
  const materials = useTable<TaskMaterial>('task_materials');
  const pricing = useTable<TaskMaterialPricing>('task_material_pricing');
  const sessions = useTable<WorkSession>('work_sessions');
  const workers = useTable<Worker>('workers');
  const sites = useTable<Site>('sites');
  const quotes = useTable<TaskQuote>('task_quotes');
  const hasOpenQuote = (t: WorkerTask) => openQuotes(t.id, quotes).length > 0;

  const [filter, setFilter] = useState<Filter>(initialFilter);
  const [q, setQ] = useState('');
  const [siteId, setSiteId] = useState<string | null>(null);
  const [workerId, setWorkerId] = useState<string | null>(null);
  const [view, setView] = useState<'list' | 'site'>('list');
  const [limit, setLimit] = useState(PAGE);

  const running = useMemo(() => new Set(sessions.filter((s) => !s.ended_at && s.task_id).map((s) => s.task_id as string)), [sessions]);
  const unpricedTaskIds = useMemo(() => new Set(materials.filter((m) => !pricing.some((p) => p.material_id === m.id)).map((m) => m.task_id)), [materials, pricing]);
  const assigneesOf = (t: WorkerTask) => assignees.filter((a) => a.task_id === t.id);

  const active = tasks.filter(isActiveTask);
  const counts = {
    active: active.length,
    assigned: active.filter((t) => t.status === 'assigned').length,
    acknowledged: active.filter((t) => t.status === 'acknowledged').length,
    running: active.filter((t) => running.has(t.id)).length,
    unpriced: tasks.filter((t) => unpricedTaskIds.has(t.id)).length,
    priority: active.filter((t) => t.priority > 0).length,
    quote: active.filter(hasOpenQuote).length,
    overdue: active.filter((t) => isOverdue(t, todayISO())).length,
    done: tasks.filter((t) => t.status === 'done').length,
    failed: tasks.filter((t) => t.status === 'failed').length,
    all: tasks.length,
  };

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return tasks
      .filter((t) => {
        switch (filter) {
          case 'active': return isActiveTask(t);
          case 'assigned': return t.status === 'assigned';
          case 'acknowledged': return t.status === 'acknowledged';
          case 'running': return running.has(t.id);
          case 'unpriced': return unpricedTaskIds.has(t.id);
          case 'priority': return isActiveTask(t) && t.priority > 0;
          case 'quote': return isActiveTask(t) && hasOpenQuote(t);
          case 'overdue': return isOverdue(t, todayISO());
          case 'done': return t.status === 'done';
          case 'failed': return t.status === 'failed';
          default: return true;
        }
      })
      .filter((t) => !siteId || t.site_id === siteId)
      .filter((t) => !workerId || assigneesOf(t).some((a) => a.worker_id === workerId))
      .filter((t) => {
        if (!needle) return true;
        const names = assigneesOf(t).map((a) => wname(workers.find((w) => w.id === a.worker_id))).join(' ');
        const site = sites.find((s) => s.id === t.site_id)?.name ?? '';
        return `${t.code ?? ''} ${t.title} ${t.details ?? ''} ${names} ${site}`.toLowerCase().includes(needle);
      })
      .sort((a, b) => (b.priority - a.priority) || b.updated_at.localeCompare(a.updated_at));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, filter, q, siteId, workerId, assignees, running, unpricedTaskIds, workers, sites, quotes]);

  const row = (t: WorkerTask, showSite = true) => (
    <TaskRow key={t.id} task={t} assignees={assigneesOf(t)} materials={materials.filter((m) => m.task_id === t.id)}
      pricing={pricing} quotes={quotes} workers={workers} sites={sites} running={running.has(t.id)} showSite={showSite} />
  );

  const shown = filtered.slice(0, limit);
  const siteName = (id: string | null) => (id ? sites.find((s) => s.id === id)?.name ?? 'Ismeretlen helyszín' : 'Helyszín nélkül');
  const groups = view === 'site'
    ? Array.from(new Set(shown.map((t) => t.site_id ?? ''))).map((sid) => ({
        sid, name: siteName(sid || null), items: shown.filter((t) => (t.site_id ?? '') === sid),
      })).sort((a, b) => a.name.localeCompare(b.name, 'hu'))
    : [];

  return (
    <View style={{ gap: S.sm }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        <Chip label="Aktív" count={counts.active} on={filter === 'active'} onPress={() => { setFilter('active'); setLimit(PAGE); }} />
        <Chip label="Elfogadásra vár" count={counts.assigned} color={STATUS_COLOR.assigned} on={filter === 'assigned'} onPress={() => { setFilter('assigned'); setLimit(PAGE); }} />
        <Chip label="Folyamatban" count={counts.acknowledged} color={STATUS_COLOR.acknowledged} on={filter === 'acknowledged'} onPress={() => { setFilter('acknowledged'); setLimit(PAGE); }} />
        <Chip label="● Fut a munka" count={counts.running} color={C.success} on={filter === 'running'} onPress={() => { setFilter('running'); setLimit(PAGE); }} />
        {counts.priority > 0 ? <Chip label="🆘 SOS" count={counts.priority} color={C.danger} on={filter === 'priority'} onPress={() => { setFilter('priority'); setLimit(PAGE); }} /> : null}
        {counts.quote > 0 ? <Chip label="💬 Ajánlat" count={counts.quote} color={C.primary} on={filter === 'quote'} onPress={() => { setFilter('quote'); setLimit(PAGE); }} /> : null}
        {counts.overdue > 0 ? <Chip label="⏰ Késik" count={counts.overdue} color={C.danger} on={filter === 'overdue'} onPress={() => { setFilter('overdue'); setLimit(PAGE); }} /> : null}
        {counts.unpriced > 0 ? <Chip label="📦 Beárazandó" count={counts.unpriced} color={C.warning} on={filter === 'unpriced'} onPress={() => { setFilter('unpriced'); setLimit(PAGE); }} /> : null}
        {includeClosed ? (
          <>
            <Chip label="Kész" count={counts.done} color={STATUS_COLOR.done} on={filter === 'done'} onPress={() => { setFilter('done'); setLimit(PAGE); }} />
            <Chip label="Nem sikerült" count={counts.failed} color={STATUS_COLOR.failed} on={filter === 'failed'} onPress={() => { setFilter('failed'); setLimit(PAGE); }} />
            <Chip label="Mind" count={counts.all} on={filter === 'all'} onPress={() => { setFilter('all'); setLimit(PAGE); }} />
          </>
        ) : null}
      </View>

      <Input value={q} onChangeText={(v) => { setQ(v); setLimit(PAGE); }} placeholder="🔍 Keresés: kód, cím, ember, helyszín…" autoCapitalize="none" />

      <View style={{ flexDirection: 'row', gap: S.sm }}>
        <View style={{ flex: 1 }}>
          <Picker items={[...sites].sort((a, b) => a.name.localeCompare(b.name, 'hu'))} selectedId={siteId}
            getId={(s) => s.id} getLabel={(s) => s.name} onSelect={(id) => { setSiteId(id); setLimit(PAGE); }}
            placeholder="Minden helyszín" allowNull nullLabel="Minden helyszín" />
        </View>
        <View style={{ flex: 1 }}>
          <Picker items={[...workers].sort((a, b) => wname(a).localeCompare(wname(b), 'hu'))} selectedId={workerId}
            getId={(w) => w.id} getLabel={(w) => wname(w)} onSelect={(id) => { setWorkerId(id); setLimit(PAGE); }}
            placeholder="Minden ember" allowNull nullLabel="Minden ember" />
        </View>
      </View>

      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Sub>{filtered.length} feladat{filtered.length > shown.length ? ` (${shown.length} látszik)` : ''}</Sub>
        <Segmented options={[{ value: 'list', label: 'Lista' }, { value: 'site', label: 'Helyszín szerint' }]} value={view} onChange={setView} />
      </View>

      {filtered.length === 0 ? <Sub>Nincs a szűrésnek megfelelő feladat.</Sub> : null}

      {view === 'list'
        ? <View style={{ gap: 6 }}>{shown.map((t) => row(t))}</View>
        : groups.map((g) => (
            <View key={g.sid || 'none'} style={{ gap: 6 }}>
              <Text style={{ fontWeight: '800', color: C.text, marginTop: 4 }}>🏗️ {g.name} ({g.items.length})</Text>
              {g.items.map((t) => row(t, false))}
            </View>
          ))}

      {filtered.length > shown.length ? (
        <Btn title={`Több mutatása (${filtered.length - shown.length} további)`} kind="ghost" onPress={() => setLimit(limit + 50)} />
      ) : null}
    </View>
  );
}
