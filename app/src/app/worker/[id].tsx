import React, { useMemo, useState } from 'react';
import { View, Text } from 'react-native';
import { useLocalSearchParams, router, Stack } from 'expo-router';
import { smartBack } from '../../lib/nav';
import { Screen, Card, H2, Sub, Body, Btn, KV, Empty, Badge, Divider, Segmented } from '../../ui/kit';
import { C, S } from '../../ui/theme';
import { useRow, useTable, useIsWorker } from '../../lib/hooks';
import { getCurrentUserId, softDeleteRow, updateRow, callRpc } from '../../lib/repo';
import { ft, hd } from '../../lib/format';
import { Worker, Attendance, Site, Profile, ExternalPerson, AppSettings, WorkerTask, TaskAssignee, WorkSession } from '../../lib/types';
import { isActiveTask, TASK_STATUS_LABEL, fmtHours, sessionHours } from '../../lib/tasks';
import { hdt } from '../../lib/format';
import { Comments } from '../../components/Comments';
import { CallButton, CopyButton } from '../workers/index';
import { WorkerForm, workerToForm, formToRow, validateWorkerForm, WorkerFormValues } from '../../components/WorkerForm';
import { InviteCard } from '../../components/InviteCard';
import { SessionEditor } from '../../components/SessionEditor';
import { notify, confirmDialog } from '../../lib/dialogs';
import { syncNow } from '../../lib/sync';

