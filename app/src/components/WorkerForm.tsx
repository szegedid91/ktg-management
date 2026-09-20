// Munkavállaló űrlap — új felvétel és szerkesztés is ezt használja

import React, { useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { Card, Input, Btn, Segmented, Picker, Sub } from '../ui/kit';
import { C, S } from '../ui/theme';
import { useTable } from '../lib/hooks';
import { Worker, Profile, ExternalPerson, PayBasis, AppSettings } from '../lib/types';
import { insertRow } from '../lib/repo';
import { parseAmount, ft } from '../lib/format';

export const COMMON_TRADES = [
  'Villanyszerelő', 'Vízszerelő', 'Kőműves', 'Burkoló', 'Ács', 'Festő',
  'Gipszkartonos', 'Bádogos', 'Hegesztő', 'Tetőfedő', 'Asztalos', 'Kertész',
];

export interface WorkerFormValues {
  name: string;
  nickname: string;
  kind: 'general' | 'specialist';
  trade: string;
  phones: string;
  email: string;
  company_name: string;
  tax_number: string;
  hq_address: string;
  bank_account: string; // RPC-n át tárolódik titkosítva
  note: string;
  worker_type: 'company' | 'individual';
  is_vat_payer: boolean;
  vat_rate: string;
  default_pay_basis: PayBasis | null;
  hourly_rate: string;
  daily_rate: string;
  project_rate: string;
  callout_fee: string;
  referrer_kind: 'none' | 'user' | 'external';
  referrer_user_id: string | null;
  referrer_external_id: string | null;
  commission_mode: 'percent' | 'fixed' | null;
  commission_value: string;
  commission_unit: 'hour' | 'day' | 'project' | null;
}

export function emptyWorkerForm(): WorkerFormValues {
  return {
    name: '', nickname: '', kind: 'general', trade: '',
    phones: '', email: '', company_name: '', tax_number: '', hq_address: '',
    bank_account: '', note: '', worker_type: 'individual', is_vat_payer: false, vat_rate: '27',
    default_pay_basis: null, hourly_rate: '', daily_rate: '', project_rate: '', callout_fee: '',
    referrer_kind: 'none', referrer_user_id: null, referrer_external_id: null,
    commission_mode: null, commission_value: '', commission_unit: null,
  };
}

export function workerToForm(w: Worker): WorkerFormValues {
  return {
    name: w.name, nickname: w.nickname ?? '', kind: w.trade ? 'specialist' : 'general', trade: w.trade ?? '',
    phones: w.phones.join(', '), email: w.email ?? '',
    company_name: w.company_name ?? '', tax_number: w.tax_number ?? '', hq_address: w.hq_address ?? '',
    bank_account: '', note: w.note ?? '', worker_type: w.worker_type,
    is_vat_payer: w.is_vat_payer, vat_rate: String(w.vat_rate),
    default_pay_basis: w.default_pay_basis,
    hourly_rate: w.hourly_rate != null ? String(w.hourly_rate) : '',
    daily_rate: w.daily_rate != null ? String(w.daily_rate) : '',
    project_rate: w.project_rate != null ? String(w.project_rate) : '',
    callout_fee: w.callout_fee != null ? String(w.callout_fee) : '',
    referrer_kind: w.referrer_user_id ? 'user' : w.referrer_external_id ? 'external' : 'none',
    referrer_user_id: w.referrer_user_id, referrer_external_id: w.referrer_external_id,
    commission_mode: w.commission_mode, commission_value: w.commission_value != null ? String(w.commission_value) : '',
    commission_unit: w.commission_unit,
  };
}

/** Mentés előtti ellenőrzés — hibaszöveg vagy null. A DB is kikényszeríti
 *  (check constraintek), de itt érthető üzenetet kap a felhasználó. */
export function validateWorkerForm(f: WorkerFormValues): string | null {
  if (!f.name.trim()) return 'A név megadása kötelező.';
  if (f.referrer_kind !== 'none' && f.commission_mode) {
    const v = f.commission_value ? parseAmount(f.commission_value) : null;
    if (v != null && v < 0) return 'A jutalék nem lehet negatív.';
    if (f.commission_mode === 'percent' && v != null && v > 100) return 'A százalékos jutalék legfeljebb 100% lehet.';
    if (f.commission_mode === 'fixed' && !f.commission_unit) return 'Fix összegű jutaléknál add meg az egységet (óra / nap / projekt).';
  }
  for (const [label, raw] of [['órabér', f.hourly_rate], ['napi díj', f.daily_rate], ['projektdíj', f.project_rate], ['kiszállási díj', f.callout_fee]] as const) {
    if (raw && parseAmount(raw) < 0) return `A(z) ${label} nem lehet negatív.`;
  }
  return null;
}

export function formToRow(f: WorkerFormValues): Partial<Worker> {
  return {
    name: f.name.trim(),
    nickname: f.nickname.trim() || null,
    trade: f.kind === 'specialist' ? (f.trade.trim() || null) : null,
    phones: f.phones.split(',').map((p) => p.trim()).filter(Boolean),
    email: f.email.trim() || null,
    company_name: f.company_name.trim() || null,
    tax_number: f.tax_number.trim() || null,
    hq_address: f.hq_address.trim() || null,
    note: f.note.trim() || null,
    worker_type: f.worker_type,
    is_vat_payer: f.worker_type === 'company' ? f.is_vat_payer : false,
    vat_rate: parseAmount(f.vat_rate) || 27,
    default_pay_basis: f.default_pay_basis,
    hourly_rate: f.hourly_rate ? parseAmount(f.hourly_rate) : null,
    daily_rate: f.daily_rate ? parseAmount(f.daily_rate) : null,
    project_rate: f.project_rate ? parseAmount(f.project_rate) : null,
    // üres = alapértelmezett; 0 = ennél a munkavállalónál nincs kiszállási díj
    callout_fee: f.callout_fee.trim() !== '' ? parseAmount(f.callout_fee) : null,
    referrer_user_id: f.referrer_kind === 'user' ? f.referrer_user_id : null,
    referrer_external_id: f.referrer_kind === 'external' ? f.referrer_external_id : null,
    commission_mode: f.referrer_kind === 'none' ? null : f.commission_mode,
    commission_value: f.referrer_kind !== 'none' && f.commission_value ? parseAmount(f.commission_value) : null,
    commission_unit: f.referrer_kind !== 'none' && f.commission_mode === 'fixed' ? f.commission_unit : null,
  };
}

/** Összecsukható űrlap-szakasz ikonnal és rövid összegzéssel. */
function FormSection({ icon, title, summary, open, onToggle, children }: {
  icon: string; title: string; summary?: string; open: boolean; onToggle: () => void; children: React.ReactNode;
}) {
  return (
    <Card style={{ paddingVertical: S.sm, gap: S.sm, borderColor: open ? C.primary : C.border }}>
      <Pressable onPress={onToggle} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: S.sm, minHeight: 36, opacity: pressed ? 0.7 : 1 })}>
        <Text style={{ fontSize: 20 }}>{icon}</Text>
        <Text style={{ fontWeight: '800', fontSize: 15, color: C.text }}>{title}</Text>
        <Text style={{ flex: 1, textAlign: 'right', color: C.sub, fontSize: 13 }} numberOfLines={1}>{open ? '' : (summary ?? '')}</Text>
        <Text style={{ color: C.sub, fontSize: 16 }}>{open ? '▾' : '▸'}</Text>
      </Pressable>
      {open ? children : null}
    </Card>
  );
}

