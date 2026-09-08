// Munkavállalói kezdőlap: futó munkaidő, feladatok csempéken, saját napok.

import React, { useMemo } from 'react';
import { View, Text } from 'react-native';
import { Screen, Card, H2, Sub, Body, Btn, Row, Badge, Empty } from '../ui/kit';
import { C, S } from '../ui/theme';
import { useTable } from '../lib/hooks';
import { insertRow, updateRow } from '../lib/repo';
import { ft, hd, hdt } from '../lib/format';
import { isActiveTask, fmtHours, sessionHours, wname } from '../lib/tasks';
import { TaskTile } from './TaskTile';
import {
  Profile, Worker, WorkerTask, TaskAssignee, TaskMaterial, WorkSession, Site, Attendance,
} from '../lib/types';

export function WorkerHome({ profile }: { profile: Profile }) {
  const wid = profile.worker_id!;
  const workers = useTable<Worker>('workers');
  const profiles = useTable<Profile>('profiles');
  const sites = useTable<Site>('sites');
  const tasks = useTable<WorkerTask>('worker_tasks');
  const assignees = useTable<TaskAssignee>('task_assignees');
  const materials = useTable<TaskMaterial>('task_materials');
  const sessions = useTable<WorkSession>('work_sessions').filter((s) => s.worker_id === wid);
  const attendance = useTable<Attendance>('attendance').filter((a) => a.worker_id === wid);

  const myTaskIds = new Set(assignees.filter((a) => a.worker_id === wid).map((a) => a.task_id));
  const myTasks = tasks.filter((t) => myTaskIds.has(t.id));
  const active = myTasks.filter(isActiveTask).sort((a, b) => (a.status === 'assigned' ? -1 : 1) - (b.status === 'assigned' ? -1 : 1));
  const closed = myTasks.filter((t) => !isActiveTask(t)).sort((a, b) => (b.done_at ?? b.updated_at).localeCompare(a.done_at ?? a.updated_at)).slice(0, 5);
  const openSession = sessions.find((s) => !s.ended_at);
  const nowISO = () => new Date().toISOString();

  const todayHours = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return sessions.filter((s) => s.started_at.slice(0, 10) === today).reduce((sum, s) => sum + sessionHours(s), 0);
  }, [sessions]);

  const recentDays = [...attendance].sort((a, b) => b.work_date.localeCompare(a.work_date)).slice(0, 20);

  return (
    <Screen>
      <Card style={{ borderColor: openSession ? C.success : C.border }}>
        <H2>⏱ Munkaidő</H2>
        {openSession ? (
          <>
            <Body style={{ fontWeight: '700', color: C.success }}>● Dolgozol — kezdés: {hdt(openSession.started_at)}</Body>
            {openSession.task_id ? <Sub>Feladat: {tasks.find((t) => t.id === openSession.task_id)?.title ?? ''}</Sub> : null}
            <Btn title="⏹ Munka befejezése most" kind="danger" onPress={() => updateRow('work_sessions', openSession.id, { ended_at: nowISO() })} />
          </>
        ) : (
          <>
            <Sub>Nyomd meg, amikor elkezded a munkát — feladatnál a feladat oldalán is indítható.</Sub>
            <Btn title="▶ Munka megkezdése most" kind="secondary"
              onPress={() => insertRow('work_sessions', { worker_id: wid, task_id: null, site_id: null, started_at: nowISO(), ended_at: null, note: null })} />
          </>
        )}
        <Sub>Ma összesen: {fmtHours(todayHours)}</Sub>
      </Card>

      <View style={{ gap: S.sm }}>
        <H2>🛠️ Feladataim ({active.length})</H2>
        {active.length === 0 ? <Empty text="Nincs aktív feladatod." /> : null}
        {active.map((t) => (
          <TaskTile key={t.id} task={t} assignees={assignees.filter((a) => a.task_id === t.id)}
            materials={materials.filter((m) => m.task_id === t.id)} workers={workers} profiles={profiles} sites={sites}
            running={!!openSession && openSession.task_id === t.id} />
        ))}
        {active.some((t) => t.status === 'assigned') ? (
          <Sub style={{ color: C.warning }}>⚠️ Van visszaigazolatlan feladatod — nyisd meg, és nyomd meg a „Megkaptam" gombot.</Sub>
        ) : null}
      </View>

      {closed.length > 0 ? (
        <View style={{ gap: S.sm }}>
          <H2>Lezárt feladatok</H2>
          {closed.map((t) => (
            <TaskTile key={t.id} task={t} assignees={assignees.filter((a) => a.task_id === t.id)}
              materials={materials.filter((m) => m.task_id === t.id)} workers={workers} profiles={profiles} sites={sites} />
          ))}
        </View>
      ) : null}

      <Card>
        <H2>📅 Napjaim</H2>
        {recentDays.length === 0 ? <Sub>Még nincs rögzített napod.</Sub> : null}
        {recentDays.map((a) => (
          <Row key={a.id} style={{ padding: S.sm }}>
            <View style={{ flex: 1 }}>
              <Body style={{ fontWeight: '600' }}>{hd(a.work_date)} · {sites.find((s) => s.id === a.site_id)?.name ?? '—'}</Body>
              {a.pay_basis !== 'presence' ? <Sub>{ft(Number(a.amount) - Number(a.commission_amount))}</Sub> : <Sub>jelenlét</Sub>}
            </View>
            {a.pay_basis !== 'presence' ? (
              <Badge text={a.paid_at ? 'kifizetve' : 'függő'} color={a.paid_at ? C.success : C.warning} />
            ) : null}
          </Row>
        ))}
      </Card>
      <Text style={{ fontSize: 11, color: C.sub, textAlign: 'center' }}>
        Bejelentkezve: {profile.display_name} · {wname(workers.find((w) => w.id === wid))}
      </Text>
    </Screen>
  );
}
