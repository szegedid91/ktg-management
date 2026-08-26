import React, { useMemo, useState } from 'react';
import { View, Text } from 'react-native';
import { useLocalSearchParams, Stack } from 'expo-router';
import { Screen, Card, H2, Sub, Body, Btn, KV, Divider, Empty, Picker, Input, Segmented, Check, Row } from '../../ui/kit';
import { C, S } from '../../ui/theme';
import { useTable } from '../../lib/hooks';
import { insertRow, softDeleteRow, getCurrentUserId } from '../../lib/repo';
import { ft, hd, parseAmount } from '../../lib/format';
import { attendanceAmount, commissionAmount } from '../../lib/calc';
import { Attendance, Worker, Site, AppSettings, AttendanceBasis } from '../../lib/types';
import { notify, confirmDialog } from '../../lib/dialogs';

export default function DayView() {
  const { date, siteId } = useLocalSearchParams<{ date: string; siteId?: string }>();
  const sites = useTable<Site>('sites').filter((s) => s.status === 'active');
  const allSites = useTable<Site>('sites');
  const workers = useTable<Worker>('workers');
  const attendance = useTable<Attendance>('attendance');
  const settings = useTable<AppSettings>('app_settings')[0];
  const me = getCurrentUserId();

  const [site, setSite] = useState<string | null>(siteId ?? null);
  const [adding, setAdding] = useState(false);
  const [workerId, setWorkerId] = useState<string | null>(null);
  const [basis, setBasis] = useState<AttendanceBasis>('daily');
  const [hours, setHours] = useState('8');
  const [half, setHalf] = useState(false);
  const [rateOverride, setRateOverride] = useState('');

  const dayRows = attendance.filter((a) => a.work_date === date);
  const dayRowsForSite = site ? dayRows.filter((a) => a.site_id === site) : dayRows;


  const workerName = (id: string) => workers.find((w) => w.id === id)?.name ?? '?';
  const siteName = (id: string) => allSites.find((s) => s.id === id)?.name ?? '?';

  const resolveRate = (w: Worker, b: AttendanceBasis): number => {
    if (!settings) return 0;
    const co = w.worker_type === 'company';
    switch (b) {
      case 'hourly': return Number(w.hourly_rate ?? (co ? settings.company_hourly_rate : settings.individual_hourly_rate));
      case 'daily': return Number(w.daily_rate ?? (co ? settings.company_daily_rate : settings.individual_daily_rate));
      case 'project': return Number(w.project_rate ?? (co ? settings.company_project_rate : settings.individual_project_rate));
      default: return 0;
    }
  };

  const addEntry = () => {
    if (!site || !workerId) return;
    const w = workers.find((x) => x.id === workerId)!;
    const mult = half ? 0.5 : 1;
    const rate = rateOverride ? parseAmount(rateOverride) : resolveRate(w, basis);
    const amt = attendanceAmount(basis as any, rate, basis === 'hourly' ? parseAmount(hours) : null, mult);
    const comm = (w.referrer_user_id || w.referrer_external_id)
      ? commissionAmount(amt, w.commission_mode, w.commission_value != null ? Number(w.commission_value) : null, w.commission_unit, basis as any, basis === 'hourly' ? parseAmount(hours) : null, mult)
      : 0;
    insertRow('attendance', {
      work_date: date,
      site_id: site,
      worker_id: workerId,
      pay_basis: basis,
      hours: basis === 'hourly' ? parseAmount(hours) : null,
      day_multiplier: mult,
      applied_rate: rate,
      amount: amt,
      commission_amount: comm,
      referrer_user_id: w.referrer_user_id,
      referrer_external_id: w.referrer_external_id,
    });
    setAdding(false);
    setWorkerId(null);
    setRateOverride('');
  };

  /** "Tegnap ugyanaz" — lokálisan is működik (offline), a projektdíj
   *  díj nélküli jelenlétként másolódik, hogy ne terhelődjön kétszer. */
  const copyYesterday = () => {
    if (!site) return;
    const prevDates = [...new Set(attendance.filter((a) => a.site_id === site && a.work_date < date).map((a) => a.work_date))].sort();
    const prev = prevDates[prevDates.length - 1];
    if (!prev) {
      notify('Nincs mit másolni', 'Ezen az építkezésen nincs korábbi jelenléti bejegyzés.');
      return;
    }
    const existing = new Set(dayRowsForSite.map((a) => a.worker_id));
    let n = 0;
    for (const a of attendance.filter((x) => x.site_id === site && x.work_date === prev)) {
      if (existing.has(a.worker_id)) continue;
      const isProject = a.pay_basis === 'project';
      const w = workers.find((x) => x.id === a.worker_id);
      insertRow('attendance', {
        work_date: date,
        site_id: site,
        worker_id: a.worker_id,
        pay_basis: isProject ? 'presence' : a.pay_basis,
        hours: a.hours,
        day_multiplier: a.day_multiplier,
        applied_rate: isProject ? 0 : a.applied_rate,
        amount: isProject ? 0 : Number(a.amount),
        commission_amount: isProject ? 0 : Number(a.commission_amount),
        referrer_user_id: w?.referrer_user_id ?? a.referrer_user_id,
        referrer_external_id: w?.referrer_external_id ?? a.referrer_external_id,
      });
      n++;
    }
    notify('Kész', `${n} bejegyzés átmásolva innen: ${hd(prev)}`);
  };

  const basisLabel = (a: Attendance) =>
    a.pay_basis === 'hourly' ? `${a.hours} óra`
      : a.pay_basis === 'daily' ? (Number(a.day_multiplier) === 0.5 ? 'fél nap' : 'egész nap')
        : a.pay_basis === 'project' ? 'projektdíjas'
          : 'jelenlét';

  /** Gyors hozzáadás egy koppintással, a munkavállaló alapértelmezett
   *  elszámolásával. Projektdíjasnál díj nélküli jelenlét megy, hogy a
   *  projektdíj véletlenül se terhelődjön újra — az a részletes űrlapról megy. */
  const quickAdd = (w: Worker) => {
    if (!site) return;
    const b: AttendanceBasis = w.default_pay_basis === 'project' ? 'presence' : (w.default_pay_basis ?? 'daily');
    const h = b === 'hourly' ? 8 : null;
    const rate = b === 'presence' ? 0 : resolveRate(w, b);
    const amt = attendanceAmount(b as any, rate, h, 1);
    const comm = (w.referrer_user_id || w.referrer_external_id)
      ? commissionAmount(amt, w.commission_mode, w.commission_value != null ? Number(w.commission_value) : null, w.commission_unit, b as any, h, 1)
      : 0;
    insertRow('attendance', {
      work_date: date, site_id: site, worker_id: w.id,
      pay_basis: b, hours: h, day_multiplier: 1,
      applied_rate: rate, amount: amt, commission_amount: comm,
      referrer_user_id: w.referrer_user_id, referrer_external_id: w.referrer_external_id,
    });
  };

  // hátralévő munkások szakipar szerint csoportosítva (általánosok a végén)
  const remainingGroups = (() => {
    const remaining = workers
      .filter((w) => !dayRowsForSite.some((a) => a.worker_id === w.id))
      .sort((a, b) => a.name.localeCompare(b.name, 'hu'));
    const m = new Map<string, Worker[]>();
    for (const w of remaining) {
      const key = w.trade ?? 'Általános';
      const arr = m.get(key) ?? [];
      arr.push(w);
      m.set(key, arr);
    }
    return [...m.entries()]
      .sort((a, b) => {
        if (a[0] === 'Általános') return 1;
        if (b[0] === 'Általános') return -1;
        return a[0].localeCompare(b[0], 'hu');
      })
      .map(([trade, list]) => ({ trade, list }));
  })();
  const remainingCount = remainingGroups.reduce((s, g) => s + g.list.length, 0);

  return (
    <Screen>
      <Stack.Screen options={{ title: hd(date) }} />

      {!site ? (
        <Card>
          <H2>Melyik építkezésen dolgoztak?</H2>
          {sites.length === 0 ? <Sub>Nincs aktív építkezés.</Sub> : null}
          {sites.map((s) => (
            <Btn key={s.id} title={`🏗️ ${s.name}`} onPress={() => setSite(s.id)} />
          ))}
        </Card>
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm }}>
          <View style={{ flex: 1 }}>
            <Body style={{ fontWeight: '700' }}>🏗️ {allSites.find((s) => s.id === site)?.name}</Body>
          </View>
          <Btn title="Másik építkezés" kind="ghost" small onPress={() => { setSite(null); setAdding(false); }} />
        </View>
      )}

      {site ? (
        <Card>
          <H2>Munkavállalók — koppints a hozzáadáshoz</H2>
          {remainingCount === 0 ? <Sub>Mindenki fel van véve mára. ✅</Sub> : null}
          {remainingGroups.map((g) => (
            <View key={g.trade} style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
              <Text style={{ fontSize: 12, fontWeight: '800', color: C.primary, textTransform: 'uppercase', letterSpacing: 0.5, width: '100%' }}>
                {g.trade === 'Általános' ? '👷 Általános' : `🛠️ ${g.trade}`}
              </Text>
              {g.list.map((w) => (
                <Text
                  key={w.id}
                  onPress={() => quickAdd(w)}
                  style={{
                    fontSize: 14, fontWeight: '600', color: C.text,
                    backgroundColor: C.card, borderWidth: 1, borderColor: C.border,
                    borderRadius: 16, paddingVertical: 6, paddingHorizontal: 12,
                    overflow: 'hidden',
                  }}
                >
                  {w.name} <Text style={{ color: C.success, fontWeight: '800' }}>＋</Text>
                </Text>
              ))}
            </View>
          ))}
          <View style={{ flexDirection: 'row', gap: S.md }}>
            <View style={{ flex: 1 }}>
              <Btn title="Részletes hozzáadás…" kind="ghost" small onPress={() => setAdding(true)} />
            </View>
            <View style={{ flex: 1 }}>
              <Btn title="📋 Tegnap ugyanaz" kind="secondary" small onPress={copyYesterday} />
            </View>
          </View>
        </Card>
      ) : null}

      {adding && site ? (
        <Card>
          <H2>Jelenlét hozzáadása</H2>
          <Picker
            label="Munkavállaló"
            items={workers.filter((w) => !dayRowsForSite.some((a) => a.worker_id === w.id))}
            selectedId={workerId}
            getId={(w) => w.id}
            getLabel={(w) => w.name}
            onSelect={(id) => {
              setWorkerId(id);
              const w = workers.find((x) => x.id === id);
              if (w?.default_pay_basis) setBasis(w.default_pay_basis);
            }}
          />
          <Segmented
            label="Elszámolás"
            options={[
              { value: 'hourly', label: 'Órabér' },
              { value: 'daily', label: 'Napi díj' },
              { value: 'project', label: 'Projektdíj (egyszeri)' },
              { value: 'presence', label: 'Csak jelenlét' },
            ]}
            value={basis}
            onChange={setBasis}
          />
          {basis === 'hourly' ? (
            <Input label="Óraszám *" value={hours} onChangeText={setHours} keyboardType="numeric" />
          ) : null}
          {basis === 'daily' ? (
            <Check checked={half} onToggle={() => setHalf(!half)} label="Fél nap (0,5 szorzó)" />
          ) : null}
          {basis !== 'presence' ? (
            <Input label="Egyedi díj erre a napra (Ft)" value={rateOverride} onChangeText={setRateOverride} keyboardType="numeric" placeholder="üresen: alapdíj" />
          ) : null}
          {workerId && basis !== 'presence' ? (
            <Sub>
              Számított költség: {ft(attendanceAmount(
                basis as any,
                rateOverride ? parseAmount(rateOverride) : resolveRate(workers.find((w) => w.id === workerId)!, basis),
                basis === 'hourly' ? parseAmount(hours) : null,
                half ? 0.5 : 1,
              ))}
            </Sub>
          ) : null}
          {basis === 'project' ? <Sub>⚠️ A projektdíj egyszeri tétel — a mai napra terhelődik. A további napokon „Csak jelenlét”-et válassz.</Sub> : null}
          <View style={{ flexDirection: 'row', gap: S.md }}>
            <View style={{ flex: 1 }}><Btn title="Mégse" kind="ghost" onPress={() => setAdding(false)} /></View>
            <View style={{ flex: 1 }}><Btn title="Hozzáadás" onPress={addEntry} disabled={!workerId} /></View>
          </View>
        </Card>
      ) : null}

      {site ? (
      <Card>
        <H2>Napi bontás</H2>
        {dayRowsForSite.length === 0 ? <Empty text="Nincs jelenléti bejegyzés ezen a napon." /> : null}
        {dayRowsForSite.map((a) => (
          <View key={a.id} style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.border }}>
            <Body style={{ fontWeight: '700', flex: 1 }}>{workerName(a.worker_id)}</Body>
            <Sub>{!site ? siteName(a.site_id) + ' · ' : ''}{basisLabel(a)}</Sub>
            {a.created_by === me ? (
              <Text onPress={() => softDeleteRow('attendance', a.id)} style={{ color: C.danger, fontSize: 16 }} accessibilityLabel="Bejegyzés törlése">🗑️</Text>
            ) : null}
          </View>
        ))}
      </Card>
      ) : null}
    </Screen>
  );
}