export function WorkerForm({ value, onChange }: { value: WorkerFormValues; onChange: (v: WorkerFormValues) => void }) {
  // több szakma: vesszővel elválasztva tároljuk a `trade` mezőben
  const trades = value.trade.split(',').map((t) => t.trim()).filter(Boolean);
  const isCommon = (t: string) => COMMON_TRADES.some((c) => c.toLowerCase() === t.toLowerCase());
  const [otherText, setOtherText] = useState(trades.filter((t) => !isCommon(t)).join(', '));
  const setTrades = (list: string[]) => onChange({ ...value, trade: list.join(', ') });
  const toggleTrade = (t: string) => {
    const on = trades.some((x) => x.toLowerCase() === t.toLowerCase());
    setTrades(on ? trades.filter((x) => x.toLowerCase() !== t.toLowerCase()) : [...trades, t]);
  };
  const setOther = (text: string) => {
    setOtherText(text);
    const extra = text.split(',').map((t) => t.trim()).filter(Boolean);
    setTrades([...trades.filter(isCommon), ...extra]);
  };
  // közvetítő csak vezető lehet: admin és munkavállalói fiók nem
  const profiles = useTable<Profile>('profiles').filter((p) => !p.is_admin && !p.worker_id);
  const externals = useTable<ExternalPerson>('external_people');
  const settings = useTable<AppSettings>('app_settings')[0];
  // örökölt (globális) díj a munkavállaló típusa szerint — a mezőben alapból
  // ezt mutatjuk, üresen hagyva ezt fogja használni
  const inherited = (kind: 'hourly' | 'daily' | 'project'): string => {
    if (!settings) return 'öröklés';
    const key = `${value.worker_type}_${kind}_rate` as keyof AppSettings;
    const n = Number(settings[key]) || 0;
    return n ? `örökölt: ${ft(n)}` : 'öröklés (nincs beállítva)';
  };
  const [showNewExternal, setShowNewExternal] = useState(false);
  const [newExternalName, setNewExternalName] = useState('');
  const set = (patch: Partial<WorkerFormValues>) => onChange({ ...value, ...patch });

  // tömör nézet: összecsukható szakaszok rövid összegzéssel; az Alapadatok nyitva indul
  const [open, setOpen] = useState<string | null>('basic');
  const tog = (id: string) => setOpen((cur) => (cur === id ? null : id));
  const refName = value.referrer_kind === 'user' ? profiles.find((p) => p.id === value.referrer_user_id)?.display_name
    : value.referrer_kind === 'external' ? externals.find((e) => e.id === value.referrer_external_id)?.name : null;
  const rateSummary = [
    value.hourly_rate ? `óra ${ft(parseAmount(value.hourly_rate))}` : null,
    value.daily_rate ? `nap ${ft(parseAmount(value.daily_rate))}` : null,
    value.callout_fee.trim() !== '' ? `kiszállás ${ft(parseAmount(value.callout_fee))}` : null,
  ].filter(Boolean).join(' · ') || 'alapértelmezett díjak';

  return (
    <View style={{ gap: S.sm }}>
      <FormSection icon="👤" title="Alapadatok" summary={[value.name, value.phones].filter(Boolean).join(' · ')} open={open === 'basic'} onToggle={() => tog('basic')}>
        <Input label="Név *" value={value.name} onChangeText={(t) => set({ name: t })} autoCapitalize="words" />
        <Input label="Becenév" value={value.nickname} onChangeText={(t) => set({ nickname: t })} placeholder="pl. Marci — ezt mutatjuk a listákban" autoCapitalize="words" />
        <Input label="Telefonszám(ok, vesszővel)" value={value.phones} onChangeText={(t) => set({ phones: t })} keyboardType="phone-pad" placeholder="+36 30 123 4567" />
        <Input label="Email" value={value.email} onChangeText={(t) => set({ email: t })} keyboardType="email-address" autoCapitalize="none" />
      </FormSection>

      <FormSection icon="🛠️" title="Munkakör" summary={value.kind === 'specialist' ? (trades.join(', ') || 'Szakember') : 'Általános'} open={open === 'work'} onToggle={() => tog('work')}>
        <Segmented
          label="Munkakör"
          options={[
            { value: 'general', label: 'Általános' },
            { value: 'specialist', label: 'Szakember' },
          ]}
          value={value.kind}
          onChange={(v) => set({ kind: v })}
        />
        {value.kind === 'specialist' ? (
          <>
            <Sub>Szakipar — több is kijelölhető</Sub>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {COMMON_TRADES.map((t) => {
                const on = trades.some((x) => x.toLowerCase() === t.toLowerCase());
                return (
                  <Pressable key={t} onPress={() => toggleTrade(t)}
                    style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1,
                      borderColor: on ? C.primary : C.border, backgroundColor: on ? C.primary : C.card }}>
                    <Text style={{ color: on ? '#fff' : C.text, fontWeight: '600', fontSize: 13 }}>{on ? '✓ ' : ''}{t}</Text>
                  </Pressable>
                );
              })}
            </View>
            <Input
              label="Egyéb szakipar (ha nincs a listában; többet vesszővel)"
              value={otherText}
              onChangeText={setOther}
              placeholder="pl. Szigetelő, Lakatos"
              autoCapitalize="words"
            />
            {trades.length ? <Sub>Kijelölve: {trades.join(', ')}</Sub> : null}
          </>
        ) : null}
      </FormSection>

      <FormSection icon="🏢" title="Típus" summary={value.worker_type === 'company' ? `Céges${value.company_name ? ` · ${value.company_name}` : ''}` : 'Magánszemély'} open={open === 'type'} onToggle={() => tog('type')}>
        <Segmented
          label="Típus"
          options={[
            { value: 'individual', label: 'Magánszemély' },
            { value: 'company', label: 'Céges (számlaképes)' },
          ]}
          value={value.worker_type}
          onChange={(v) => set({ worker_type: v })}
        />
        {value.worker_type === 'company' ? (
          <>
            <Input label="Cégnév" value={value.company_name} onChangeText={(t) => set({ company_name: t })} />
            <Input label="Adószám" value={value.tax_number} onChangeText={(t) => set({ tax_number: t })} />
            <Input label="Székhely" value={value.hq_address} onChangeText={(t) => set({ hq_address: t })} />
            <Segmented
              label="ÁFA-s?"
              options={[{ value: 'yes', label: 'ÁFA-s' }, { value: 'no', label: 'Alanyi mentes' }]}
              value={value.is_vat_payer ? 'yes' : 'no'}
              onChange={(v) => set({ is_vat_payer: v === 'yes' })}
            />
            {value.is_vat_payer ? (
              <Input label="ÁFA-kulcs (%)" value={value.vat_rate} onChangeText={(t) => set({ vat_rate: t })} keyboardType="numeric" />
            ) : null}
          </>
        ) : null}
      </FormSection>

      <FormSection icon="💰" title="Díjazás" summary={rateSummary} open={open === 'pay'} onToggle={() => tog('pay')}>
        <Sub>Üresen hagyva a Beállítások típus szerinti alapdíját örökli.</Sub>
        <Segmented
          label="Jellemző elszámolás"
          options={[
            { value: 'hourly', label: 'Órabér' },
            { value: 'daily', label: 'Napi díj' },
            { value: 'project', label: 'Projektdíj' },
          ]}
          value={value.default_pay_basis}
          onChange={(v) => set({ default_pay_basis: v })}
        />
        <View style={{ flexDirection: 'row', gap: S.sm }}>
          <View style={{ flex: 1 }}><Input label="Órabér (Ft)" value={value.hourly_rate} onChangeText={(t) => set({ hourly_rate: t })} keyboardType="numeric" placeholder={inherited('hourly')} /></View>
          <View style={{ flex: 1 }}><Input label="Napi díj (Ft)" value={value.daily_rate} onChangeText={(t) => set({ daily_rate: t })} keyboardType="numeric" placeholder={inherited('daily')} /></View>
        </View>
        <View style={{ flexDirection: 'row', gap: S.sm }}>
          <View style={{ flex: 1 }}><Input label="Projektdíj (Ft)" value={value.project_rate} onChangeText={(t) => set({ project_rate: t })} keyboardType="numeric" placeholder={inherited('project')} /></View>
          <View style={{ flex: 1 }}><Input label="Kiszállás (Ft/helyszín/nap)" value={value.callout_fee} onChangeText={(t) => set({ callout_fee: t })} keyboardType="numeric" placeholder="üres = alap · 0 = nincs" /></View>
        </View>
      </FormSection>

      <FormSection icon="🤝" title="Közvetítő" summary={value.referrer_kind === 'none' ? 'Nincs' : (refName ?? 'nincs kiválasztva')} open={open === 'ref'} onToggle={() => tog('ref')}>
        <Sub>Ki hozta ezt az embert? A közvetítői díj a munkadíjból osztódik, nem plusz költség.</Sub>
        <Segmented
          options={[
            { value: 'none', label: 'Nincs' },
            { value: 'user', label: 'Felhasználó' },
            { value: 'external', label: 'Külsős' },
          ]}
          value={value.referrer_kind}
          onChange={(v) => set({ referrer_kind: v })}
        />
        {value.referrer_kind === 'user' ? (
          <Picker
            label="Melyik felhasználó?"
            items={profiles}
            selectedId={value.referrer_user_id}
            getId={(p) => p.id}
            getLabel={(p) => p.display_name}
            onSelect={(id) => set({ referrer_user_id: id })}
          />
        ) : null}
        {value.referrer_kind === 'external' ? (
          <>
            <Picker
              label="Külsős személy"
              items={externals}
              selectedId={value.referrer_external_id}
              getId={(e) => e.id}
              getLabel={(e) => e.name}
              onSelect={(id) => set({ referrer_external_id: id })}
            />
            {showNewExternal ? (
              <View style={{ flexDirection: 'row', gap: S.sm, alignItems: 'flex-end' }}>
                <View style={{ flex: 1 }}>
                  <Input label="Új külsős neve" value={newExternalName} onChangeText={setNewExternalName} autoCapitalize="words" />
                </View>
                <Btn title="Felvesz" small onPress={() => {
                  if (!newExternalName.trim()) return;
                  const id = insertRow('external_people', { name: newExternalName.trim() });
                  set({ referrer_external_id: id });
                  setNewExternalName('');
                  setShowNewExternal(false);
                }} />
              </View>
            ) : (
              <Btn title="+ Új külsős személy" kind="ghost" small onPress={() => setShowNewExternal(true)} />
            )}
          </>
        ) : null}
        {value.referrer_kind !== 'none' ? (
          <>
            <Segmented
              label="Közvetítői díj típusa"
              options={[
                { value: 'percent', label: '% a díjból' },
                { value: 'fixed', label: 'Fix Ft' },
              ]}
              value={value.commission_mode}
              onChange={(v) => set({ commission_mode: v })}
            />
            <Input
              label={value.commission_mode === 'percent' ? 'Százalék (%)' : 'Összeg (Ft)'}
              value={value.commission_value}
              onChangeText={(t) => set({ commission_value: t })}
              keyboardType="numeric"
            />
            {value.commission_mode === 'fixed' ? (
              <Segmented
                label="Egység"
                options={[
                  { value: 'hour', label: 'óránként' },
                  { value: 'day', label: 'naponta' },
                  { value: 'project', label: 'projektenként' },
                ]}
                value={value.commission_unit}
                onChange={(v) => set({ commission_unit: v })}
              />
            ) : null}
          </>
        ) : null}
      </FormSection>

      <FormSection icon="📝" title="Bankszámla és megjegyzés" summary={value.note ? value.note.slice(0, 30) : ''} open={open === 'other'} onToggle={() => tog('other')}>
        <Input label="Bankszámlaszám" value={value.bank_account} onChangeText={(t) => set({ bank_account: t })} placeholder="titkosítva tárolódik" />
        <Input label="Megjegyzés" value={value.note} onChangeText={(t) => set({ note: t })} multiline />
      </FormSection>
    </View>
  );
}
