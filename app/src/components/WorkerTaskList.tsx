// Munkavállalói feladatlista: állapot-szűrő (elfogadásra vár / folyamatban /
// lezárt) és helyszín-szűrő — utóbbi csak akkor, ha több helyszíne is van.

import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { Sub, Empty } from '../ui/kit';
import { C, S } from '../ui/theme';
import { useTable } from '../lib/hooks';
import { isOpenForWorker, myQuote } from '../lib/tasks';
import { workerDoneDays } from '../lib/sync';
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

export function WorkerTaskList({ tasks, showClosed = false, initialFilter = null, initialWho = null }: {
  tasks: WorkerTask[]; showClosed?: boolean; initialFilter?: Filter | null;
  /** vállalkozónál: melyik emberének a feladatai (munkavállaló-azonosító), 'me' = a sajátjaim */
  initialWho?: string | null;
}) {
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
  // kész a munkavállalónak: a saját részét készre jelentette (a többiek még dolgozhatnak rajta), vagy a vezető
  // lezárta — a szerver csak a beállított ideig (alap: 35 nap) adja ki; a visszavont / lezárt-sikertelen nem látszik
  const myDoneAt = (t: WorkerTask) => assignees.find((a) => a.task_id === t.id && a.worker_id === wid && a.done_at)?.done_at ?? null;
  const all = tasks;
  const done = showClosed
    ? all.filter((t) => (t.status === 'done' || isOpenForWorker(t)) && (!!myDoneAt(t) || t.status === 'done'))
      .sort((a, b) => String(myDoneAt(b) ?? b.done_at ?? '').localeCompare(String(myDoneAt(a) ?? a.done_at ?? '')))
    : [];
  const doneIds = new Set(done.map((t) => t.id));
  // a futó listákban csak a nyitott feladatok vannak (futó + nem sikerült, ami folytatható), amelyeken a saját rész még nincs kész
  tasks = all.filter((t) => isOpenForWorker(t) && !doneIds.has(t.id) && !myDoneAt(t));
  const doneDays = workerDoneDays();
  const [filter, setFilter] = useState<Filter | null>(initialFilter);
  // a kezdőlapról érkező hivatkozás (pl. „Kész feladataim”) a már nyitott listán is átváltson
  useEffect(() => { setFilter(initialFilter); }, [initialFilter]);
  const [siteId, setSiteId] = useState<string | null>(null);
  // vállalkozó: az embereim — emberenként szűrhető, kinek mi van kiosztva („Én” = amin én is rajta vagyok)
  const crew = workers.filter((w) => !!wid && w.contractor_id === wid).sort((a, b) => a.name.localeCompare(b.name, 'hu'));
  const [who, setWho] = useState<string | null>(initialWho);
  useEffect(() => { setWho(initialWho); }, [initialWho]);
  const onWho = (t: WorkerTask) => who === null ? true
    : who === 'me' ? !assignees.some((a) => a.task_id === t.id && crew.some((c) => c.id === a.worker_id))
    : assignees.some((a) => a.task_id === t.id && a.worker_id === who);
  const whoCount = (id: string | 'me') => tasks.filter((t) => isOpenForWorker(t) && (id === 'me'
    ? !assignees.some((a) => a.task_id === t.id && crew.some((c) => c.id === a.worker_id))
    : assignees.some((a) => a.task_id === t.id && a.worker_id === id))).length;

  const running = new Set(sessions.filter((s) => !s.ended_at && s.task_id).map((s) => s.task_id as string));
  const counts = {
    quote: tasks.filter((t) => isOpenForWorker(t) && isQuoteOpen(t)).length,
    assigned: tasks.filter((t) => isOpenForWorker(t) && !ackedByMe(t) && !isQuoteOpen(t)).length,
    acknowledged: tasks.filter((t) => isOpenForWorker(t) && ackedByMe(t)).length,
    closed: done.length,
  };
  // helyszín-szűrő csak akkor, ha a feladatai több helyszínen vannak
  const siteIds = useMemo(() => Array.from(new Set(tasks.filter(isOpenForWorker).map((t) => t.site_id ?? ''))), [tasks]);
  const showSites = siteIds.length >= 2;
  const siteName = (id: string) => (id ? sites.find((s) => s.id === id)?.name ?? 'Ismeretlen' : 'Helyszín nélkül');

  const list = filter === 'closed' ? done.filter((t) => siteId === null || (t.site_id ?? '') === siteId).filter(onWho) : tasks
    .filter((t) => filter === null ? isOpenForWorker(t)
      : filter === 'quote' ? isOpenForWorker(t) && isQuoteOpen(t)
      : filter === 'assigned' ? isOpenForWorker(t) && !ackedByMe(t) && !isQuoteOpen(t)
      : isOpenForWorker(t) && ackedByMe(t))
    .filter((t) => siteId === null || (t.site_id ?? '') === siteId)
    .filter(onWho)
    // rögzítés dátuma szerint, a legfrissebb elöl
    .sort((a, b) => b.created_at.localeCompare(a.created_at));

  return (
    <View style={{ gap: S.sm }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        <Chip label="Aktív" count={counts.quote + counts.assigned + counts.acknowledged} on={filter === null} onPress={() => setFilter(null)} />
        {counts.quote > 0 ? <Chip label="💬 Ajánlat" count={counts.quote} color={C.primary} on={filter === 'quote'} onPress={() => setFilter(filter === 'quote' ? null : 'quote')} /> : null}
        <Chip label="Elfogadásra vár" count={counts.assigned} color={STATUS_COLOR.assigned} on={filter === 'assigned'} onPress={() => setFilter(filter === 'assigned' ? null : 'assigned')} />
        <Chip label="Folyamatban" count={counts.acknowledged} color={STATUS_COLOR.acknowledged} on={filter === 'acknowledged'} onPress={() => setFilter(filter === 'acknowledged' ? null : 'acknowledged')} />
        {showClosed ? <Chip label="✔ Kész" count={counts.closed} color={STATUS_COLOR.done} on={filter === 'closed'} onPress={() => setFilter(filter === 'closed' ? null : 'closed')} /> : null}
      </View>
      {crew.length > 0 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          <Text style={{ fontSize: 12, color: C.sub, fontWeight: '600' }}>👥 Kinél:</Text>
          <Chip label="Mind" on={who === null} onPress={() => setWho(null)} />
          <Chip label="Csak nálam" count={whoCount('me')} on={who === 'me'} onPress={() => setWho(who === 'me' ? null : 'me')} />
          {crew.map((c) => (
            <Chip key={c.id} label={c.name} count={whoCount(c.id)} on={who === c.id} onPress={() => setWho(who === c.id ? null : c.id)} />
          ))}
        </View>
      ) : null}
      {showSites ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          <Text style={{ fontSize: 12, color: C.sub, fontWeight: '600' }}>Helyszín:</Text>
          <Chip label="Mind" on={siteId === null} onPress={() => setSiteId(null)} />
          {siteIds.map((sid) => (
            <Chip key={sid || 'none'} label={`📍 ${siteName(sid)}`} on={siteId === sid} onPress={() => setSiteId(siteId === sid ? null : sid)} />
          ))}
        </View>
      ) : null}
      {filter === 'closed' ? <Sub>Az elmúlt {doneDays} napban elkészült feladataid — csak megnézni lehet őket.</Sub> : null}
      {list.length === 0 ? <Empty text={filter === 'closed' ? 'Nincs kész feladatod ebben az időszakban.' : 'Nincs ilyen feladatod.'} /> : null}
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
