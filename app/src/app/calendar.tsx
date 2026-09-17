import React, { useMemo, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { router } from 'expo-router';
import { Screen, Card, H2, Sub, Btn, Empty, Input, Picker, Check, Badge } from '../ui/kit';
import { C, S } from '../ui/theme';
import { useTable, useIsWorker } from '../lib/hooks';
import { insertRow, softDeleteRow } from '../lib/repo';
import { notify } from '../lib/dialogs';
import { wname } from '../lib/tasks';
import { ft, monthName, todayISO, addDaysISO, hd } from '../lib/format';
import { Attendance, Expense, Invoice, ScheduleEntry, Site, Worker } from '../lib/types';

function CalendarInner() {
  const today = todayISO();
  const [year, setYear] = useState(Number(today.slice(0, 4)));
  const [month, setMonth] = useState(Number(today.slice(5, 7)) - 1); // 0-index
  const attendance = useTable<Attendance>('attendance');
  const expenses = useTable<Expense>('expenses');
  const invoices = useTable<Invoice>('invoices');
  // beosztás
  const schedule = useTable<ScheduleEntry>('schedule_entries');
  const allSites = useTable<Site>('sites');
  const allWorkers = useTable<Worker>('workers');
  const sites = allSites.filter((x) => x.status === 'active').sort((a, b) => a.name.localeCompare(b.name, 'hu', { sensitivity: 'base' }));
  const workers = allWorkers.filter((w) => !!w.approved_at && !w.contractor_id).sort((a, b) => a.name.localeCompare(b.name, 'hu'));
  const [selDate, setSelDate] = useState(today);
  const [selSite, setSelSite] = useState<string | null>(null);
  const [selWorkers, setSelWorkers] = useState<Set<string>>(new Set());
  const [selNote, setSelNote] = useState('');
  const dayEntries = schedule.filter((e) => e.work_date === selDate);
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(selDate);
  const saveSchedule = () => {
    if (!validDate) { notify('Hiba', 'A napot ÉÉÉÉ-HH-NN formában add meg.'); return; }
    if (!selSite) { notify('Hiba', 'Válassz építkezést.'); return; }
    let n = 0;
    for (const wid of selWorkers) {
      if (dayEntries.some((e) => e.worker_id === wid && e.site_id === selSite)) continue;
      insertRow('schedule_entries', { worker_id: wid, site_id: selSite, work_date: selDate, note: selNote.trim() || null });
      n++;
    }
    setSelWorkers(new Set()); setSelNote('');
    notify('Beosztás mentve 📆', n ? `${n} fő értesítést kap.` : 'Nem volt új beosztás.');
  };

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
                    {schedule.some((e) => e.work_date === iso) ? <Text style={{ fontSize: 8 }}>📆</Text> : null}
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

      <Card>
        <H2>📆 Beosztás</H2>
        <Sub>Ki melyik napon melyik építkezésen lesz — a beosztott munkavállaló értesítést kap, és a kezdőlapján látja.</Sub>
        <View style={{ flexDirection: 'row', gap: S.sm, alignItems: 'flex-end' }}>
          <View style={{ flex: 2 }}><Input label="Nap (ÉÉÉÉ-HH-NN)" value={selDate} onChangeText={setSelDate} placeholder={today} /></View>
          <Btn title="Ma" kind="ghost" small onPress={() => setSelDate(today)} />
          <Btn title="Holnap" kind="ghost" small onPress={() => setSelDate(addDaysISO(today, 1))} />
          <Btn title="+1" kind="ghost" small onPress={() => validDate && setSelDate(addDaysISO(selDate, 1))} />
        </View>
        {validDate ? (
          dayEntries.length === 0 ? <Sub>{hd(selDate)}: még nincs beosztás.</Sub> : (
            <View style={{ gap: 4 }}>
              {allSites.filter((st) => dayEntries.some((e) => e.site_id === st.id)).map((st) => (
                <View key={st.id} style={{ gap: 2 }}>
                  <Text style={{ fontWeight: '700', color: C.text }}>🏗️ {st.name}</Text>
                  {dayEntries.filter((e) => e.site_id === st.id).map((e) => (
                    <View key={e.id} style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm, paddingLeft: S.md }}>
                      <Text style={{ flex: 1, color: C.text }}>👷 {wname(allWorkers.find((w) => w.id === e.worker_id))}{e.note ? ` · ${e.note}` : ''}</Text>
                      <Btn title="🗑️" kind="ghost" small onPress={() => softDeleteRow('schedule_entries', e.id)} />
                    </View>
                  ))}
                </View>
              ))}
            </View>
          )
        ) : null}
        <Picker label="Építkezés" items={sites} selectedId={selSite} getId={(x) => x.id} getLabel={(x) => `${x.name}${x.address ? ` · ${x.address}` : ''}`} onSelect={setSelSite} placeholder="Válassz építkezést…" />
        <Sub style={{ fontWeight: '700' }}>Kit osztasz be?</Sub>
        {workers.map((w) => {
          const elsewhere = dayEntries.filter((e) => e.worker_id === w.id && e.site_id !== selSite);
          const here = !!selSite && dayEntries.some((e) => e.worker_id === w.id && e.site_id === selSite);
          return (
            <View key={w.id} style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm }}>
              <View style={{ flex: 1 }}>
                <Check checked={here || selWorkers.has(w.id)} onToggle={() => { if (here) return; setSelWorkers((prev) => { const n = new Set(prev); if (n.has(w.id)) n.delete(w.id); else n.add(w.id); return n; }); }}
                  label={`${wname(w)}${w.is_contractor ? ' 👥' : ''}`} sub={here ? 'már beosztva ide' : (w.trade ?? undefined)} />
              </View>
              {elsewhere.length ? <Badge text={`⚠ már: ${elsewhere.map((e) => sites.find((x) => x.id === e.site_id)?.name ?? '?').join(', ')}`} color={C.warning} /> : null}
            </View>
          );
        })}
        <Input label="Megjegyzés (opcionális)" value={selNote} onChangeText={setSelNote} placeholder="pl. 7-kor kezdés, hozd a keverőt" />
        <Btn title={`Beosztás mentése${selWorkers.size ? ` (${selWorkers.size} fő)` : ''}`} disabled={!selSite || selWorkers.size === 0 || !validDate} onPress={saveSchedule} />
      </Card>
    </Screen>
  );
}

/** Fő felhasználói oldal: munkavállalói fiók nem nyithatja meg (a hookok
 *  sorrendje miatt külön burkolóban, nem a komponensen belüli korai visszatéréssel). */
export default function Calendar() {
  if (useIsWorker()) return <Screen><Empty text="Nincs jogosultságod ehhez az oldalhoz." /></Screen>;
  return <CalendarInner />;
}
