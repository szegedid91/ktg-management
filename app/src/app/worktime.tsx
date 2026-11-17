// Munkaidőm (munkavállalóknak): a saját (és vállalkozónál az emberei) munkaideje hetekre / hónapokra bontva,
// alatta a rögzített napok. Az alsó menüsor külön gombjáról nyílik; korábban a kezdőlap alján volt.
// Nincs beküldés: a bér a munkaidőből automatikusan képződik, ez csak áttekintés. Pénzt a munkavállaló itt sem lát.

import React, { useState } from 'react';
import { View, Text } from 'react-native';
import { Screen, Card, Sub, Btn, Badge, Empty, Segmented } from '../ui/kit';
import { C, S } from '../ui/theme';
import { useTable } from '../lib/hooks';
import { getCurrentUserId } from '../lib/repo';
import { hd, todayISO, localDateISO } from '../lib/format';
import { fmtHours, unionHours, weekStartISO } from '../lib/tasks';
import { Profile, Worker, WorkSession, Site, Attendance } from '../lib/types';

export default function WorkTime() {
  const me = getCurrentUserId();
  const profiles = useTable<Profile>('profiles');
  const workers = useTable<Worker>('workers');
  const sites = useTable<Site>('sites');
  const sessionsAll = useTable<WorkSession>('work_sessions');
  const attendanceAll = useTable<Attendance>('attendance');
  const [periodMode, setPeriodMode] = useState<'week' | 'month'>('week');
  const [daysLimit, setDaysLimit] = useState(14);

  const wid = profiles.find((p) => p.id === me)?.worker_id ?? null;
  if (!wid) return <Screen><Empty text="A Munkaidőm oldal a munkavállalóknak szól." /></Screen>;

  // vállalkozó: a saját emberei munkaideje is idejön
  const self = workers.find((w) => w.id === wid);
  const crew = workers.filter((w) => w.contractor_id === wid).sort((a, b) => a.name.localeCompare(b.name, 'hu'));
  const isContractor = !!self?.is_contractor;
  const myIds = new Set([wid, ...crew.map((c) => c.id)]);
  const allSessions = sessionsAll.filter((s) => myIds.has(s.worker_id));
  const allAttendance = attendanceAll.filter((a) => myIds.has(a.worker_id));
  const days = allAttendance.filter((a) => a.worker_id === wid).sort((a, b) => b.work_date.localeCompare(a.work_date));

  const todayIso = todayISO();
  const thisWeek = weekStartISO(todayIso);
  const people = [{ id: wid, name: 'Én' }, ...crew.map((c) => ({ id: c.id, name: c.name }))];
  const periodKeys: { key: string; label: string; match: (d: string) => boolean }[] = [];
  if (periodMode === 'week') {
    for (let i = 0; i < 8; i++) {
      const d = new Date(`${thisWeek}T12:00:00`); d.setDate(d.getDate() - 7 * i);
      const week = localDateISO(d);
      periodKeys.push({ key: week, label: `${hd(week)} hete${week === thisWeek ? ' (folyó)' : ''}`, match: (x) => weekStartISO(x) === week });
    }
  } else {
    for (let i = 0; i < 6; i++) {
      const d = new Date(`${todayIso.slice(0, 7)}-15T12:00:00`); d.setMonth(d.getMonth() - i);
      const ym = localDateISO(d).slice(0, 7);
      periodKeys.push({ key: ym, label: `${ym.replace('-', '. ')}.${ym === todayIso.slice(0, 7) ? ' (folyó)' : ''}`, match: (x) => x.slice(0, 7) === ym });
    }
  }
  const periods = periodKeys.map((k) => people.map((p) => {
    const own = allSessions.filter((s) => s.worker_id === p.id && s.ended_at && k.match(localDateISO(s.started_at)));
    const rows = allAttendance.filter((a) => a.worker_id === p.id && k.match(a.work_date));
    return { key: k.key, label: k.label, person: p, hours: unionHours(own), days: new Set(rows.map((a) => a.work_date)).size };
  })).flat().filter((w) => w.hours > 0 || w.days > 0);

  return (
    <Screen>
      <Card style={{ gap: 6 }}>
        <Text style={{ fontWeight: '800', fontSize: 16, color: C.text }}>🗓️ Munkaidőm</Text>
        <Segmented options={[{ value: 'week', label: 'Hetek' }, { value: 'month', label: 'Hónapok' }]} value={periodMode} onChange={setPeriodMode} />
        {periods.length === 0 ? <Sub>{periodMode === 'week' ? 'Az elmúlt 8 hétben' : 'Az elmúlt 6 hónapban'} nincs rögzített munkaidőd.</Sub> : null}
        {periods.map((w) => (
          <View key={`${w.key}-${w.person.id}`} style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: C.border }}>
            <Text style={{ color: C.text, fontWeight: '600', flex: 1 }}>{w.label}{isContractor && crew.length ? ` · ${w.person.name}` : ''}</Text>
            <Text style={{ color: C.text, fontWeight: '800' }}>{fmtHours(w.hours)}</Text>
            <Sub>{w.days} nap</Sub>
          </View>
        ))}
      </Card>

      <Card style={{ gap: 4 }}>
        <Text style={{ fontWeight: '800', fontSize: 16, color: C.text }}>📅 Napjaim</Text>
        {days.length === 0 ? <Empty text="Még nincs rögzített napod." /> : null}
        {days.slice(0, daysLimit).map((a) => (
          <View key={a.id} style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm, paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: C.border }}>
            <Text style={{ color: C.text, fontWeight: '600', flex: 1 }} numberOfLines={1}>
              {hd(a.work_date)} · {sites.find((s) => s.id === a.site_id)?.name ?? '—'}
            </Text>
            {a.pay_basis === 'hourly' && Number(a.hours ?? 0) > 0 ? <Text style={{ color: C.text, fontWeight: '700' }}>{String(Number(a.hours)).replace('.', ',')} ó</Text> : null}
            {a.pay_basis !== 'hourly' && a.pay_basis !== 'presence' && Number(a.worked_hours ?? 0) > 0 ? <Text style={{ color: C.text, fontWeight: '700' }}>{fmtHours(Number(a.worked_hours))}</Text> : null}
            {a.pay_basis === 'presence' ? <Badge text="jelenlét" color={C.sub} /> : null}
          </View>
        ))}
        {days.length > daysLimit ? <Btn title={`Régebbi napok (${days.length - daysLimit})`} kind="ghost" small onPress={() => setDaysLimit(daysLimit + 30)} /> : null}
      </Card>
    </Screen>
  );
}
