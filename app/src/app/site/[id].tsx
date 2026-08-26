import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { useLocalSearchParams, router, Stack } from 'expo-router';
import { Screen, Card, H2, Sub, Body, Btn, KV, Divider, Empty, Badge, Row, Segmented } from '../../ui/kit';
import { C, S } from '../../ui/theme';
import { useTable, useRow, useOnlineView } from '../../lib/hooks';
import { callRpc, fetchView, getCurrentUserId, updateRow, softDeleteRow, markInvoicePaid } from '../../lib/repo';
import { syncNow } from '../../lib/sync';
import { ft, hd } from '../../lib/format';
import { Site, Expense, Attendance, Invoice, Worker, ExpenseCategory, SiteTotals } from '../../lib/types';
import { Comments } from '../../components/Comments';
import { notify, confirmDialog } from '../../lib/dialogs';

type Tab = 'summary' | 'expenses' | 'calendar' | 'invoices' | 'equipment' | 'comments';

export default function SiteDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const site = useRow<Site>('sites', id);
  const [tab, setTab] = useState<Tab>('summary');
  const expenses = useTable<Expense>('expenses').filter((e) => e.site_id === id);
  const attendance = useTable<Attendance>('attendance').filter((a) => a.site_id === id);
  const invoices = useTable<Invoice>('invoices').filter((i) => i.site_id === id);
  const workers = useTable<Worker>('workers');
  const categories = useTable<ExpenseCategory>('expense_categories');
  const equipment = useOnlineView<any[]>(`equipment-${id}`, () => fetchView('v_equipment_current', (q) => q.eq('site_id', id)), [id]);
  const me = getCurrentUserId();

  const totals = useMemo(() => {
    const expNet = expenses.reduce((s, e) => s + Number(e.net_amount), 0);
    const expVat = expenses.reduce((s, e) => s + Number(e.vat_amount), 0);
    const wageNet = attendance.reduce((s, a) => s + Number(a.amount), 0);
    const invNet = invoices.reduce((s, i) => s + Number(i.net_amount), 0);
    const paidNet = invoices.filter((i) => i.paid_at).reduce((s, i) => s + Number(i.net_amount), 0);
    const unpaidWage = attendance.filter((a) => a.pay_basis !== 'presence' && !a.paid_at)
      .reduce((s, a) => s + Number(a.amount) - Number(a.commission_amount), 0);
    return { expNet, expVat, wageNet, invNet, paidNet, unpaidWage, cost: expNet + wageNet, profit: paidNet - expNet - wageNet };
  }, [expenses, attendance, invoices]);

  if (!site) return <Screen><Empty text="Építkezés nem található (szinkronizálás folyamatban?)" /></Screen>;
  const closed = site.status === 'closed';

  const doClose = async () => {
    try {
      const res = await callRpc<any>('close_site', { p_site: id, p_force: false });
      if (res.closed) {
        notify('Lezárva', 'Az építkezés lezárva. Mostantól csak olvasható.');
        void syncNow();
        return;
      }
      const issues: string[] = [];
      for (const i of res.unpaid_invoices ?? []) issues.push(`🧾 Be nem folyt számla: ${i.title ?? ''} (${ft(Number(i.net_amount))})`);
      for (const w of res.unpaid_wages ?? []) issues.push(`👷 Kifizetetlen bér: ${w.worker_name} ${hd(w.work_date)} (${ft(Number(w.amount))})`);
      for (const cx of res.unpaid_commissions ?? []) issues.push(`🤝 Kifizetetlen közvetítői díj: ${cx.referrer_name} (${ft(Number(cx.amount))})`);
      const ok = await confirmDialog(
        'Függő tételek',
        'A lezárási ellenőrzés hiányosságokat talált:\n\n' + issues.join('\n') + '\n\nLezárod ennek ellenére?',
        'Lezárás mindenképp', true,
      );
      if (ok) {
        await callRpc('close_site', { p_site: id, p_force: true });
        void syncNow();
      }
    } catch (e: any) {
      notify('Hiba', 'A lezáráshoz internetkapcsolat kell.\n' + String(e?.message ?? e));
    }
  };

  const doReopen = async () => {
    try {
      await callRpc('reopen_site', { p_site: id });
      void syncNow();
    } catch (e: any) {
      notify('Hiba', 'Az újranyitáshoz internetkapcsolat kell.');
    }
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: site.name }} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm }}>
        <Badge text={closed ? 'lezárt' : 'aktív'} color={closed ? C.sub : C.success} />
        {site.address ? <Sub>{site.address}</Sub> : null}
      </View>
      {closed ? <Sub style={{ color: C.warning }}>Ez az építkezés lezárt, csak olvasható.</Sub> : null}

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }}>
        <Segmented
          options={[
            { value: 'summary', label: 'Összesítés' },
            { value: 'expenses', label: `Költségek (${expenses.length})` },
            { value: 'calendar', label: 'Naptár' },
            { value: 'invoices', label: `Számlák (${invoices.length})` },
            { value: 'equipment', label: 'Eszközök' },
            { value: 'comments', label: 'Kommentek' },
          ]}
          value={tab}
          onChange={setTab}
        />
      </ScrollView>

      {tab === 'summary' ? (
        <>
          <Card>
            <H2>Pénzügyi összesítés (nettó)</H2>
            <KV k="Anyag- és egyéb költség" v={ft(totals.expNet)} />
            <KV k="Bérköltség" v={ft(totals.wageNet)} />
            <KV k="Összes költség" v={ft(totals.cost)} strong />
            <Divider />
            <KV k="Kiszámlázva" v={ft(totals.invNet)} />
            <KV k="Befolyt" v={ft(totals.paidNet)} />
            <KV k="Kintlévőség" v={ft(totals.invNet - totals.paidNet)} />
            <Divider />
            <KV k="Eredmény (befolyt − költség)" v={ft(totals.profit)} strong />
            {totals.unpaidWage > 0 ? <KV k="⚠️ Kifizetetlen bér" v={ft(totals.unpaidWage)} /> : null}
          </Card>
          {site.note ? <Card><Sub>Megjegyzés</Sub><Body>{site.note}</Body></Card> : null}
          <Card>
            {closed
              ? <Btn title="Újranyitás" kind="secondary" onPress={doReopen} />
              : <Btn title="Építkezés lezárása…" kind="danger" onPress={doClose} />}
            {!closed && site.created_by === me ? (
              <Btn title="Építkezés törlése" kind="ghost" onPress={() => {
                void confirmDialog('Törlés', `Biztosan törlöd: ${site.name}?`, 'Törlés', true).then((ok) => {
                  if (ok) { softDeleteRow('sites', site.id); router.back(); }
                });
              }} />
            ) : null}
          </Card>
        </>
      ) : null}

      {tab === 'expenses' ? (
        <>
          {!closed ? <Btn title="+ Költség rögzítése" kind="secondary" onPress={() => router.push(`/expense/new?siteId=${id}`)} /> : null}
          {expenses.length === 0 ? <Empty text="Még nincs költség." /> : null}
          {[...expenses].sort((a, b) => b.expense_date.localeCompare(a.expense_date)).map((e) => (
            <Row key={e.id} onPress={() => router.push(`/expense/${e.id}`)}>
              <View style={{ flex: 1 }}>
                <Body style={{ fontWeight: '600' }}>{e.title || 'Költség'}</Body>
                <Sub>{hd(e.expense_date)} · {categories.find((c) => c.id === e.category_id)?.name ?? 'Nincs kategória'}</Sub>
              </View>
              <Text style={{ fontWeight: '700' }}>{ft(e.net_amount)}</Text>
            </Row>
          ))}
        </>
      ) : null}

      {tab === 'calendar' ? (
        <>
          {(() => {
            const days = [...new Set(attendance.map((a) => a.work_date))].sort().reverse();
            if (days.length === 0) return <Empty text="Még nincs jelenléti bejegyzés." />;
            return days.map((d) => {
              const dayRows = attendance.filter((a) => a.work_date === d);
              const sum = dayRows.reduce((s, a) => s + Number(a.amount), 0);
              return (
                <Row key={d} onPress={() => router.push(`/day/${d}?siteId=${id}`)}>
                  <View style={{ flex: 1 }}>
                    <Body style={{ fontWeight: '600' }}>{hd(d)}</Body>
                    <Sub>{dayRows.map((a) => workers.find((w) => w.id === a.worker_id)?.name ?? '?').join(', ')}</Sub>
                  </View>
                  <Text style={{ fontWeight: '700' }}>{ft(sum)}</Text>
                </Row>
              );
            });
          })()}
        </>
      ) : null}

      {tab === 'invoices' ? (
        <>
          {!closed ? <Btn title="+ Új kimenő számla" kind="secondary" onPress={() => router.push(`/invoice/new?siteId=${id}`)} /> : null}
          {invoices.length === 0 ? <Empty text="Még nincs számla." /> : null}
          {[...invoices].sort((a, b) => b.invoice_date.localeCompare(a.invoice_date)).map((i) => (
            <Row key={i.id} onPress={() => router.push(`/invoice/${i.id}`)}>
              <View style={{ flex: 1 }}>
                <Body style={{ fontWeight: '600' }}>{i.title || 'Számla'}</Body>
                <Sub>{hd(i.invoice_date)} · {i.paid_at ? `befolyt: ${hd(i.paid_at)}` : 'nem folyt be'}</Sub>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 2 }}>
                <Text style={{ fontWeight: '700' }}>{ft(i.net_amount)}</Text>
                <Badge text={i.paid_at ? 'befolyt' : 'kintlévő'} color={i.paid_at ? C.success : C.warning} />
              </View>
            </Row>
          ))}
        </>
      ) : null}

      {tab === 'equipment' ? (
        <>
          {(equipment.data ?? []).length === 0 ? <Empty text="Nincs eszköz ezen a helyszínen." /> : null}
          {(equipment.data ?? []).map((e: any) => (
            <Row key={e.equipment_id} onPress={() => router.push('/equipment')}>
              <Body style={{ flex: 1, fontWeight: '600' }}>{e.name}</Body>
              <Sub>{e.taken_by ? `hozta: ${e.taken_by}` : ''}</Sub>
            </Row>
          ))}
          <Btn title="Eszközök kezelése" kind="ghost" onPress={() => router.push('/equipment')} />
        </>
      ) : null}

      {tab === 'comments' ? <Comments entityType="site" entityId={site.id} /> : null}
    </Screen>
  );
}
