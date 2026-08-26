import React, { useMemo, useState } from 'react';
import { View, Text } from 'react-native';
import { useLocalSearchParams, router, Stack } from 'expo-router';
import { smartBack } from '../../lib/nav';
import { Screen, Card, H2, Sub, Body, Btn, KV, Empty, Badge, Divider, Segmented } from '../../ui/kit';
import { C, S } from '../../ui/theme';
import { useRow, useTable } from '../../lib/hooks';
import { getCurrentUserId, softDeleteRow, updateRow, callRpc } from '../../lib/repo';
import { ft, hd } from '../../lib/format';
import { Worker, Attendance, Site, Profile, ExternalPerson, AppSettings } from '../../lib/types';
import { Comments } from '../../components/Comments';
import { CallButton } from '../workers/index';
import { WorkerForm, workerToForm, formToRow, WorkerFormValues } from '../../components/WorkerForm';
import { notify, confirmDialog } from '../../lib/dialogs';

export default function WorkerDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const worker = useRow<Worker>('workers', id);
  const attendance = useTable<Attendance>('attendance').filter((a) => a.worker_id === id);
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
  const mine = worker.created_by === me;

  const referrerName = worker.referrer_user_id
    ? profiles.find((p) => p.id === worker.referrer_user_id)?.display_name
    : worker.referrer_external_id
      ? externals.find((e) => e.id === worker.referrer_external_id)?.name
      : null;

  const rateLine = (label: string, own: number | null, globalCompany: number, globalIndividual: number) => {
    const global = worker.worker_type === 'company' ? globalCompany : globalIndividual;
    const val = own ?? global;
    return <KV k={label} v={`${ft(val)}${own == null ? ' (öröklött)' : ''}`} />;
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
      <Stack.Screen options={{ title: worker.name }} />
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm }}>
          <H2>{worker.name}</H2>
          {worker.trade ? <Badge text={`🛠️ ${worker.trade}`} color={C.primary} /> : null}
          <Badge text={worker.worker_type === 'company' ? 'céges' : 'magánszemély'} />
          {worker.worker_type === 'company' && worker.is_vat_payer ? <Badge text={`ÁFA ${worker.vat_rate}%`} color={C.warning} /> : null}
        </View>
        {worker.phones.map((p) => (
          <View key={p} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Body>{p}</Body>
            <CallButton phone={p} />
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
        {mine ? (
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

      <Card>
        <H2>Díjazás</H2>
        {settings ? (
          <>
            {rateLine('Órabér', worker.hourly_rate, Number(settings.company_hourly_rate), Number(settings.individual_hourly_rate))}
            {rateLine('Napi díj', worker.daily_rate, Number(settings.company_daily_rate), Number(settings.individual_daily_rate))}
            {rateLine('Projektdíj', worker.project_rate, Number(settings.company_project_rate), Number(settings.individual_project_rate))}
          </>
        ) : null}
        {referrerName ? (
          <>
            <Divider />
            <KV k="Közvetítő" v={referrerName} />
            <KV k="Közvetítői díj" v={
              worker.commission_mode === 'percent'
                ? `${worker.commission_value}% a díjból`
                : worker.commission_mode === 'fixed'
                  ? `${ft(worker.commission_value ?? 0)} / ${worker.commission_unit === 'hour' ? 'óra' : worker.commission_unit === 'day' ? 'nap' : 'projekt'}`
                  : '—'
            } />
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
              </Sub>
              <Text style={{ fontSize: 13, fontWeight: '600', color: a.paid_at ? C.success : C.text }}>
                {ft(Number(a.amount) - Number(a.commission_amount))}{a.paid_at ? ' ✓' : ''}
              </Text>
            </View>
            {a.paid_at ? (
              <Sub style={{ fontSize: 11 }}>
                kifizetve: {hd(a.paid_at)} · {profiles.find((p) => p.id === a.paid_by)?.display_name ?? '?'}
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
    </Screen>
  );
}
