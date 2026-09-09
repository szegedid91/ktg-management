// Munkavállalói kezdőlap — kompakt: egysoros munkaidő-sáv, kompakt
// feladatlista szűrőkkel, összecsukható „Napjaim”.

import React, { useMemo, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { Screen, Card, H2, Sub, Btn, Badge, Empty } from '../ui/kit';
import { C, S } from '../ui/theme';
import { useTable } from '../lib/hooks';
import { insertRow, updateRow } from '../lib/repo';
import { ft, hd, hdt } from '../lib/format';
import { isActiveTask, fmtHours, sessionHours, wname } from '../lib/tasks';
import { WorkerTaskList } from './WorkerTaskList';
import {
  Profile, Worker, WorkerTask, TaskAssignee, WorkSession, Site, Attendance,
} from '../lib/types';

export function WorkerHome({ profile }: { profile: Profile }) {
  const wid = profile.worker_id!;
  const workers = useTable<Worker>('workers');
  const sites = useTable<Site>('sites');
  const tasks = useTable<WorkerTask>('worker_tasks');
  const assignees = useTable<TaskAssignee>('task_assignees');
  const sessions = useTable<WorkSession>('work_sessions').filter((s) => s.worker_id === wid);
  const attendance = useTable<Attendance>('attendance').filter((a) => a.worker_id === wid);
  const [daysOpen, setDaysOpen] = useState(false);
  const [daysLimit, setDaysLimit] = useState(7);

  const myTaskIds = new Set(assignees.filter((a) => a.worker_id === wid).map((a) => a.task_id));
  const myTasks = tasks.filter((t) => myTaskIds.has(t.id));
  const active = myTasks.filter(isActiveTask);
  const hasClosed = myTasks.some((t) => !isActiveTask(t));
  const openSession = sessions.find((s) => !s.ended_at);
  // munkaidő csak akkor, ha van legalább egy elfogadott, futó feladata
  // (vagy épp nyitott munkamenete, amit be kell tudnia fejezni)
  const acceptedActive = active.filter((t) => assignees.some((a) => a.task_id === t.id && a.worker_id === wid && a.acknowledged_at));
  const showWorkTime = acceptedActive.length > 0 || !!openSession;
  const nowISO = () => new Date().toISOString();

  const todayHours = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return sessions.filter((s) => s.started_at.slice(0, 10) === today).reduce((sum, s) => sum + sessionHours(s), 0);
  }, [sessions]);

  const days = [...attendance].sort((a, b) => b.work_date.localeCompare(a.work_date));
  const unpaid = days.filter((a) => a.pay_basis !== 'presence' && !a.paid_at)
    .reduce((s, a) => s + Number(a.amount) - Number(a.commission_amount), 0);

  return (
    <Screen>
      {showWorkTime ? (
        <Card style={{ borderColor: openSession ? C.success : C.border, paddingVertical: S.sm }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: '800', color: openSession ? C.success : C.text }} numberOfLines={1}>
                {openSession ? `● Dolgozol · kezdés ${hdt(openSession.started_at).slice(-5)}` : '⏱ Munkaidő'}
              </Text>
              <Sub>
                {openSession?.task_id ? `${tasks.find((t) => t.id === openSession.task_id)?.title ?? 'feladat'} · ` : ''}
                ma {fmtHours(todayHours)}
              </Sub>
            </View>
            {openSession
              ? <Btn title="⏹ Befejezés" kind="danger" small onPress={() => updateRow('work_sessions', openSession.id, { ended_at: nowISO() })} />
              : <Btn title="▶ Kezdés" kind="secondary" small
                  onPress={() => insertRow('work_sessions', { worker_id: wid, task_id: null, site_id: null, started_at: nowISO(), ended_at: null, note: null })} />}
          </View>
        </Card>
      ) : null}

      <View style={{ gap: S.sm }}>
        <H2>🛠️ Feladataim ({active.length})</H2>
        <WorkerTaskList tasks={myTasks} showClosed={hasClosed} />
      </View>

      <Card style={{ paddingVertical: S.sm }}>
        <Pressable onPress={() => setDaysOpen(!daysOpen)} style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm }}>
          <Text style={{ fontWeight: '800', fontSize: 15, color: C.text }}>📅 Napjaim</Text>
          <Text style={{ flex: 1, color: C.sub, fontSize: 13, textAlign: 'right' }} numberOfLines={1}>
            {days.length === 0 ? 'nincs rögzített nap' : `${days.length} nap · utolsó ${hd(days[0].work_date)}${unpaid > 0 ? ` · függő ${ft(unpaid)}` : ''}`}
          </Text>
          <Text style={{ color: C.sub, fontSize: 16 }}>{daysOpen ? '▾' : '▸'}</Text>
        </Pressable>
        {daysOpen ? (
          <View style={{ gap: 4, paddingTop: 4 }}>
            {days.length === 0 ? <Empty text="Még nincs rögzített napod." /> : null}
            {days.slice(0, daysLimit).map((a) => (
              <View key={a.id} style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm, paddingVertical: 3, borderBottomWidth: 1, borderBottomColor: C.border }}>
                <Text style={{ color: C.text, fontWeight: '600', flex: 1 }} numberOfLines={1}>
                  {hd(a.work_date)} · {sites.find((s) => s.id === a.site_id)?.name ?? '—'}
                </Text>
                {a.pay_basis !== 'presence' ? (
                  <>
                    <Text style={{ color: C.text, fontWeight: '700' }}>{ft(Number(a.amount) - Number(a.commission_amount))}</Text>
                    <Badge text={a.paid_at ? 'kifizetve' : 'függő'} color={a.paid_at ? C.success : C.warning} />
                  </>
                ) : <Badge text="jelenlét" color={C.sub} />}
              </View>
            ))}
            {days.length > daysLimit ? <Btn title={`Több (${days.length - daysLimit})`} kind="ghost" small onPress={() => setDaysLimit(daysLimit + 30)} /> : null}
          </View>
        ) : null}
      </Card>

      <Text style={{ fontSize: 11, color: C.sub, textAlign: 'center' }}>
        {profile.display_name} · {wname(workers.find((w) => w.id === wid))}
      </Text>
    </Screen>
  );
}
