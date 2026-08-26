import React, { useMemo, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import { Screen, Card, H2, Sub, KV, Divider, Empty } from '../ui/kit';
import { C, S } from '../ui/theme';
import { useTable } from '../lib/hooks';
import { ft, todayISO, monthName } from '../lib/format';
import { Expense, Attendance, Invoice, Site, Worker, ExpenseCategory, Profile, ExternalPerson } from '../lib/types';

const PIE_COLORS = ['#1F4E5F', '#F5A623', '#2E7D32', '#C0392B', '#7B1FA2', '#0288D1', '#5D4037', '#607D8B'];

type Period = 'month' | '3months' | 'year' | 'all';

function periodStart(p: Period): string {
  const t = todayISO();
  const [y, m] = [Number(t.slice(0, 4)), Number(t.slice(5, 7))];
  if (p === 'month') return `${t.slice(0, 7)}-01`;
  if (p === '3months') {
    const d = new Date(y, m - 1 - 2, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
  }
  if (p === 'year') return `${y}-01-01`;
  return '0000-01-01';
}

function Pie({ data }: { data: { label: string; value: number }[] }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total <= 0) return <Empty text="Nincs adat az időszakban." />;
  const size = 160; const r = 70; const cx = size / 2; const cy = size / 2;
  let angle = -Math.PI / 2;
  const paths = data.map((d, i) => {
    const frac = d.value / total;
    const a2 = angle + frac * Math.PI * 2;
    const large = frac > 0.5 ? 1 : 0;
    const x1 = cx + r * Math.cos(angle); const y1 = cy + r * Math.sin(angle);
    const x2 = cx + r * Math.cos(a2); const y2 = cy + r * Math.sin(a2);
    const path = frac >= 0.999
      ? `M ${cx - r} ${cy} A ${r} ${r} 0 1 1 ${cx + r} ${cy} A ${r} ${r} 0 1 1 ${cx - r} ${cy}`
      : `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`;
    angle = a2;
    return <Path key={i} d={path} fill={PIE_COLORS[i % PIE_COLORS.length]} />;
  });
  return (
    <View style={{ flexDirection: 'row', gap: S.lg, alignItems: 'center', flexWrap: 'wrap' }}>
      <Svg width={160} height={160}>{paths}</Svg>
      <View style={{ gap: 4, flex: 1, minWidth: 140 }}>
        {data.map((d, i) => (
          <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }} />
            <Text style={{ fontSize: 12, color: C.text, flex: 1 }} numberOfLines={1}>{d.label}</Text>
            <Text style={{ fontSize: 12, fontWeight: '700' }}>{Math.round(d.value / total * 100)}%</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function Bars({ data }: { data: { label: string; cost: number; revenue: number }[] }) {
  if (data.length === 0) return <Empty text="Nincs adat az időszakban." />;
  const max = Math.max(...data.map((d) => Math.max(d.cost, d.revenue)), 1);
  const bw = 14; const gap = 26; const h = 120;
  const width = data.length * (bw * 2 + gap) + 10;
  return (
    <View>
      <Svg width={width} height={h + 20}>
        {data.map((d, i) => {
          const x = i * (bw * 2 + gap) + 10;
          const hc = Math.round(d.cost / max * h);
          const hr = Math.round(d.revenue / max * h);
          return (
            <React.Fragment key={i}>
              <Rect x={x} y={h - hc} width={bw} height={hc} fill={C.danger} rx={3} />
              <Rect x={x + bw + 3} y={h - hr} width={bw} height={hr} fill={C.success} rx={3} />
            </React.Fragment>
          );
        })}
      </Svg>
      <View style={{ flexDirection: 'row' }}>
        {data.map((d, i) => (
          <Text key={i} style={{ width: bw * 2 + gap, fontSize: 10, color: C.sub, textAlign: 'center' }}>{d.label}</Text>
        ))}
      </View>
      <Sub>🟥 költség · 🟩 befolyt bevétel (nettó)</Sub>
    </View>
  );
}

export default function Stats() {
  const [period, setPeriod] = useState<Period>('3months');
  // konkrét év / hónapok szűrés — ha év van választva, az felülírja a gyors gombokat;
  // több hónap is kijelölhető (nem-összefüggő is, pl. jan + márc)
  const [selYear, setSelYear] = useState<number | null>(null);
  const [selMonths, setSelMonths] = useState<Set<number>>(new Set());
  // terület-szűrő: üres = minden építkezés (a közös költségekkel együtt)
  const [selSites, setSelSites] = useState<Set<string>>(new Set());

  const allExpenses = useTable<Expense>('expenses');
  const allAttendance = useTable<Attendance>('attendance');
  const invoices = useTable<Invoice>('invoices');
  const sites = useTable<Site>('sites');
  const workers = useTable<Worker>('workers');
  const categories = useTable<ExpenseCategory>('expense_categories');
  const profiles = useTable<Profile>('profiles');
  const externals = useTable<ExternalPerson>('external_people');

  const years = useMemo(() => {
    const ys = new Set<number>();
    for (const e of allExpenses) ys.add(Number(e.expense_date.slice(0, 4)));
    for (const a of allAttendance) ys.add(Number(a.work_date.slice(0, 4)));
    for (const i of invoices) ys.add(Number(i.invoice_date.slice(0, 4)));
    ys.add(Number(todayISO().slice(0, 4)));
    return [...ys].sort((a, b) => b - a);
  }, [allExpenses, allAttendance, invoices]);

  const presetStart = periodStart(period);
  const inRange = (dateISO: string): boolean => {
    if (selYear) {
      if (Number(dateISO.slice(0, 4)) !== selYear) return false;
      return selMonths.size === 0 || selMonths.has(Number(dateISO.slice(5, 7)));
    }
    return dateISO >= presetStart;
  };

  const pickPreset = (p: Period) => { setPeriod(p); setSelYear(null); setSelMonths(new Set()); };
  const pickYear = (y: number) => {
    if (selYear === y) { setSelYear(null); setSelMonths(new Set()); } else setSelYear(y);
  };
  const pickMonth = (m: number) => {
    const next = new Set(selMonths);
    if (next.has(m)) next.delete(m); else next.add(m);
    setSelMonths(next);
    if (!selYear) setSelYear(Number(todayISO().slice(0, 4)));
  };

  // az időszak burkoló intervalluma (több hónapnál az elsőtől az utolsóig)
  const pad2 = (n: number) => String(n).padStart(2, '0');
  let rangeStart = presetStart; let rangeEnd = '9999-12-31';
  if (selYear) {
    if (selMonths.size) {
      const mMin = Math.min(...selMonths); const mMax = Math.max(...selMonths);
      rangeStart = `${selYear}-${pad2(mMin)}-01`;
      rangeEnd = mMax === 12 ? `${selYear + 1}-01-01` : `${selYear}-${pad2(mMax + 1)}-01`;
    } else {
      rangeStart = `${selYear}-01-01`;
      rangeEnd = `${selYear + 1}-01-01`;
    }
  }

  // csak az időszakban aktív területek választhatók: ami az időszak előtt
  // lezárult, vagy csak az időszak után indult (első bejegyzése későbbi), kiesik
  const firstActivity = useMemo(() => {
    const m = new Map<string, string>();
    const upd = (id: string | null, d: string) => {
      if (!id) return;
      const cur = m.get(id);
      if (!cur || d < cur) m.set(id, d);
    };
    for (const e of allExpenses) upd(e.site_id, e.expense_date);
    for (const a of allAttendance) upd(a.site_id, a.work_date);
    for (const i of invoices) upd(i.site_id, i.invoice_date);
    return m;
  }, [allExpenses, allAttendance, invoices]);

  const visibleSites = sites
    .filter((s) => {
      const closedBefore = s.status === 'closed' && !!s.closed_at && s.closed_at.slice(0, 10) < rangeStart;
      const fa = firstActivity.get(s.id);
      const startsAfter = fa ? fa >= rangeEnd : false;
      return !closedBefore && !startsAfter;
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'hu'));

  // ha az időszak-váltással kiesett egy kijelölt terület, azt nem vesszük figyelembe
  const effectiveSites = new Set([...selSites].filter((id) => visibleSites.some((s) => s.id === id)));
  const siteOk = (siteId: string | null) => effectiveSites.size === 0 || (!!siteId && effectiveSites.has(siteId));
  const toggleSelSite = (id: string) => {
    const next = new Set(selSites);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelSites(next);
  };

  const expenses = allExpenses.filter((e) => inRange(e.expense_date) && siteOk(e.site_id));
  const attendance = allAttendance.filter((a) => inRange(a.work_date) && siteOk(a.site_id));
  const paidInvoices = invoices.filter((i) => i.paid_at && inRange(i.paid_at) && siteOk(i.site_id));

  const byCategory = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of expenses) {
      const label = categories.find((c) => c.id === e.category_id)?.name ?? 'Nincs kategória';
      m.set(label, (m.get(label) ?? 0) + Number(e.net_amount));
    }
    const wageSum = attendance.reduce((s, a) => s + Number(a.amount), 0);
    if (wageSum > 0) m.set('Bérköltség', wageSum);
    return [...m.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  }, [expenses, attendance, categories]);

  const bySite = useMemo(() => sites.map((s) => {
    const cost = expenses.filter((e) => e.site_id === s.id).reduce((x, e) => x + Number(e.net_amount), 0)
      + attendance.filter((a) => a.site_id === s.id).reduce((x, a) => x + Number(a.amount), 0);
    const rev = paidInvoices.filter((i) => i.site_id === s.id).reduce((x, i) => x + Number(i.net_amount), 0);
    return { site: s, cost, rev, profit: rev - cost, margin: rev > 0 ? (rev - cost) / rev * 100 : null };
  }).filter((x) => x.cost > 0 || x.rev > 0).sort((a, b) => b.profit - a.profit), [sites, expenses, attendance, paidInvoices]);

  const monthly = useMemo(() => {
    const m = new Map<string, { cost: number; revenue: number }>();
    const get = (k: string) => { let v = m.get(k); if (!v) { v = { cost: 0, revenue: 0 }; m.set(k, v); } return v; };
    for (const e of expenses) get(e.expense_date.slice(0, 7)).cost += Number(e.net_amount);
    for (const a of attendance) get(a.work_date.slice(0, 7)).cost += Number(a.amount);
    for (const i of paidInvoices) get(i.paid_at!.slice(0, 7)).revenue += Number(i.net_amount);
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
      .map(([k, v]) => ({ label: monthName(Number(k.slice(5, 7)) - 1).slice(0, 3), ...v }));
  }, [expenses, attendance, paidInvoices]);

  const byWorker = useMemo(() => workers.map((w) => {
    const rows = attendance.filter((a) => a.worker_id === w.id);
    const total = rows.reduce((s, a) => s + Number(a.amount), 0);
    const days = rows.length;
    return { w, total, days };
  }).filter((x) => x.total > 0).sort((a, b) => b.total - a.total), [workers, attendance]);

  const commissions = useMemo(() => {
    const m = new Map<string, { name: string; total: number; paid: number; isUser: boolean }>();
    for (const a of attendance) {
      if (Number(a.commission_amount) <= 0) continue;
      const key = a.referrer_user_id ?? a.referrer_external_id ?? '?';
      const name = a.referrer_user_id
        ? profiles.find((p) => p.id === a.referrer_user_id)?.display_name ?? '?'
        : externals.find((e) => e.id === a.referrer_external_id)?.name ?? '?';
      const v = m.get(key) ?? { name, total: 0, paid: 0, isUser: !!a.referrer_user_id };
      v.total += Number(a.commission_amount);
      if (a.referrer_user_id || a.commission_paid_at) v.paid += Number(a.commission_amount);
      m.set(key, v);
    }
    return [...m.values()].sort((a, b) => b.total - a.total);
  }, [attendance, profiles, externals]);

  return (
    <Screen>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        {([
          { value: 'month', label: 'Ez a hónap' },
          { value: '3months', label: '3 hónap' },
          { value: 'year', label: 'Idén' },
          { value: 'all', label: 'Összes' },
        ] as { value: Period; label: string }[]).map((o) => {
          const on = !selYear && period === o.value;
          return (
            <Pressable
              key={o.value}
              onPress={() => pickPreset(o.value)}
              style={{ backgroundColor: on ? C.primary : C.chipBg, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 }}
            >
              <Text style={{ color: on ? '#fff' : C.text, fontSize: 13, fontWeight: '600' }}>{o.label}</Text>
            </Pressable>
          );
        })}
        <Text style={{ fontSize: 12, color: C.sub, fontWeight: '600', marginLeft: 4 }}>Év:</Text>
        {years.map((y) => {
          const on = selYear === y;
          return (
            <Pressable
              key={y}
              onPress={() => pickYear(y)}
              style={{ backgroundColor: on ? C.primary : C.chipBg, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 }}
            >
              <Text style={{ color: on ? '#fff' : C.text, fontSize: 13, fontWeight: '600' }}>{on ? '✓ ' : ''}{y}</Text>
            </Pressable>
          );
        })}
      </View>

      {selYear ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          <Text style={{ fontSize: 12, color: C.sub, fontWeight: '600' }}>Hónap:</Text>
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
            const on = selMonths.has(m);
            return (
              <Pressable
                key={m}
                onPress={() => pickMonth(m)}
                style={{ backgroundColor: on ? C.primary : C.chipBg, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999 }}
              >
                <Text style={{ color: on ? '#fff' : C.text, fontSize: 13, fontWeight: '600' }}>
                  {monthName(m - 1).slice(0, 3)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        <Text style={{ fontSize: 12, color: C.sub, fontWeight: '600' }}>Terület:</Text>
        <Pressable
          onPress={() => setSelSites(new Set())}
          style={{ backgroundColor: effectiveSites.size === 0 ? C.primary : C.chipBg, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 }}
        >
          <Text style={{ color: effectiveSites.size === 0 ? '#fff' : C.text, fontSize: 13, fontWeight: '600' }}>Mind</Text>
        </Pressable>
        {visibleSites.map((s) => {
          const on = effectiveSites.has(s.id);
          return (
            <Pressable
              key={s.id}
              onPress={() => toggleSelSite(s.id)}
              style={{ backgroundColor: on ? C.primary : C.chipBg, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 }}
            >
              <Text style={{ color: on ? '#fff' : C.text, fontSize: 13, fontWeight: '600' }}>{on ? '✓ ' : ''}{s.name}</Text>
            </Pressable>
          );
        })}
      </View>

      <Card>
        <H2>Költségek megoszlása</H2>
        <Pie data={byCategory} />
        <Divider />
        {byCategory.map((d, i) => <KV key={i} k={d.label} v={ft(d.value)} />)}
      </Card>

      <Card>
        <H2>Havi trend</H2>
        <Bars data={monthly} />
        {monthly.length > 0 ? (
          <KV k="Időszak eredménye (nettó)" strong
            v={ft(monthly.reduce((s, d) => s + d.revenue - d.cost, 0))} />
        ) : null}
      </Card>

      <Card>
        <H2>Építkezésenkénti eredmény</H2>
        {bySite.length === 0 ? <Empty text="Nincs adat." /> : null}
        {bySite.map((x) => (
          <View key={x.site.id} style={{ paddingVertical: 4 }}>
            <KV k={x.site.name} v={ft(x.profit)} strong />
            <Sub>költség {ft(x.cost)} · befolyt {ft(x.rev)}{x.margin != null ? ` · margó ${x.margin.toFixed(1)}%` : ''}</Sub>
          </View>
        ))}
      </Card>

      <Card>
        <H2>Munkavállalónkénti költség</H2>
        {byWorker.length === 0 ? <Empty text="Nincs adat." /> : null}
        {byWorker.map((x) => (
          <KV key={x.w.id} k={`${x.w.name} (${x.days} nap)`} v={ft(x.total)} />
        ))}
      </Card>

      <Card>
        <H2>Közvetítői díjak</H2>
        {commissions.length === 0 ? <Empty text="Nincs közvetítői díj az időszakban." /> : null}
        {commissions.map((cx, i) => (
          <View key={i} style={{ paddingVertical: 3 }}>
            <KV k={`${cx.name}${cx.isUser ? ' (felhasználó)' : ' (külsős)'}`} v={ft(cx.total)} />
            {!cx.isUser && cx.paid < cx.total ? <Sub>ebből kifizetetlen: {ft(cx.total - cx.paid)}</Sub> : null}
          </View>
        ))}
      </Card>
    </Screen>
  );
}
