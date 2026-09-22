import React, { useMemo, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { router, Redirect } from 'expo-router';
import { Screen, Card, H2, Sub, Btn, Badge, Empty, Loading, Input } from '../ui/kit';
import { C, S } from '../ui/theme';
import { useTable, useSyncStatus } from '../lib/hooks';
import { todayISO, hd, hdt } from '../lib/format';
import { store } from '../lib/store';
import { syncNow } from '../lib/sync';
import { confirmDialog } from '../lib/dialogs';
import {
  Site, Attendance, Profile, WorkerTask, TaskAssignee, WorkSession, Worker, TaskQuote,
} from '../lib/types';
import { isActiveTask, isFailedOpen, wname } from '../lib/tasks';
import { Todo } from '../components/TodoTile';
import { WorkerHome } from '../components/WorkerHome';
import { SyncBanner } from '../components/SyncBanner';
import { PushPrompt } from '../components/PushPrompt';
import { useAuth, consumeRecoveryRedirect } from '../lib/auth';

const MENU: { icon: string; label: string; href: string }[] = [
  { icon: '🏗️', label: 'Építkezések', href: '/sites' },
  { icon: '📅', label: 'Naptár', href: '/calendar' },
  { icon: '🗺️', label: 'Térkép', href: '/map' },
  { icon: '👷', label: 'Munkavállalók', href: '/workers' },
  { icon: '💰', label: 'Pénzügy', href: '/finance' },
  { icon: '🔨', label: 'Eszközök', href: '/equipment' },
  { icon: '🕵️', label: 'Audit napló', href: '/audit' },
  { icon: '⚙️', label: 'Beállítások', href: '/settings' },
];

function MenuGrid() {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S.sm }}>
      {MENU.map((m) => (
        <Pressable
          key={m.href}
          onPress={() => router.push(m.href as any)}
          style={({ pressed }) => ({
            width: '18.4%', minWidth: 96, maxWidth: '33%', flexGrow: 1,
            backgroundColor: C.card, borderRadius: S.radiusSm,
            borderWidth: 1, borderColor: C.border,
            alignItems: 'center', paddingVertical: S.md, gap: 4,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Text style={{ fontSize: 24 }}>{m.icon}</Text>
          <Text style={{ fontSize: 12, fontWeight: '600', color: C.text, textAlign: 'center' }}>{m.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export default function Dashboard() {
  const { session, loading } = useAuth();
  if (loading) return <Loading />;
  if (!session) return <Redirect href="/login" />;
  if (consumeRecoveryRedirect()) return <Redirect href="/jelszo" />;
  return <DashboardInner />;
}

function DashboardInner() {
  const { session } = useAuth();
  const sync = useSyncStatus();
  const sites = useTable<Site>('sites');
  const attendance = useTable<Attendance>('attendance');

  // részesedés-módosítási javaslat, ami az én jóváhagyásomra vár
  const profiles = useTable<Profile>('profiles');
  // feladatok a kezdőlapi csempékhez
  const tasks = useTable<WorkerTask>('worker_tasks');
  const assignees = useTable<TaskAssignee>('task_assignees');
  const sessions = useTable<WorkSession>('work_sessions');
  const workers = useTable<Worker>('workers');
  const quotes = useTable<TaskQuote>('task_quotes');
  const me = session?.user.id;
  const myProfile = profiles.find((p) => p.id === me);
  const [siteQ, setSiteQ] = useState('');


  // ABC-sorrend: a lista minden renderkor a tükörből épül, így új/módosított
  // építkezés azonnal a helyére kerül
  const activeSites = sites.filter((s) => s.status === 'active').sort((a, b) => a.name.localeCompare(b.name, 'hu', { sensitivity: 'base' }));
  const closedSites = sites.filter((s) => s.status === 'closed');

  const activeTasks = tasks.filter(isActiveTask).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const runningTaskIds = new Set(sessions.filter((s) => !s.ended_at && s.task_id).map((s) => s.task_id));

  // ---- teendő-dashboard ----
  const today = todayISO();
  const unassignedTasks = activeTasks.filter((t) => !assignees.some((a) => a.task_id === t.id));
  const pendingTasks = activeTasks.filter((t) => t.status === 'assigned' && assignees.some((a) => a.task_id === t.id));
  // 3+ napja kiosztott, de el nem fogadott feladatok (a kiosztás idejétől számítva)
  const staleCutoff = new Date(Date.now() - 3 * 864e5).toISOString();
  const staleTasks = pendingTasks.filter((t) => assignees.some((a) => a.task_id === t.id && !a.acknowledged_at && a.updated_at < staleCutoff));
  const staleSos = staleTasks.some((t) => t.priority > 0);
  const pendingPrio = pendingTasks.filter((t) => t.priority > 0).length;
  const submittedQuotes = quotes.filter((q) => q.status === 'submitted' && activeTasks.some((t) => t.id === q.task_id));
  const quoteTasks = activeTasks.filter((t) => submittedQuotes.some((q) => q.task_id === t.id));
  // nem sikerültre jelentett feladatok, amíg a vezető el nem dönti: kész vagy lezárás (nem tudták megoldani)
  const failedOpen = tasks.filter(isFailedOpen);
  const runningCount = activeTasks.filter((t) => runningTaskIds.has(t.id)).length;
  const pendingWorkers = workers.filter((w) => !w.approved_at);
  const overdueTasks = activeTasks.filter((t) => t.due_date && t.due_date < today);
  // ki hol dolgozik most: futó munkamenetek építkezésenként
  const runningNow = sessions.filter((s) => !s.ended_at).map((s) => ({
    s, worker: workers.find((w) => w.id === s.worker_id), site: sites.find((x) => x.id === s.site_id),
    task: s.task_id ? tasks.find((t) => t.id === s.task_id) : undefined,
  }));
  const runningBySite = Array.from(new Set(runningNow.map((r) => r.site?.id ?? ''))).map((sid) => ({
    site: sites.find((x) => x.id === sid), items: runningNow.filter((r) => (r.site?.id ?? '') === sid),
  }));
  const todos = [
    pendingWorkers.length ? { key: 'approve', icon: '👷', title: 'Jóváhagyásra váró regisztráció', count: pendingWorkers.length,
      detail: `${pendingWorkers.map((w) => w.name).join(', ')} — nézd át a díjazást és hagyd jóvá`, color: '#B7791F',
      href: pendingWorkers.length === 1 ? `/worker/${pendingWorkers[0].id}` : '/workers' } : null,
    overdueTasks.length ? { key: 'overdue', icon: '⏰', title: 'Lejárt határidejű feladat', count: overdueTasks.length,
      detail: overdueTasks.slice(0, 3).map((t) => t.code || t.title).join(', '), color: C.danger, href: '/tasks?filter=overdue' } : null,
    unassignedTasks.length ? { key: 'unassigned', icon: '📋', title: 'Kiosztatlan feladat', count: unassignedTasks.length,
      detail: unassignedTasks.slice(0, 3).map((t) => t.code || t.title).join(', '), color: '#6B46C1', href: '/tasks?filter=unassigned' } : null,
    pendingTasks.length ? { key: 'assigned', icon: '⏳', title: 'Elfogadásra váró feladat', count: pendingTasks.length,
      detail: pendingPrio ? `ebből ${pendingPrio} SOS 🆘` : 'még egyik sincs elfogadva', color: '#B7791F', href: '/tasks?filter=assigned' } : null,
    quoteTasks.length ? { key: 'quote', icon: '💬', title: 'Ajánlat vár elfogadásra', count: quoteTasks.length,
      detail: `${submittedQuotes.length} ajánlat érkezett — nézd meg és dönts`, color: C.primary, href: '/tasks?filter=quote' } : null,
    failedOpen.length ? { key: 'failed', icon: '⚠️', title: 'Nem sikerültre jelentett feladat', count: failedOpen.length,
      detail: 'a munkavállalónál nyitva marad — nézd meg az indoklást, majd jelöld késznek vagy zárd le', color: C.danger, href: '/tasks?filter=failed' } : null,
    runningCount ? { key: 'running', icon: '●', title: 'Épp folyik a munka', count: runningCount,
      detail: 'feladaton indított munkaidő', color: C.success, href: '/tasks?filter=running' } : null,
  ].filter(Boolean) as { key: string; icon: string; title: string; count: number; detail: string; color: string; href: string }[];

  // munkavállalói fiók: saját, szűkített kezdőlap
  if (myProfile?.worker_id) return <WorkerHome profile={myProfile} />;

  return (
    <Screen>
      {runningNow.length > 0 ? (
        <Card style={{ borderColor: C.success, paddingVertical: S.sm }}>
          <Text style={{ fontWeight: '800', color: C.success }}>● Most dolgoznak ({runningNow.length})</Text>
          {runningBySite.map((g) => (
            <View key={g.site?.id ?? 'none'} style={{ gap: 2 }}>
              <Pressable onPress={() => g.site && router.push(`/site/${g.site.id}`)}>
                <Text style={{ fontWeight: '700', color: C.text }}>📍 {g.site?.name ?? 'Helyszín nélkül'}</Text>
              </Pressable>
              {g.items.map(({ s, worker, task }) => (
                <Pressable key={s.id} onPress={() => task && router.push(`/task/${task.id}`)}>
                  <Sub>👷 {worker ? wname(worker) : '?'} · {hdt(s.started_at).slice(-5)} óta{task ? ` · ${task.code ? `${task.code} ` : ''}${task.title}` : ''}</Sub>
                </Pressable>
              ))}
            </View>
          ))}
        </Card>
      ) : null}

      <SyncBanner />
      <PushPrompt />


      {staleTasks.length ? (
        <Card style={{ borderColor: C.danger, borderWidth: staleSos ? 3 : 1, backgroundColor: staleSos ? C.dangerBg : C.card }}>
          <Text style={{ fontWeight: '900', fontSize: staleSos ? 18 : 15, color: C.danger }}>
            {staleSos ? '🆘 SÜRGŐS — 3 napja nem fogadták el' : '⚠️ 3 napja nem fogadták el'} ({staleTasks.length})
          </Text>
          <Sub>Kiosztott feladat, amit a munkavállaló 3 napja nem fogadott el — szólj rá, vagy oszd ki másnak (feladat oldal · Kiosztva · Módosít).</Sub>
          {staleTasks.map((t) => {
            const asg = assignees.filter((a) => a.task_id === t.id && !a.acknowledged_at);
            const since = asg.map((a) => a.created_at).sort()[0];
            return (
              <Pressable key={t.id} onPress={() => router.push(`/task/${t.id}`)}
                style={{ backgroundColor: C.card, borderRadius: S.radiusSm, borderWidth: 1, borderColor: t.priority ? C.danger : C.border, borderLeftWidth: 4, borderLeftColor: C.danger, padding: S.sm, gap: 2 }}>
                <Text style={{ fontWeight: '800', color: t.priority ? C.danger : C.text }} numberOfLines={1}>{t.priority ? '🆘 ' : ''}{t.code ? `${t.code} · ` : ''}{t.title}</Text>
                <Sub>👷 {asg.map((a) => wname(workers.find((w) => w.id === a.worker_id))).join(', ')} · kiosztva {hd(since?.slice(0, 10))} · {Math.floor((Date.now() - new Date(since).getTime()) / 864e5)} napja</Sub>
              </Pressable>
            );
          })}
        </Card>
      ) : null}

      <View style={{ gap: S.sm }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <H2>📌 Teendők</H2>
          <Btn title="+ Új feladat" small kind="secondary" onPress={() => router.push('/task/new')} />
        </View>
        {todos.length === 0 ? <Sub>Nincs teendő — minden rendben. ✅</Sub> : null}
        {todos.map((t) => <Todo key={t.key} icon={t.icon} title={t.title} count={t.count} detail={t.detail} color={t.color} href={t.href} />)}
        <Pressable onPress={() => router.navigate('/tasks')} style={{ alignSelf: 'flex-end' }}>
          <Text style={{ color: C.primary, fontWeight: '700' }}>Minden feladat ({activeTasks.length} aktív) ›</Text>
        </Pressable>
      </View>

      <MenuGrid />


      <Card>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <H2>Aktív építkezések</H2>
          <Badge text={`${activeSites.length} db`} />
        </View>
        {activeSites.length === 0 ? <Empty text="Nincs aktív építkezés. Hozz létre egyet!" /> : null}
        {activeSites.length > 3 ? <Input value={siteQ} onChangeText={setSiteQ} placeholder="Keresés név vagy cím szerint…" /> : null}
        {activeSites
          .filter((s) => !siteQ.trim() || `${s.name} ${s.address ?? ''}`.toLowerCase().includes(siteQ.trim().toLowerCase()))
          .map((s) => (
            <Btn key={s.id} title={s.name} kind="ghost" onPress={() => router.push(`/site/${s.id}`)} />
          ))}
        {siteQ.trim() && !activeSites.some((s) => `${s.name} ${s.address ?? ''}`.toLowerCase().includes(siteQ.trim().toLowerCase())) ? <Sub>Nincs találat.</Sub> : null}
        {closedSites.length > 0 ? (
          <Pressable onPress={() => router.push('/sites?filter=closed')}>
            <Sub style={{ textAlign: 'center', paddingVertical: 6 }}>
              📁 Lezárt építkezések ({closedSites.length})  ›
            </Sub>
          </Pressable>
        ) : null}
      </Card>

      <Sub style={{ textAlign: 'center' }}>
        {sync.lastSyncAt ? `Utolsó szinkron: ${hd(sync.lastSyncAt)} ${new Date(sync.lastSyncAt).toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' })}` : 'Még nem volt szinkron'}
      </Sub>
    </Screen>
  );
}
