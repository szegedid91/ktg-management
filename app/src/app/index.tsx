import React, { useMemo, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { router, Redirect } from 'expo-router';
import { Screen, Card, H2, Sub, Money, Btn, KV, Badge, Empty, Loading } from '../ui/kit';
import { C, S } from '../ui/theme';
import { useTable, useSyncStatus } from '../lib/hooks';
import { ft, todayISO, hd } from '../lib/format';
import { store } from '../lib/store';
import { syncNow } from '../lib/sync';
import { confirmDialog } from '../lib/dialogs';
import {
  Site, Expense, Attendance, Invoice, Profile, ShareChangeRequest, Settlement, ProfitShareHistory,
  WorkerTask, TaskAssignee, TaskMaterial, TaskMaterialPricing, WorkSession, Worker,
} from '../lib/types';
import { computeBalances } from '../lib/balances';
import { isActiveTask } from '../lib/tasks';
import { TaskBoard } from '../components/TaskBoard';
import { WorkerHome } from '../components/WorkerHome';
import { useAuth } from '../lib/auth';

const MENU: { icon: string; label: string; href: string }[] = [
  { icon: '🏗️', label: 'Építkezések', href: '/sites' },
  { icon: '📅', label: 'Naptár', href: '/calendar' },
  { icon: '👷', label: 'Munkavállalók', href: '/workers' },
  { icon: '🧾', label: 'Számlák', href: '/invoices' },
  { icon: '🤝', label: 'Elszámolás', href: '/settlement' },
  { icon: '📊', label: 'Statisztika', href: '/stats' },
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
  const me = session?.user.id;
  const myProfile = profiles.find((p) => p.id === me);
  const awaitingMyApproval = shareRequests.find((r) =>
    r.status === 'pending' && r.proposed_by !== me && !!myProfile && !myProfile.is_admin && !myProfile.worker_id);
  // az összegek alapból rejtettek — a fenti szem ikon fedi fel mindet
  const [showBalance, setShowBalance] = useState(false);
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

  const activeSites = sites.filter((s) => s.status === 'active');
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

  // munkavállalói fiók: saját, szűkített kezdőlap
  if (myProfile?.worker_id) return <WorkerHome profile={myProfile} />;

  return (
    <Screen>
      {awaitingMyApproval ? (
        <Card style={{ borderColor: C.primary, backgroundColor: C.warnBg }}>
          <Sub style={{ fontWeight: '700', color: C.text }}>
            🤝 {profiles.find((p) => p.id === awaitingMyApproval.proposed_by)?.display_name ?? 'A partnered'} részesedés-módosítást
            javasolt — a te jóváhagyásod kell.
          </Sub>
          <Btn title="Megnézem és döntök" small onPress={() => router.push('/settings')} />
        </Card>
      ) : null}

      {sync.pendingOps > 0 ? (
        <Card style={{ backgroundColor: C.warnBg, borderColor: C.accent }}>
          <Sub style={{ color: C.warning }}>
            ⏳ {sync.pendingOps} művelet vár szinkronizálásra{sync.lastError ? ` — ${sync.lastError}` : ''}
          </Sub>
        </Card>
      ) : null}

      {sync.failedOps > 0 ? (
        <Card style={{ backgroundColor: C.dangerBg, borderColor: C.danger }}>
          <Sub style={{ color: C.danger, fontWeight: '700' }}>
            ⛔ {sync.failedOps} műveletet elutasított a szerver — ezek nem kerültek mentésre.
          </Sub>
          {store.getFailed()[0]?.lastError ? (
            <Sub style={{ color: C.danger }}>{store.getFailed()[0].lastError}</Sub>
          ) : null}
          <View style={{ flexDirection: 'row', gap: S.sm }}>
            <View style={{ flex: 1 }}>
              <Btn title="Újrapróbálás" kind="secondary" small onPress={() => {
                store.getFailed().forEach((o) => store.retryFailed(o.opId));
                void syncNow();
              }} />
            </View>
            <View style={{ flex: 1 }}>
              <Btn title="Elvetés" kind="ghost" small onPress={() => {
                void confirmDialog('Elutasított műveletek elvetése',
                  'A sikertelen műveletek végleg törlődnek a sorból. A szerver állapota marad érvényben.',
                  'Elvetés', true).then((ok) => {
                  if (!ok) return;
                  store.getFailed().forEach((o) => store.discardFailed(o.opId));
                  void syncNow();
                });
              }} />
            </View>
          </View>
        </Card>
      ) : null}

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

      <View style={{ gap: S.sm }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <H2>🛠️ Aktív feladatok ({activeTasks.length})</H2>
          <Btn title="+ Új feladat" small kind="secondary" onPress={() => router.push('/task/new')} />
        </View>
        {activeTasks.length === 0 ? <Sub>Nincs kiadott, folyamatban lévő feladat.</Sub> : <TaskBoard tasks={activeTasks} />}
      </View>

      {unpricedMaterials.length > 0 ? (
        <Card style={{ borderColor: C.accent, backgroundColor: C.warnBg }}>
          <H2>📦 Beárazandó anyagköltségek ({unpricedMaterials.length})</H2>
          <Sub>A munkavállalók rögzítették, de még nincs megadva, mennyiért számlázod tovább.</Sub>
          {unpricedMaterials.slice(0, 8).map((m) => {
            const t = tasks.find((x) => x.id === m.task_id);
            return (
              <Pressable key={m.id} onPress={() => router.push(`/task/${m.task_id}`)}
                style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 }}>
                <Text style={{ color: C.text, flex: 1 }} numberOfLines={1}>
                  {t?.code ? `${t.code} · ` : ''}{t?.title ?? 'feladat'}{m.note ? ` — ${m.note}` : ''}
                </Text>
                <Text style={{ fontWeight: '800', color: C.text }}>{ft(m.amount)}</Text>
              </Pressable>
            );
          })}
          {unpricedMaterials.length > 8 ? <Btn title={`Mind a ${unpricedMaterials.length} megnézése`} kind="ghost" small onPress={() => router.push('/tasks')} /> : null}
        </Card>
      ) : null}

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
        {activeSites.map((s) => (
          <Btn key={s.id} title={s.name} kind="ghost" onPress={() => router.push(`/site/${s.id}`)} />
        ))}
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
