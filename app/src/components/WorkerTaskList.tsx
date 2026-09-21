// Munkavállalói feladatlista: állapot-szűrő (elfogadásra vár / folyamatban /
// lezárt) és helyszín-szűrő — utóbbi csak akkor, ha több helyszíne is van.

import React, { useMemo, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { Sub, Empty } from '../ui/kit';
import { C, S } from '../ui/theme';
import { useTable } from '../lib/hooks';
import { isActiveTask, myQuote } from '../lib/tasks';
import { getCurrentUserId } from '../lib/repo';
import { TaskRow, STATUS_COLOR } from './TaskRow';
import { WorkerTask, TaskAssignee, TaskMaterial, TaskQuote, WorkSession, Worker, Site, Profile } from '../lib/types';

type Filter = 'quote' | 'assigned' | 'acknowledged' | 'closed';

function Chip({ label, count, color, on, onPress }: { label: string; count?: number; color?: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={{
      flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999,
      backgroundColor: on ? C.primary : C.chipBg, borderWidth: color && !on ? 1 : 0, borderColor: color ?? 'transparent',
    }}>
      <Text style={{ fontSize: 12, fontWeight: '700', color: on ? '#fff' : C.text }}>{label}</Text>
      {count != null ? <Text style={{ fontSize: 12, fontWeight: '800', color: on ? '#fff' : (color ?? C.sub) }}>{count}</Text> : null}
    </Pressable>
  );
}

export function WorkerTaskList({ tasks, showClosed = false, initialFilter = null }: { tasks: WorkerTask[]; showClosed?: boolean; initialFilter?: Filter | null }) {
  const assignees = useTable<TaskAssignee>('task_assignees');
  const materials = useTable<TaskMaterial>('task_materials');
  const sessions = useTable<WorkSession>('work_sessions');
  const workers = useTable<Worker>('workers');
  const sites = useTable<Site>('sites');
  const quotes = useTable<TaskQuote>('task_quotes');
  const wid = useTable<Profile>('profiles').find((p) => p.id === getCurrentUserId())?.worker_id ?? null;
  // ajánlatkérős feladat: a saját ajánlat-sorom állapota dönt (kérés vagy beküldött → „ajánlat” fül)
  const isQuoteOpen = (t: WorkerTask) => { const q = myQuote(t.id, wid, quotes); return !!q && (q.status === 'requested' || q.status === 'submitted'); };
  // saját elfogadás szerint (több emberes feladatnál a feladat állapota a többiekre is vár)
  const ackedByMe = (t: WorkerTask) => assignees.some((a) => a.task_id === t.id && a.worker_id === wid && a.acknowledged_at);
  // a munkavállaló csak a futó feladatait látja — a lezártakat (kész / nem sikerült / visszavont) nem
  tasks = tasks.filter(isActiveTask); showClosed = false;
  const [filter, setFilter] = useState<Filter | null>(initialFilter);
  const [siteId, setSiteId] = useState<string | null>(null);

  const running = new Set(sessions.filter((s) => !s.ended_at && s.task_id).map((s) => s.task_id as string));
  const counts = {
    quote: tasks.filter((t) => isActiveTask(t) && isQuoteOpen(t)).length,
    assigned: tasks.filter((t) => isActiveTask(t) && !ackedByMe(t) && !isQuoteOpen(t)).length,
    acknowledged: tasks.filter((t) => isActiveTask(t) && ackedByMe(t)).length,
    closed: tasks.filter((t) => !isActiveTask(t)).length,
  };
  // helyszín-szűrő csak akkor, ha a feladatai több helyszínen vannak
  const siteIds = useMemo(() => Array.from(new Set(tasks.filter(isActiveTask).map((t) => t.site_id ?? ''))), [tasks]);
  const showSites = siteIds.length >= 2;
  const siteName = (id: string) => (id ? sites.find((s) => s.id === id)?.name ?? 'Ismeretlen' : 'Helyszín nélkül');

  const list = tasks
    .filter((t) => filter === null ? isActiveTask(t)
      : filter === 'closed' ? !isActiveTask(t)
      : filter === 'quote' ? isActiveTask(t) && isQuoteOpen(t)
      : filter === 'assigned' ? isActiveTask(t) && !ackedByMe(t) && !isQuoteOpen(t)
      : isActiveTask(t) && ackedByMe(t))
    .filter((t) => siteId === null || (t.site_id ?? '') === siteId)
    // rögzítés dátuma szerint, a legfrissebb elöl
    .sort((a, b) => b.created_at.localeCompare(a.created_at));

  return (
    <View style={{ gap: S.sm }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        <Chip label="Aktív" count={counts.quote + counts.assigned + counts.acknowledged} on={filter === null} onPress={() => setFilter(null)} />
        {counts.quote > 0 ? <Chip label="💬 Ajánlat" count={counts.quote} color={C.primary} on={filter === 'quote'} onPress={() => setFilter(filter === 'quote' ? null : 'quote')} /> : null}
        <Chip label="Elfogadásra vár" count={counts.assigned} color={STATUS_COLOR.assigned} on={filter === 'assigned'} onPress={() => setFilter(filter === 'assigned' ? null : 'assigned')} />
        <Chip label="Folyamatban" count={counts.acknowledged} color={STATUS_COLOR.acknowledged} on={filter === 'acknowledged'} onPress={() => setFilter(filter === 'acknowledged' ? null : 'acknowledged')} />
        {showClosed ? <Chip label="Lezárt" count={counts.closed} on={filter === 'closed'} onPress={() => setFilter(filter === 'closed' ? null : 'closed')} /> : null}
      </View>
      {showSites ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          <Text style={{ fontSize: 12, color: C.sub, fontWeight: '600' }}>Helyszín:</Text>
          <Chip label="Mind" on={siteId === null} onPress={() => setSiteId(null)} />
          {siteIds.map((sid) => (
            <Chip key={sid || 'none'} label={`📍 ${siteName(sid)}`} on={siteId === sid} onPress={() => setSiteId(siteId === sid ? null : sid)} />
          ))}
        </View>
      ) : null}
      {list.length === 0 ? <Empty text={filter === 'closed' ? 'Nincs lezárt feladatod.' : 'Nincs ilyen feladatod.'} /> : null}
      <View style={{ gap: 6 }}>
        {list.map((t) => (
          <TaskRow key={t.id} task={t} assignees={assignees.filter((a) => a.task_id === t.id)} quotes={quotes} myWorkerId={wid}
            materials={materials.filter((m) => m.task_id === t.id)} workers={workers} sites={sites} running={running.has(t.id)} />
        ))}
      </View>
      {filter === null && counts.assigned > 0 ? <Sub style={{ color: C.warning }}>⚠️ Van el nem fogadott feladatod — nyisd meg, és fogadd el.</Sub> : null}
    </View>
  );
}
