// Pénzforgalmi előrejelzés — 4 hét előre, csak a lokális tükörből.
// Bevétel: kifizetetlen számlák a fizetési határidő hete szerint.
// Kiadás: kifizetetlen bér (mind az 1. héten, esedékes), a futó feladatok
// becsült bére (elfogadott ajánlat vagy eddigi idő × díj), és az utolsó
// 8 hét átlagos heti költsége mint ismétlődő kiadás. Minden szám BECSLÉS.

import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { Screen, Card, H2, Sub, KV, Divider, Empty, Badge } from '../ui/kit';
import { C, S } from '../ui/theme';
import { useTable } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { ft, hd, todayISO, addDaysISO } from '../lib/format';
import { isActiveTask, unpaidWorkerPart, sessionHours, wname } from '../lib/tasks';
import {
  Attendance, Invoice, Expense, WorkerTask, TaskAssignee, WorkSession, Worker, AppSettings, Profile,
} from '../lib/types';

const WEEKS = 4;
const RECURRING_WEEKS = 8; // ennyi hét költségéből átlagolunk

type ItemKind = 'invoice' | 'wage' | 'task' | 'recurring';
interface FlowItem {
  kind: ItemKind;
  label: string;
  amount: number;
  /** számlánál a határidő */
  due?: string | null;
  overdue?: boolean;
}
interface Week {
  idx: number;
  start: string;
  end: string;
  inflow: number;
  outflow: number;
  items: FlowItem[];
}

/** A hét hétfője (lokális dátum, hétfő = a hét első napja). */
function mondayOf(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  const offset = (d.getDay() + 6) % 7; // vasárnap (0) → 6, hétfő (1) → 0
  return addDaysISO(iso, -offset);
}

const KIND_ICON: Record<ItemKind, string> = { invoice: '🧾', wage: '💵', task: '🔧', recurring: '🔁' };

