// Pénzügy (vezetőknek): minden pénzügyi információ egy helyen — egyenleg,
// havi összesítő, pénzügyi teendők és a pénzügyi oldalak (függő kifizetések,
// számlák, pénzforgalom, elszámolás, statisztika, export). A kezdőlap
// szándékosan nem mutat pénzügyet.

import React, { useMemo, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { router } from 'expo-router';
import { Screen, Card, H2, Sub, Btn, KV, Empty } from '../ui/kit';
import { C, S } from '../ui/theme';
import { useTable, useIsWorker } from '../lib/hooks';
import { ft, todayISO } from '../lib/format';
import {
  Expense, Attendance, Invoice, Profile, ShareChangeRequest, Settlement, ProfitShareHistory,
  WorkerTask, TaskMaterial, TaskMaterialPricing, TaskQuote,
} from '../lib/types';
import { computeBalances } from '../lib/balances';
import { unpaidWorkerPart, isActiveTask } from '../lib/tasks';
import { Todo } from '../components/TodoTile';
import { useAuth } from '../lib/auth';

const MENU: { icon: string; label: string; href: string; sub: string }[] = [
  { icon: '⏳', label: 'Függő kifizetések', href: '/pending', sub: 'kintlévőség, kifizetetlen bérek és közvetítői díjak' },
  { icon: '🧾', label: 'Kimenő számlák', href: '/invoices', sub: 'számlázás, befolyás jelölése' },
  { icon: '💧', label: 'Pénzforgalom', href: '/cashflow', sub: 'várható bevétel és kiadás hetekre' },
  { icon: '🤝', label: 'Elszámolás', href: '/settlement', sub: 'közös kassza, egyenlegek, kifizetések egymás közt' },
  { icon: '📊', label: 'Statisztika', href: '/stats', sub: 'építkezésenként, munkavállalónként' },
  { icon: '📤', label: 'Export könyvelőnek', href: '/export', sub: 'Excel / PDF · havi bérkimutatás' },
];

function FinanceInner() {
  const { session } = useAuth();
  const me = session?.user.id;
  const profiles = useTable<Profile>('profiles');
  const expenses = useTable<Expense>('expenses');
  const attendance = useTable<Attendance>('attendance');
  const invoices = useTable<Invoice>('invoices');
  const settlements = useTable<Settlement>('settlements');
  const shareHistory = useTable<ProfitShareHistory>('profit_share_history');
  const shareRequests = useTable<ShareChangeRequest>('share_change_requests');
  const tasks = useTable<WorkerTask>('worker_tasks');
  const materials = useTable<TaskMaterial>('task_materials');
  const pricing = useTable<TaskMaterialPricing>('task_material_pricing');
  const quotes = useTable<TaskQuote>('task_quotes');
  const myProfile = profiles.find((p) => p.id === me);
  const awaitingMyApproval = shareRequests.find((r) =>
    r.status === 'pending' && r.proposed_by !== me && !!myProfile && !myProfile.is_admin && !myProfile.worker_id);

  // az összegek alapból rejtettek — a szem ikon fedi fel mindet
  const [show, setShow] = useState(false);
  const mask = (n: number) => (show ? ft(n) : '••• Ft');

  const month = todayISO().slice(0, 7);
  const stats = useMemo(() => {
    const mExp = expenses.filter((e) => e.expense_date.startsWith(month)).reduce((s, e) => s + Number(e.net_amount), 0);
    const mWage = attendance.filter((a) => a.work_date.startsWith(month)).reduce((s, a) => s + Number(a.amount), 0);
    const mRev = invoices.filter((i) => i.paid_at?.startsWith(month)).reduce((s, i) => s + Number(i.net_amount), 0);
    const unpaidWages = attendance.filter((a) => a.pay_basis !== 'presence' && !a.paid_at)
      .reduce((s, a) => s + Number(a.amount) - Number(a.commission_amount), 0);
    return { mExp, mWage, mRev, unpaidWages };
  }, [expenses, attendance, invoices, month]);

  const myBalance = useMemo(
    () => computeBalances(profiles, expenses, attendance, invoices, settlements, shareHistory).find((b) => b.user_id === me),
    [profiles, expenses, attendance, invoices, settlements, shareHistory, me],
  );

  const today = todayISO();
  const activeTasks = tasks.filter(isActiveTask);
  const unpricedMaterials = materials.filter((m) => !pricing.some((p) => p.material_id === m.id));
  const unpricedSum = unpricedMaterials.reduce((s, m) => s + Number(m.amount), 0);
  const overdueInvoices = invoices.filter((i) => !i.paid_at && i.due_date && i.due_date < today);
  const overdueSum = overdueInvoices.reduce((s, i) => s + Number(i.net_amount), 0);
  const unpaidWageCount = attendance.filter((a) => unpaidWorkerPart(a) > 0).length;
  const submittedQuotes = quotes.filter((q) => q.status === 'submitted' && activeTasks.some((t) => t.id === q.task_id));
  const todos = [
    unpaidWageCount ? { key: 'wages', icon: '👷', title: 'Kifizetetlen bér', count: unpaidWageCount,
      detail: `összesen ${ft(stats.unpaidWages)}`, color: '#B7791F', href: '/pending/wages' } : null,
    overdueInvoices.length ? { key: 'overdue-invoice', icon: '🧾', title: 'Lejárt, be nem folyt számla', count: overdueInvoices.length,
      detail: `összesen ${ft(overdueSum)} nettó`, color: C.danger, href: '/invoices' } : null,
    unpricedMaterials.length ? { key: 'unpriced', icon: '📦', title: 'Beárazandó anyagköltség', count: unpricedMaterials.length,
      detail: `összértéke ${ft(unpricedSum)} — add meg, mennyiért számlázod tovább`, color: C.warning, href: '/tasks?filter=unpriced' } : null,
    submittedQuotes.length ? { key: 'quote', icon: '💬', title: 'Ajánlat vár elfogadásra', count: submittedQuotes.length,
      detail: `összesen ${ft(submittedQuotes.reduce((s, q) => s + Number(q.amount ?? 0), 0))}`, color: C.primary, href: '/tasks?filter=quote' } : null,
  ].filter(Boolean) as { key: string; icon: string; title: string; count: number; detail: string; color: string; href: string }[];

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

      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <H2>Egyenlegem</H2>
          <Pressable onPress={() => setShow(!show)} hitSlop={10} accessibilityLabel={show ? 'Összegek elrejtése' : 'Összegek megjelenítése'}>
            <Text style={{ fontSize: 22 }}>{show ? '🙈' : '👁️'}</Text>
          </Pressable>
        </View>
        {myBalance ? (
          show ? (
            <>
              <Text style={{ fontSize: 28, fontWeight: '800', color: myBalance.balance >= 0 ? C.success : C.danger }}>{ft(myBalance.balance)}</Text>
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

      <Card>
        <H2>Ez a hónap</H2>
        <KV k="Költés (nettó)" v={mask(stats.mExp + stats.mWage)} />
        <KV k="— ebből anyag/egyéb" v={mask(stats.mExp)} />
        <KV k="— ebből bér" v={mask(stats.mWage)} />
        <KV k="Befolyt bevétel (nettó)" v={mask(stats.mRev)} />
        <KV k="Eredmény" v={mask(stats.mRev - stats.mExp - stats.mWage)} strong />
      </Card>

      <View style={{ gap: S.sm }}>
        <H2>📌 Pénzügyi teendők</H2>
        {todos.length === 0 ? <Sub>Nincs pénzügyi teendő — minden rendben. ✅</Sub> : null}
        {todos.map((t) => <Todo key={t.key} icon={t.icon} title={t.title} count={t.count} detail={t.detail} color={t.color} href={t.href} />)}
      </View>

      <View style={{ gap: S.sm }}>
        <H2>Pénzügyi oldalak</H2>
        {MENU.map((m) => (
          <Pressable key={m.href} onPress={() => router.push(m.href as any)} style={({ pressed }) => ({
            flexDirection: 'row', alignItems: 'center', gap: S.md,
            backgroundColor: C.card, borderRadius: S.radiusSm, borderWidth: 1, borderColor: C.border,
            padding: S.md, opacity: pressed ? 0.7 : 1,
          })}>
            <Text style={{ fontSize: 24 }}>{m.icon}</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: '700', color: C.text }}>{m.label}</Text>
              <Sub>{m.sub}</Sub>
            </View>
            <Text style={{ color: C.sub, fontSize: 18 }}>›</Text>
          </Pressable>
        ))}
      </View>
    </Screen>
  );
}

/** Vezetői oldal: munkavállalói fiók nem nyithatja meg (a hookok
 *  sorrendje miatt külön burkolóban, nem a komponensen belüli korai visszatéréssel). */
export default function Finance() {
  if (useIsWorker()) return <Screen><Empty text="Nincs jogosultságod ehhez az oldalhoz." /></Screen>;
  return <FinanceInner />;
}