function WorkerDetailInner() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const worker = useRow<Worker>('workers', id);
  const myTasks = useTable<TaskAssignee>('task_assignees').filter((a) => a.worker_id === id).map((a) => a.task_id);
  const tasks = useTable<WorkerTask>('worker_tasks').filter((t) => myTasks.includes(t.id))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const sessions = useTable<WorkSession>('work_sessions').filter((s) => s.worker_id === id)
    .sort((a, b) => b.started_at.localeCompare(a.started_at));
  const allAttendance = useTable<Attendance>('attendance');
  const attendance = allAttendance.filter((a) => a.worker_id === id);
  const allWorkers = useTable<Worker>('workers');
  const workers = allWorkers;
  const crewOf = allWorkers.filter((w) => w.contractor_id === id).sort((a, b) => a.name.localeCompare(b.name, 'hu'));
  const crewTotals = useMemo(() => {
    const m = new Map<string, { earned: number; unpaid: number }>();
    for (const c of crewOf) {
      const rows = allAttendance.filter((a) => a.worker_id === c.id && a.pay_basis !== 'presence');
      const earned = rows.reduce((s, a) => s + Number(a.amount) - Number(a.commission_amount), 0);
      const unpaid = rows.filter((a) => !a.paid_at).reduce((s, a) => s + Number(a.amount) - Number(a.commission_amount), 0);
      m.set(c.id, { earned, unpaid });
    }
    return m;
  }, [crewOf, allAttendance]);
  const sites = useTable<Site>('sites');
  const profiles = useTable<Profile>('profiles');
  const externals = useTable<ExternalPerson>('external_people');
  const settings = useTable<AppSettings>('app_settings')[0];
  const me = getCurrentUserId();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<WorkerFormValues | null>(null);
  const [bank, setBank] = useState<string | null>(null);
  const [payFilter, setPayFilter] = useState<'all' | 'paid' | 'unpaid'>('all');
  const [showCount, setShowCount] = useState(30);

  const history = useMemo(
    () => [...attendance]
      .filter((a) => {
        if (payFilter === 'all') return true;
        const hasWage = a.pay_basis !== 'presence' && Number(a.amount) - Number(a.commission_amount) > 0;
        if (payFilter === 'paid') return hasWage && !!a.paid_at;
        return hasWage && !a.paid_at;
      })
      .sort((a, b) => b.work_date.localeCompare(a.work_date)),
    [attendance, payFilter],
  );
  const filteredSum = useMemo(
    () => history.reduce((s, a) => s + Number(a.amount) - Number(a.commission_amount), 0),
    [history],
  );
  const totals = useMemo(() => {
    const earned = attendance.reduce((s, a) => s + Number(a.amount) - Number(a.commission_amount), 0);
    const paid = attendance.filter((a) => a.paid_at).reduce((s, a) => s + Number(a.amount) - Number(a.commission_amount), 0);
    return { earned, paid, unpaid: earned - paid };
  }, [attendance]);

  if (!worker) return <Screen><Empty text="Munkavállaló nem található." /></Screen>;
  const isPartner = !profiles.find((p) => p.id === me)?.worker_id;
  const hasAccount = profiles.some((p) => p.worker_id === worker.id);

  // a közvetítőt az adatlapon szándékosan sehol nem írjuk ki (csak a szerkesztő űrlapon állítható)

  // Ha van közvetítő, az embernél a NEKI járó díjat mutatjuk (pl. 8 000 Ft órabérből
  // 1 000 Ft a közvetítőé → 7 000 Ft), bontás nélkül. A kiszállás 1 órának számít.
  const hasReferrer = !!(worker.referrer_user_id || worker.referrer_external_id) && !!worker.commission_mode;
  const cut = (gross: number, unit: 'hour' | 'day' | 'project'): number => {
    if (!hasReferrer) return 0;
    const v = Number(worker.commission_value ?? 0);
    const c = worker.commission_mode === 'percent' ? Math.round(gross * v) / 100 : worker.commission_unit === unit ? v : 0;
    return Math.max(0, Math.min(c, gross));
  };
  const netText = (gross: number, unit: 'hour' | 'day' | 'project') => {
    const c = cut(gross, unit);
    return ft(gross - c);
  };
  const rateLine = (label: string, own: number | null, globalCompany: number, globalIndividual: number, unit: 'hour' | 'day' | 'project') => {
    const global = worker.worker_type === 'company' ? globalCompany : globalIndividual;
    const val = own ?? global;
    if (own == null && !global) return <KV k={label} v="nincs beállítva" />;
    return <KV k={label} v={`${netText(val, unit)}${own == null ? ' (öröklött)' : ''}`} />;
  };

  // meghívóval regisztrált, még jóvá nem hagyott munkavállaló: a jóváhagyás
  // előtt összefoglaljuk, milyen díjazással lép be, és rákérdezünk
  const pendingApproval = !worker.approved_at;
  const rateText = (own: number | null, globalCompany: number, globalIndividual: number) => {
    const global = worker.worker_type === 'company' ? globalCompany : globalIndividual;
    const val = own ?? global;
    if (own == null && !global) return 'nincs beállítva (örökölné, de a Beállításokban üres)';
    return `${ft(val)}${own == null ? ' (örökölt alapdíj)' : ''}`;
  };
  const approve = async () => {
    const s = settings;
    const lines = [
      `Név: ${worker.name}${worker.nickname ? ` „${worker.nickname}”` : ''}`,
      `Típus: ${worker.worker_type === 'company' ? 'céges' : 'magánszemély'}${worker.trade ? ` · ${worker.trade}` : ''}`,
      `Jellemző elszámolás: ${worker.default_pay_basis === 'hourly' ? 'órabér' : worker.default_pay_basis === 'daily' ? 'napi díj' : worker.default_pay_basis === 'project' ? 'projektdíj' : 'nincs megadva'}`,
      s ? `Órabér: ${rateText(worker.hourly_rate, Number(s.company_hourly_rate), Number(s.individual_hourly_rate))}` : '',
      s ? `Napi díj: ${rateText(worker.daily_rate, Number(s.company_daily_rate), Number(s.individual_daily_rate))}` : '',
      s ? `Projektdíj: ${rateText(worker.project_rate, Number(s.company_project_rate), Number(s.individual_project_rate))}` : '',
    ].filter(Boolean);
    const ok = await confirmDialog(
      'Jóváhagyás — ezzel a díjazással',
      `${lines.join('\n')}\n\nRendben van minden? Ha módosítanál, előbb a Szerkesztés gombbal állítsd be a díjazást.`,
      'Igen, jóváhagyom',
    );
    if (!ok) return;
    try {
      await callRpc('approve_worker', { p_worker: worker.id });
      void syncNow(); // a szerver által állított jóváhagyás lehúzása
      notify('Jóváhagyva', `${worker.name} mostantól be tud lépni; értesítést kapott.`);
    } catch (e: any) {
      notify('Hiba', String(e?.message ?? e));
    }
  };
  const reject = async () => {
    const ok = await confirmDialog('Elutasítás', `Biztosan elutasítod ${worker.name} regisztrációját? A fiókja nem fog tudni belépni.`, 'Elutasítás', true);
    if (!ok) return;
    try {
      await callRpc('reject_worker', { p_worker: worker.id });
      smartBack();
    } catch (e: any) {
      notify('Hiba', String(e?.message ?? e));
    }
  };

  const showBank = async () => {
    try {
      const acc = await callRpc<string>('get_worker_bank_account', { p_worker: worker.id });
      setBank(acc ?? 'nincs megadva');
    } catch {
      notify('Hiba', 'A bankszámlaszám megtekintéséhez internet kell.');
    }
  };

  const saveEdit = async () => {
    if (!form) return;
    const err = validateWorkerForm(form);
    if (err) { notify('Hiba', err); return; }
    updateRow('workers', worker.id, formToRow(form));
    if (form.bank_account.trim()) {
      try {
        await callRpc('set_worker_bank_account', { p_worker: worker.id, p_account: form.bank_account.trim() });
      } catch {
        notify('Figyelem', 'A bankszámlaszám mentéséhez internet kell — most nem sikerült.');
      }
    }
    setEditing(false);
  };

  if (editing && form) {
    return (
      <Screen>
        <Stack.Screen options={{ title: worker.name }} />
        <WorkerForm value={form} onChange={setForm} />
        <View style={{ flexDirection: 'row', gap: S.md }}>
          <View style={{ flex: 1 }}><Btn title="Mégse" kind="ghost" onPress={() => setEditing(false)} /></View>
          <View style={{ flex: 1 }}><Btn title="Mentés" onPress={() => void saveEdit()} /></View>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: worker.nickname ? `${worker.name} „${worker.nickname}”` : worker.name }} />
      {pendingApproval ? (
        <Card style={{ borderColor: '#B7791F', backgroundColor: C.warnBg }}>
          <H2>⏳ Jóváhagyásra váró regisztráció</H2>
          <Sub>
            {worker.name} meghívóval regisztrált{worker.email ? ` (${worker.email})` : ''}. Amíg nem hagyod jóvá, nem tud belépni.
            Nézd át a díjazást (lent), szükség esetén szerkeszd, majd hagyd jóvá.
          </Sub>
          <View style={{ flexDirection: 'row', gap: S.md }}>
            <View style={{ flex: 1 }}><Btn title="Elutasítás" kind="danger" small onPress={() => void reject()} /></View>
            <View style={{ flex: 2 }}><Btn title="✅ Jóváhagyás" small onPress={() => void approve()} /></View>
          </View>
        </Card>
      ) : null}
      {worker.contractor_id ? (
        <Card style={{ borderColor: C.primary }}>
          <Sub>👥 <Text style={{ fontWeight: '700', color: C.text }}>{workers.find((w) => w.id === worker.contractor_id)?.name ?? 'vállalkozó'}</Text> embere — a bére a vállalkozóhoz kerül, itt emberenként részletezve.</Sub>
          <Btn title="A vállalkozó oldala" kind="ghost" small onPress={() => router.push(`/worker/${worker.contractor_id}`)} />
        </Card>
      ) : null}
      {worker.is_contractor ? (
        <Card>
          <H2>👥 Emberei ({crewOf.length})</H2>
          {crewOf.length === 0 ? <Sub>Még nem vett fel embert — a saját appjában tudja felvenni.</Sub> : null}
          {crewOf.map((c) => (
            <View key={c.id} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 3, borderBottomWidth: 1, borderBottomColor: C.border }}>
              <View style={{ flex: 1 }}>
                <Body style={{ fontWeight: '600' }}>{c.name}</Body>
                <Sub>{c.trade ?? '—'} · bér összesen {ft(crewTotals.get(c.id)?.earned ?? 0)} · kifizetetlen {ft(crewTotals.get(c.id)?.unpaid ?? 0)}</Sub>
              </View>
              <Btn title="›" kind="ghost" small onPress={() => router.push(`/worker/${c.id}`)} />
            </View>
          ))}
          {crewOf.length ? <KV k="Emberek bére összesen (kifizetetlen)" v={ft([...crewTotals.values()].reduce((s, t) => s + t.unpaid, 0))} strong /> : null}
        </Card>
      ) : null}
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm }}>
          <H2>{worker.name}</H2>
          {worker.trade ? <Badge text={`🛠️ ${worker.trade}`} color={C.primary} /> : null}
          <Badge text={worker.worker_type === 'company' ? 'céges' : 'magánszemély'} />
          {worker.worker_type === 'company' && worker.is_vat_payer ? <Badge text={`ÁFA ${worker.vat_rate}%`} color={C.warning} /> : null}
        </View>
        <KV k="Név" v={worker.name} />
        <KV k="Becenév" v={worker.nickname || '—'} />
        {worker.phones.length === 0 ? <KV k="Telefonszám" v="—" /> : null}
        {worker.phones.map((p) => (
          <View key={p} style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm, paddingVertical: 3 }}>
            <Sub>Telefonszám</Sub>
            <Text selectable style={{ flex: 1, textAlign: 'right', fontWeight: '700', color: C.text, fontSize: 15 }}>{p}</Text>
            <CopyButton text={p} small />
            <CallButton phone={p} small />
          </View>
        ))}
        {worker.email ? <KV k="Email" v={worker.email} /> : null}
        {worker.company_name ? <KV k="Cégnév" v={worker.company_name} /> : null}
        {worker.tax_number ? <KV k="Adószám" v={worker.tax_number} /> : null}
        {worker.hq_address ? <KV k="Székhely" v={worker.hq_address} /> : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm }}>
          <Sub>Bankszámlaszám:</Sub>
          {bank ? <Body>{bank}</Body> : <Btn title="Megjelenítés" kind="ghost" small onPress={() => void showBank()} />}
        </View>
        {worker.note ? <Sub>{worker.note}</Sub> : null}
        {isPartner || pendingApproval ? (
          <View style={{ flexDirection: 'row', gap: S.md }}>
            <View style={{ flex: 1 }}>
              <Btn title="Szerkesztés" kind="ghost" small onPress={() => { setForm(workerToForm(worker)); setEditing(true); }} />
            </View>
            <View style={{ flex: 1 }}>
              <Btn title="Törlés" kind="danger" small onPress={() => {
                void confirmDialog('Törlés', `Biztosan törlöd: ${worker.name}?`, 'Törlés', true).then((ok) => {
                  if (ok) { softDeleteRow('workers', worker.id); smartBack(); }
                });
              }} />
            </View>
          </View>
        ) : <Sub>Csak a rögzítője szerkesztheti.</Sub>}
      </Card>

      {isPartner && !hasAccount && !pendingApproval && !worker.contractor_id ? <InviteCard workerId={worker.id} workerName={worker.nickname || worker.name} email={worker.email} /> : null}
      <Card>
        <H2>Díjazás</H2>
        {settings ? (
          <>
            {rateLine('Órabér', worker.hourly_rate, Number(settings.company_hourly_rate), Number(settings.individual_hourly_rate), 'hour')}
            {rateLine('Napi díj', worker.daily_rate, Number(settings.company_daily_rate), Number(settings.individual_daily_rate), 'day')}
            {rateLine('Projektdíj', worker.project_rate, Number(settings.company_project_rate), Number(settings.individual_project_rate), 'project')}
            {(() => {
              const def = worker.worker_type === 'company' ? settings.company_callout_fee : settings.individual_callout_fee;
              // alapértelmezés nélkül a kiszállás = 1 óra bére
              const hourly = Number(worker.hourly_rate ?? (worker.worker_type === 'company' ? settings.company_hourly_rate : settings.individual_hourly_rate) ?? 0);
              const text = worker.callout_fee != null ? (Number(worker.callout_fee) === 0 ? 'nincs' : netText(Number(worker.callout_fee), 'hour'))
                : def != null ? `${netText(Number(def), 'hour')} (alapértelmezett)` : hourly ? `${netText(hourly, 'hour')} — 1 óra bére (alapértelmezett)` : '1 óra bére (alapértelmezett)';
              return <KV k="Kiszállási díj (helyszín / nap)" v={text} />;
            })()}
          </>
        ) : null}
      </Card>

      <Card>
        <H2>Munkatörténet</H2>
        <KV k="Összes megkeresett (nettó)" v={ft(totals.earned)} />
        <KV k="Ebből kifizetve" v={ft(totals.paid)} />
        {totals.unpaid > 0 ? <KV k="⚠️ Kifizetetlen" v={ft(totals.unpaid)} strong /> : null}
        <Divider />
        <Segmented
          options={[
            { value: 'all', label: 'Mind' },
            { value: 'paid', label: 'Kifizetve' },
            { value: 'unpaid', label: 'Kifizetetlen' },
          ]}
          value={payFilter}
          onChange={(v) => { setPayFilter(v); setShowCount(30); }}
        />
        {payFilter !== 'all' ? (
          <KV
            k={`${payFilter === 'paid' ? 'Kifizetve' : 'Kifizetetlen'} összesen (${history.length} nap)`}
            v={ft(filteredSum)}
            strong
          />
        ) : null}
        {history.length === 0 ? (
          <Empty text={payFilter === 'all' ? 'Még nincs jelenléti bejegyzés.'
            : payFilter === 'paid' ? 'Még nincs kifizetett tétel.' : 'Nincs kifizetetlen tétel. ✅'} />
        ) : null}
        {history.slice(0, showCount).map((a) => (
          <View key={a.id} style={{ paddingVertical: 3, borderBottomWidth: 1, borderBottomColor: C.border }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Sub>{hd(a.work_date)} · {sites.find((s) => s.id === a.site_id)?.name ?? '?'}
                {a.pay_basis === 'hourly' ? ` · ${a.hours} ó` : a.pay_basis === 'daily' ? (Number(a.day_multiplier) !== 1 ? ` · ${a.day_multiplier} nap` : '') : a.pay_basis === 'project' ? ' · projektdíj' : ' · jelenlét'}
                {a.source === 'session' ? ' · ⏱' : a.source === 'task' ? ' · 💬' : ''}
              </Sub>
              <Text style={{ fontSize: 13, fontWeight: '600', color: a.paid_at ? C.success : C.text }}>
                {ft(Number(a.amount) - Number(a.commission_amount))}{a.paid_at ? ' ✓' : ''}
              </Text>
            </View>
            {a.paid_at ? (
              <Sub style={{ fontSize: 11 }}>
                kifizetve: {hd(a.paid_at)} · {profiles.find((p) => p.id === a.paid_by)?.display_name ?? '?'}
                {a.paid_note ? ` — „${a.paid_note}”` : ''}
              </Sub>
            ) : null}
          </View>
        ))}
        {history.length > showCount ? (
          <Btn title={`Továbbiak (még ${history.length - showCount} nap)`} kind="ghost" small
            onPress={() => setShowCount(showCount + 50)} />
        ) : null}
      </Card>

      <Comments entityType="worker" entityId={worker.id} />


      <Card>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <H2>🛠️ Feladatok ({tasks.filter(isActiveTask).length} aktív)</H2>
          <Btn title="+ Feladat" small kind="secondary" onPress={() => router.push(`/task/new?workerId=${worker.id}`)} />
        </View>
        {tasks.length === 0 ? <Sub>Még nincs kiadott feladat.</Sub> : null}
        {tasks.slice(0, 15).map((t) => (
          <View key={t.id} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 }}>
            <View style={{ flex: 1 }}>
              <Body style={{ fontWeight: '600' }}>{t.code ? `${t.code} · ` : ''}{t.title}</Body>
              <Sub>{TASK_STATUS_LABEL[t.status]}</Sub>
            </View>
            <Btn title="Megnyit" kind="ghost" small onPress={() => router.push(`/task/${t.id}`)} />
          </View>
        ))}
      </Card>

      <Card>
        <H2>⏱ Munkaidő (saját rögzítés)</H2>
        {sessions.length === 0 ? <Sub>A munkavállaló még nem rögzített munkaidőt az appban.</Sub> : null}
        {sessions.slice(0, 20).map((s) => <SessionEditor key={s.id} session={s} editable={isPartner} />)}
        {sessions.length ? <Sub style={{ fontSize: 11 }}>Ha a munkavállaló elfelejtette leállítani, itt lezárhatod vagy javíthatod az időket (✏️).</Sub> : null}
      </Card>
    </Screen>
  );
}

/** Vezetői oldal: munkavállalói fiók nem nyithatja meg (a hookok
 *  sorrendje miatt külön burkolóban, nem a komponensen belüli korai visszatéréssel). */
export default function WorkerDetail() {
  if (useIsWorker()) return <Screen><Empty text="Nincs jogosultságod ehhez az oldalhoz." /></Screen>;
  return <WorkerDetailInner />;
}
