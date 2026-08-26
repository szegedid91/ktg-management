import React, { useMemo, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { router } from 'expo-router';
import { Screen, Card, H2, Sub, Btn } from '../ui/kit';
import { C, S } from '../ui/theme';
import { useTable } from '../lib/hooks';
import { ft, monthName, todayISO } from '../lib/format';
import { Attendance, Expense, Invoice } from '../lib/types';

export default function Calendar() {
  const today = todayISO();
  const [year, setYear] = useState(Number(today.slice(0, 4)));
  const [month, setMonth] = useState(Number(today.slice(5, 7)) - 1); // 0-index
  const attendance = useTable<Attendance>('attendance');
  const expenses = useTable<Expense>('expenses');
  const invoices = useTable<Invoice>('invoices');

  const prefix = `${year}-${String(month + 1).padStart(2, '0')}`;

  const byDay = useMemo(() => {
    const m = new Map<string, { cost: number; revenue: number; present: number }>();
    const get = (d: string) => {
      let v = m.get(d);
      if (!v) { v = { cost: 0, revenue: 0, present: 0 }; m.set(d, v); }
      return v;
    };
    for (const a of attendance) if (a.work_date.startsWith(prefix)) {
      const v = get(a.work_date);
      v.cost += Number(a.amount);
      v.present += 1;
    }
    for (const e of expenses) if (e.expense_date.startsWith(prefix)) get(e.expense_date).cost += Number(e.net_amount);
    for (const i of invoices) {
      if (i.invoice_date.startsWith(prefix)) get(i.invoice_date).revenue += Number(i.net_amount);
    }
    return m;
  }, [attendance, expenses, invoices, prefix]);

  const first = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startOffset = (first.getDay() + 6) % 7; // hétfő kezdés
  const cells: (number | null)[] = [
    ...Array(startOffset).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const monthCost = [...byDay.values()].reduce((s, v) => s + v.cost, 0);
  const monthRev = [...byDay.values()].reduce((s, v) => s + v.revenue, 0);

  const prev = () => { if (month === 0) { setMonth(11); setYear(year - 1); } else setMonth(month - 1); };
  const next = () => { if (month === 11) { setMonth(0); setYear(year + 1); } else setMonth(month + 1); };

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Btn title="‹" kind="ghost" small onPress={prev} />
        <H2>{year}. {monthName(month)}</H2>
        <Btn title="›" kind="ghost" small onPress={next} />
      </View>

      <Card style={{ padding: S.sm }}>
        <View style={{ flexDirection: 'row' }}>
          {['H', 'K', 'Sze', 'Cs', 'P', 'Szo', 'V'].map((d) => (
            <Text key={d} style={{ flex: 1, textAlign: 'center', fontSize: 11, fontWeight: '700', color: C.sub }}>{d}</Text>
          ))}
        </View>
        <View>
        {Array.from({ length: cells.length / 7 }, (_, w) => (
          <View key={w} style={{ flexDirection: 'row' }}>
            {cells.slice(w * 7, w * 7 + 7).map((day, i) => {
              if (!day) return <View key={i} style={{ flex: 1, height: 54 }} />;
              const iso = `${prefix}-${String(day).padStart(2, '0')}`;
              const v = byDay.get(iso);
              const isToday = iso === today;
              return (
                <Pressable
                  key={i}
                  onPress={() => router.push(`/day/${iso}`)}
                  style={{
                    flex: 1, height: 54, alignItems: 'center', paddingTop: 2,
                    borderRadius: 8, backgroundColor: isToday ? C.primary + '18' : 'transparent',
                  }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                    <Text style={{ fontSize: 13, fontWeight: isToday ? '800' : '500', color: C.text }}>{day}</Text>
                    {v?.present ? <Text style={{ fontSize: 8 }}>👷{v.present}</Text> : null}
                  </View>
                  {v && v.cost > 0 ? <Text style={{ fontSize: 9, lineHeight: 11, color: C.danger }} numberOfLines={1}>-{Math.round(v.cost / 1000)}e</Text> : null}
                  {v && v.revenue > 0 ? <Text style={{ fontSize: 9, lineHeight: 11, color: C.success }} numberOfLines={1}>+{Math.round(v.revenue / 1000)}e</Text> : null}
                </Pressable>
              );
            })}
          </View>
        ))}
        </View>
      </Card>

      <Card>
        <Sub>Havi költés (nettó): <Text style={{ fontWeight: '700', color: C.text }}>{ft(monthCost)}</Text></Sub>
        <Sub>Havi számlázott (nettó): <Text style={{ fontWeight: '700', color: C.text }}>{ft(monthRev)}</Text></Sub>
      </Card>

      <Btn title="Mai jelenlét rögzítése" onPress={() => router.push(`/day/${today}`)} />
    </Screen>
  );
}
