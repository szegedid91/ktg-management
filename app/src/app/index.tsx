import React, { useMemo, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { router, Redirect } from 'expo-router';
import { Screen, Card, H2, Sub, Money, Btn, KV, Badge, Empty, Loading, Input } from '../ui/kit';
import { C, S } from '../ui/theme';
import { useTable, useSyncStatus } from '../lib/hooks';
import { ft, todayISO, hd, hdt } from '../lib/format';
import { store } from '../lib/store';
import { syncNow } from '../lib/sync';
import { confirmDialog } from '../lib/dialogs';
import {
  Site, Expense, Attendance, Invoice, Profile, ShareChangeRequest, Settlement, ProfitShareHistory,
  WorkerTask, TaskAssignee, TaskMaterial, TaskMaterialPricing, WorkSession, Worker, TaskQuote,
} from '../lib/types';
import { computeBalances } from '../lib/balances';
import { unpaidWorkerPart, isActiveTask, wname } from '../lib/tasks';
import { Todo } from '../components/TodoTile';
import { WorkerHome } from '../components/WorkerHome';
import { SyncBanner } from '../components/SyncBanner';
import { useAuth, consumeRecoveryRedirect } from '../lib/auth';

const MENU: { icon: string; label: string; href: string }[] = [
  { icon: '🏗️', label: 'Építkezések', href: '/sites' },
  { icon: '📅', label: 'Naptár', href: '/calendar' },
  { icon: '👷', label: 'Munkavállalók', href: '/workers' },
  { icon: '🧾', label: 'Számlák', href: '/invoices' },
  { icon: '🤝', label: 'Elszámolás', href: '/settlement' },
  { icon: '📊', label: 'Statisztika', href: '/stats' },
  { icon: '💧', label: 'Pénzforgalom', href: '/cashflow' },
  { icon: '🔨', label: 'Eszközök', href: '/equipment' },
  { icon: '📤', label: 'Export', href: '/export' },
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
  const expenses = useTable<Expense>('expenses');
  const attendance = useTable<Attendance>('attendance');
  const invoices = useTable<Invoice>('invoices');

  // részesedés-módosítási javaslat, ami az én jóváhagyásomra vár
  const profiles = useTable<Profile>('profiles');
  const settlements = useTable<Settlement>('settlements');
  const shareHistory = useTable<ProfitShareHistory>('profit_share_history');
  const shareRequests = useTable<ShareChangeRequest>('share_change_requests');
  // feladatok a kezdőlapi csempékhez
  const tasks = useTable<WorkerTask>('worker_tasks');
  const assignees = useTable<TaskAssignee>('task_assignees');
  const materials = useTable<TaskMaterial>('task_materials');
  const pricing = useTable<TaskMaterialPricing>('task_material_pricing');
  const sessions = useTable<WorkSession>('work_sessions');
  const workers = useTable<Worker>('workers');
  const quotes = useTable<TaskQuote>('task_quotes');
  const me = session?.user.id;
  const myProfile = profiles.find((p) => p.id === me);
  const awaitingMyApproval = shareRequests.find((r) =>
    r.status === 'pending' && r.proposed_by !== me && !!myProfile && !myProfile.is_admin && !myProfile.worker_id);
  // az összegek alapból rejtettek — a fenti szem ikon fedi fel mindet
  const [showBalance, setShowBalance] = useState(false);
  const [siteQ, setSiteQ] = useState('');
  const mask = (n: number) => (showBalance ? ft(n) : '••• Ft');

  const month = todayISO().slice(0, 7);
  const stats = useMemo(() => {
    const mExp = expenses.filter((e) => e.expense_date.startsWith(month)).reduce((s, e) => s + Number(e.net_amount), 0);
    const mWage = attendance.filter((a) => a.work_date.startsWith(month)).reduce((s, a) => s + Number(a.amount), 0);
    const mRev = invoices.filter((i) => i.paid_at?.startsWith(month)).reduce((s, i) => s + Number(i.net_amount), 0);
    const outstanding = invoices.filter((i) => !i.paid_at).reduce((s, i) => s + Number(i.net_amount), 0);
    const unpaidWages = attendance.filter((a) => a.pay_basis !== 'presence' && !a.paid_at)
      .reduce((s, a) => s + Number(a.amount) - Number(a.commission_amount), 0);
    const unpaidCommissions = attendance.filter((a) => a.referrer_external_id && Number(a.commission_amount) > 0 && !a.commission_paid_at)
      .reduce((s, a) => s + Number(a.commission_amount), 0);
    return { mExp, mWage, mRev, outstanding, unpaidWages, unpaidCommissions };
  }, [expenses, attendance, invoices, month]);

  // ABC-sorrend: a lista minden renderkor a tükörből épül, így új/módosított
  // építkezés azonnal a helyére kerül
  const activeSites = sites.filter((s) => s.status === 'active').sort((a, b) => a.name.localeCompare(b.name, 'hu', { sensitivity: 'base' }));
  const closedSites = sites.filter((s) => s.status === 'closed');
  // lokális tükörből: bármilyen rögzítésre azonnal frissül
  const myBalance = useMemo(
    () => computeBalances(profiles, expenses, attendance, invoices, settlements, shareHistory)
      .find((b) => b.user_id === session?.user.id),
    [profiles, expenses, attendance, invoices, settlements, shareHistory, session?.user.id],
  );

  const activeTasks = tasks.filter(isActiveTask).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const unpricedMaterials = materials.filter((m) => !pricing.some((p) => p.material_id === m.id));
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
  const failedRecent = tasks.filter((t) => t.status === 'failed' && (t.done_at ?? t.updated_at) >= new Date(Date.now() - 14 * 864e5).toISOString());
  const runningCount = activeTasks.filter((t) => runningTaskIds.has(t.id)).length;
  const unpricedSum = unpricedMaterials.reduce((s, m) => s + Number(m.amount), 0);
  const overdueInvoices = invoices.filter((i) => !i.paid_at && i.due_date && i.due_date < today);
  const overdueSum = overdueInvoices.reduce((s, i) => s + Number(i.net_amount), 0);
  const unpaidWageCount = attendance.filter((a) => unpaidWorkerPart(a) > 0).length;
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
      detail: `${submittedQuotes.length} ajánlat · összesen ${ft(submittedQuotes.reduce((s, q) => s + Number(q.amount ?? 0), 0))}`, color: C.primary, href: '/tasks?filter=quote' } : null,
    unpricedMaterials.length ? { key: 'unpriced', icon: '📦', title: 'Beárazandó anyagköltség', count: unpricedMaterials.length,
      detail: `összértéke ${ft(unpricedSum)} — add meg, mennyiért számlázod tovább`, color: C.warning, href: '/tasks?filter=unpriced' } : null,
    failedRecent.length ? { key: 'failed', icon: '⚠️', title: 'Nem sikerült feladat (14 nap)', count: failedRecent.length,
      detail: 'nézd meg az indoklást és a fotókat', color: C.danger, href: '/tasks?filter=failed' } : null,
    runningCount ? { key: 'running', icon: '●', title: 'Épp folyik a munka', count: runningCount,
      detail: 'feladaton indított munkaidő', color: C.success, href: '/tasks?filter=running' } : null,
    unpaidWageCount ? { key: 'wages', icon: '👷', title: 'Kifizetetlen bér', count: unpaidWageCount,
      detail: `összesen ${ft(stats.unpaidWages)}`, color: '#B7791F', href: '/pending' } : null,
    overdueInvoices.length ? { key: 'overdue-invoice', icon: '🧾', title: 'Lejárt, be nem folyt számla', count: overdueInvoices.length,
      detail: `összesen ${ft(overdueSum)} nettó`, color: C.danger, href: '/invoices' } : null,
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
      {awaitingMyApproval ? (
        <Card style={{ borderColor: C.primary, backgroundColor: C.warnBg }}>
          <Sub style={{ fontWeight: '700', color: C.text }}>
            🤝 {profiles.find((p) => p.id === awaitingMyApproval.proposed_by)?.display_name ?? 'A partnered'} részesedés-módosítást
            javasolt — a te jóváhagyásod kell.
          </Sub>
          <Btn title="Megnézem és döntök" small onPress={() => router.push('/settings')} />
        </Card>
      ) : null}

      <SyncBanner />

      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <H2>Egyenlegem</H2>
          <Pressable
            onPress={() => setShowBalance(!showBalance)}
            hitSlop={10}
            accessibilityLabel={showBalance ? 'Egyenleg elrejtése' : 'Egyenleg megjelenítése'}
          >
            <Text style={{ fontSize: 22 }}>{showBalance ? '🙈' : '👁️'}</Text>
          </Pressable>
        </View>
        {myBalance ? (
          showBalance ? (
            <>
              <Text style={{ fontSize: 28, fontWeight: '800', color: myBalance.balance >= 0 ? C.success : C.danger }}>
                {ft(myBalance.balance)}
              </Text>
              <Sub>{myBalance.balance >= 0 ? 'Ennyi jár neked a közösből' : 'Ennyivel tartozol a közösnek'}</Sub>
            </>
          ) : (
            <>
              <Text style={{ fontSize: 28, fontWeight: '800', color: C.sub, letterSpacing: 3 }}>••• ••• Ft</Text>
              <Sub>Koppints a szemre a megjelenítéshez.</Sub>
            </>
          )
        ) : <Sub>Egyenleg betöltése…</Sub>}
      </Card>

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
        <H2>Ez a hónap</H2>
        <KV k="Költés (nettó)" v={mask(stats.mExp + stats.mWage)} />
        <KV k="— ebből anyag/egyéb" v={mask(stats.mExp)} />
        <KV k="— ebből bér" v={mask(stats.mWage)} />
        <KV k="Befolyt bevétel (nettó)" v={mask(stats.mRev)} />
        <KV k="Eredmény" v={mask(stats.mRev - stats.mExp - stats.mWage)} strong />
      </Card>

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