export default function Cashflow() {
  const { session } = useAuth();
  const profiles = useTable<Profile>('profiles');
  const invoices = useTable<Invoice>('invoices');
  const attendance = useTable<Attendance>('attendance');
  const expenses = useTable<Expense>('expenses');
  const tasks = useTable<WorkerTask>('worker_tasks');
  const assignees = useTable<TaskAssignee>('task_assignees');
  const sessions = useTable<WorkSession>('work_sessions');
  const workers = useTable<Worker>('workers');
  const settings = useTable<AppSettings>('app_settings')[0];
  const [openWeek, setOpenWeek] = useState<number | null>(0);

  const me = profiles.find((p) => p.id === session?.user.id);
  const isWorker = !!me?.worker_id;

  const today = todayISO();
  const model = useMemo(() => {
    const weekStart = mondayOf(today);
    const weeks: Week[] = Array.from({ length: WEEKS }, (_, i) => ({
      idx: i,
      start: addDaysISO(weekStart, i * 7),
      end: addDaysISO(weekStart, i * 7 + 6),
      inflow: 0, outflow: 0, items: [],
    }));
    const horizonEnd = weeks[WEEKS - 1].end;
    const put = (w: Week, item: FlowItem) => {
      w.items.push(item);
      if (item.kind === 'invoice') w.inflow += item.amount; else w.outflow += item.amount;
    };

    // ---- bevétel: kifizetetlen számlák (nettó) a határidő hete szerint ----
    let noDue = 0; let noDueCount = 0;
    let later = 0; let laterCount = 0;
    let overdueSum = 0; let overdueCount = 0;
    for (const inv of invoices) {
      if (inv.paid_at) continue;
      const amount = Number(inv.net_amount);
      const label = inv.title?.trim() || `Számla ${hd(inv.invoice_date)}`;
      if (!inv.due_date) { noDue += amount; noDueCount++; continue; }
      if (inv.due_date > horizonEnd) { later += amount; laterCount++; continue; }
      const overdue = inv.due_date < today;
      if (overdue) { overdueSum += amount; overdueCount++; }
      // lejárt → az 1. héten várjuk (bármikor befolyhat)
      const w = overdue ? weeks[0] : weeks.find((x) => inv.due_date! >= x.start && inv.due_date! <= x.end) ?? weeks[0];
      put(w, { kind: 'invoice', label, amount, due: inv.due_date, overdue });
    }

    // ---- kiadás: kifizetetlen bér — munkavállalónként, mind esedékes (1. hét) ----
    const wageByWorker = new Map<string, number>();
    for (const a of attendance) {
      const part = unpaidWorkerPart(a);
      if (part <= 0) continue;
      wageByWorker.set(a.worker_id, (wageByWorker.get(a.worker_id) ?? 0) + part);
    }
    for (const [wid, sum] of wageByWorker) {
      const w = workers.find((x) => x.id === wid);
      put(weeks[0], { kind: 'wage', label: `${wname(w)} — esedékes bér`, amount: sum });
    }

    // ---- kiadás: futó (elfogadott) feladatok becsült bére ----
    const now = Date.now();
    const rateOf = (w: Worker, basis: 'hourly' | 'daily'): number => {
      const co = w.worker_type === 'company';
      if (basis === 'hourly') return Number(w.hourly_rate ?? (co ? settings?.company_hourly_rate : settings?.individual_hourly_rate) ?? 0);
      return Number(w.daily_rate ?? (co ? settings?.company_daily_rate : settings?.individual_daily_rate) ?? 0);
    };
    let projectedTasks = 0;
    for (const t of tasks) {
      if (!isActiveTask(t)) continue;
      const ack = assignees.filter((a) => a.task_id === t.id && (a.acknowledged_at || t.status === 'acknowledged'));
      if (ack.length === 0) continue;
      // amit ehhez a feladathoz már bérként lekönyveltünk, az fent (esedékes) szerepel
      const booked = attendance.filter((a) => a.task_id === t.id).reduce((s, a) => s + Number(a.amount), 0);
      if (t.quote_accepted_at && t.quote_amount != null) {
        const est = Math.max(0, Number(t.quote_amount) - booked);
        if (est > 0) { put(weeks[0], { kind: 'task', label: `${t.title} — elfogadott ajánlat`, amount: est }); projectedTasks++; }
        continue;
      }
      for (const a of ack) {
        const w = workers.find((x) => x.id === a.worker_id);
        if (!w) continue;
        const own = sessions.filter((s) => s.task_id === t.id && s.worker_id === w.id);
        const hours = own.reduce((s, x) => s + sessionHours(x, now), 0);
        const days = new Set(own.map((x) => x.started_at.slice(0, 10))).size;
        const basis = w.default_pay_basis === 'daily' ? 'daily' : 'hourly';
        const raw = basis === 'daily' ? days * rateOf(w, 'daily') : hours * rateOf(w, 'hourly');
        // több munkavállalónál a lekönyvelt részt arányosan nem tudjuk szétosztani — csak a saját sorait vonjuk le
        const ownBooked = attendance.filter((x) => x.task_id === t.id && x.worker_id === w.id).reduce((s, x) => s + Number(x.amount), 0);
        const est = Math.max(0, Math.round(raw) - ownBooked);
        if (est > 0) { put(weeks[0], { kind: 'task', label: `${t.title} — ${wname(w)} (${basis === 'daily' ? `${days} nap` : `${hours.toFixed(1)} ó`})`, amount: est }); projectedTasks++; }
      }
    }

    // ---- kiadás: ismétlődő költség = az utolsó 8 hét átlagos heti nettó költsége ----
    const recStart = addDaysISO(today, -RECURRING_WEEKS * 7);
    const recSum = expenses.filter((e) => e.expense_date > recStart && e.expense_date <= today)
      .reduce((s, e) => s + Number(e.net_amount), 0);
    const weeklyRecurring = Math.round(recSum / RECURRING_WEEKS);
    if (weeklyRecurring > 0) {
      for (const w of weeks) put(w, { kind: 'recurring', label: `Átlagos heti költség (${RECURRING_WEEKS} hét átlaga)`, amount: weeklyRecurring });
    }

    let cum = 0;
    const rows = weeks.map((w) => {
      const net = w.inflow - w.outflow;
      cum += net;
      w.items.sort((a, b) => b.amount - a.amount);
      return { ...w, net, cum };
    });
    return { rows, noDue, noDueCount, later, laterCount, overdueSum, overdueCount, weeklyRecurring, projectedTasks, final: cum };
  }, [today, invoices, attendance, expenses, tasks, assignees, sessions, workers, settings]);

  if (isWorker) return <Screen><Empty text="Ez az oldal a fő felhasználóknak szól." /></Screen>;

  const { rows } = model;
  const totalIn = rows.reduce((s, r) => s + r.inflow, 0);
  const totalOut = rows.reduce((s, r) => s + r.outflow, 0);
  const colorOf = (n: number) => (n < 0 ? C.danger : n > 0 ? C.success : C.text);
  const cell = (w: number) => ({ width: w, paddingHorizontal: 6, paddingVertical: 6 });

  return (
    <Screen>
      <Card style={{ borderColor: model.final < 0 ? C.danger : C.success }}>
        <Sub>Várható pénzhelyzet {WEEKS} hét múlva (kumulált egyenleg)</Sub>
        <Text style={{ fontSize: 26, fontWeight: '800', color: colorOf(model.final) }}>{ft(model.final)}</Text>
        <Sub>bevétel {ft(totalIn)} · kiadás {ft(totalOut)} · {hd(rows[0].start)} – {hd(rows[WEEKS - 1].end)}</Sub>
        {model.overdueCount > 0 ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <Badge text="lejárt" color={C.danger} />
            <Sub>{model.overdueCount} kifizetetlen számla ({ft(model.overdueSum)}) — az 1. hétre számolva</Sub>
          </View>
        ) : null}
        <View style={{ backgroundColor: C.warnBg, borderRadius: S.radiusSm, padding: S.sm }}>
          <Text style={{ fontSize: 12, color: C.warning, fontWeight: '600' }}>
            ⚠️ Minden szám becslés: a számlák a határidő szerint, a bérek az eddigi munkaidő és a díjak alapján,
            a költségek az utolsó {RECURRING_WEEKS} hét átlagával. Nem tartalmazza a mai pénzkészletet.
          </Text>
        </View>
      </Card>

      <Card>
        <H2>Heti bontás</H2>
        <ScrollView horizontal showsHorizontalScrollIndicator>
          <View style={{ minWidth: 520 }}>
            <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: C.border }}>
              <Text style={[cell(120), { fontSize: 12, fontWeight: '700', color: C.sub }]}>Hét</Text>
              <Text style={[cell(100), { fontSize: 12, fontWeight: '700', color: C.sub, textAlign: 'right' }]}>Bevétel</Text>
              <Text style={[cell(100), { fontSize: 12, fontWeight: '700', color: C.sub, textAlign: 'right' }]}>Kiadás</Text>
              <Text style={[cell(100), { fontSize: 12, fontWeight: '700', color: C.sub, textAlign: 'right' }]}>Egyenleg</Text>
              <Text style={[cell(100), { fontSize: 12, fontWeight: '700', color: C.sub, textAlign: 'right' }]}>Kumulált</Text>
            </View>
            {rows.map((r) => (
              <View key={r.idx} style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: C.border, alignItems: 'center' }}>
                <View style={cell(120)}>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: C.text }}>{r.idx + 1}. hét</Text>
                  <Text style={{ fontSize: 11, color: C.sub }}>{hd(r.start).slice(5)} – {hd(r.end).slice(5)}</Text>
                </View>
                <Text style={[cell(100), { fontSize: 13, color: C.success, textAlign: 'right', fontVariant: ['tabular-nums'] }]}>{ft(r.inflow)}</Text>
                <Text style={[cell(100), { fontSize: 13, color: C.danger, textAlign: 'right', fontVariant: ['tabular-nums'] }]}>{ft(-r.outflow)}</Text>
                <Text style={[cell(100), { fontSize: 13, fontWeight: '700', color: colorOf(r.net), textAlign: 'right', fontVariant: ['tabular-nums'] }]}>{ft(r.net)}</Text>
                <Text style={[cell(100), { fontSize: 13, fontWeight: '700', color: colorOf(r.cum), textAlign: 'right', fontVariant: ['tabular-nums'] }]}>{ft(r.cum)}</Text>
              </View>
            ))}
          </View>
        </ScrollView>
        <Sub>Hétfőtől vasárnapig; a lejárt és a héten belül esedékes számlák bevételként, az esedékes bér kiadásként az 1. héten.</Sub>
      </Card>

      {(model.noDueCount > 0 || model.laterCount > 0) ? (
        <Card>
          <H2>A táblázaton kívül</H2>
          {model.noDueCount > 0 ? (
            <KV k={`Határidő nélküli kifizetetlen számla (${model.noDueCount} db)`} v={ft(model.noDue)} />
          ) : null}
          {model.laterCount > 0 ? (
            <KV k={`${WEEKS} héten túli határidő (${model.laterCount} db)`} v={ft(model.later)} />
          ) : null}
          <Sub>Ezek nem szerepelnek a heti egyenlegekben.</Sub>
        </Card>
      ) : null}

      <Card>
        <H2>Legnagyobb tételek hetenként</H2>
        {rows.map((r) => {
          const open = openWeek === r.idx;
          const top = r.items.slice(0, open ? 30 : 0);
          return (
            <View key={r.idx}>
              <Pressable onPress={() => setOpenWeek(open ? null : r.idx)} style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm, paddingVertical: 6 }}>
                <Text style={{ fontWeight: '800', fontSize: 15, color: C.text }}>{r.idx + 1}. hét</Text>
                <Text style={{ flex: 1, color: C.sub, fontSize: 13, textAlign: 'right' }} numberOfLines={1}>
                  {r.items.length} tétel · {ft(r.net)}
                </Text>
                <Text style={{ color: C.sub, fontSize: 16 }}>{open ? '▾' : '▸'}</Text>
              </Pressable>
              {open && r.items.length === 0 ? <Empty text="Nincs várható tétel ezen a héten." /> : null}
              {top.map((it, i) => (
                <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4, paddingLeft: 4 }}>
                  <Text style={{ fontSize: 13 }}>{KIND_ICON[it.kind]}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 13, color: C.text }} numberOfLines={2}>{it.label}</Text>
                    {it.kind === 'invoice' ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Text style={{ fontSize: 11, color: C.sub }}>határidő {hd(it.due)}</Text>
                        {it.overdue ? <Badge text="lejárt" color={C.danger} /> : null}
                      </View>
                    ) : null}
                  </View>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: it.kind === 'invoice' ? C.success : C.danger, fontVariant: ['tabular-nums'] }}>
                    {it.kind === 'invoice' ? '+' : '−'}{ft(it.amount)}
                  </Text>
                </View>
              ))}
              {r.idx < WEEKS - 1 ? <Divider /> : null}
            </View>
          );
        })}
        <Sub>🧾 számla (nettó) · 💵 esedékes bér · 🔧 futó feladat becsült bére ({model.projectedTasks} tétel) · 🔁 átlagos heti költség ({ft(model.weeklyRecurring)}/hét)</Sub>
      </Card>
    </Screen>
  );
}
