import React, { useEffect, useState } from 'react';
import { Platform, View, Text, Pressable, TextInput } from 'react-native';
import { Screen, Card, H2, Sub, Input, Btn, Divider, Body, Check, Segmented, Empty } from '../ui/kit';
import { S, C, getThemeMode, setThemeMode, ThemeMode } from '../ui/theme';
import { useTable, useOnlineView, useIsWorker } from '../lib/hooks';
import { updateRow, callRpc, getCurrentUserId, softDeleteRow, insertRow, fetchView } from '../lib/repo';
import { syncNow } from '../lib/sync';
import { supabase } from '../lib/supabase';
import { parseAmount, hd } from '../lib/format';
import { AppSettings, Profile, ExpenseCategory, ShareChangeRequest } from '../lib/types';
import { notify, confirmDialog } from '../lib/dialogs';
import { PercentSlider } from '../components/PercentSlider';
import { PartnerAccountCard } from '../components/PartnerAccountCard';
import { WebPushRow } from '../components/WebPushRow';

function RateInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return <Input label={label} value={value} onChangeText={onChange} keyboardType="numeric" placeholder="0" />;
}

/** Összecsukható szakasz: fejléc ikonnal, címmel és rövid összegzéssel; egyszerre egy van nyitva. */
function Section({ icon, title, summary, open, onToggle, children }: {
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

/** Kis, jobbra igazított szám-mező a díjtáblázat celláihoz. */
function Cell({ value, onChange, placeholder = '0' }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <TextInput value={value} onChangeText={onChange} keyboardType="numeric" placeholder={placeholder} placeholderTextColor={C.sub}
      style={{ flex: 1, minWidth: 0, borderWidth: 1, borderColor: C.border, borderRadius: 8, paddingVertical: 7, paddingHorizontal: 8,
        fontSize: 14, color: C.text, backgroundColor: C.bg, textAlign: 'right' }} />
  );
}

function SettingsInner() {
  const settings = useTable<AppSettings>('app_settings')[0];
  const profiles = useTable<Profile>('profiles');
  const categories = useTable<ExpenseCategory>('expense_categories');
  const me = getCurrentUserId();
  const myProfile = profiles.find((p) => p.id === me);
  // az admin nem üzleti partner: a részesedés-kártyán nem szerepel;
  // a hozzáférés-kezelés az adminé (amíg nincs admin: mindenkié)
  const partners = profiles.filter((p) => !p.is_admin && !p.worker_id);
  const canManageAccess = !!myProfile?.is_admin || !profiles.some((p) => p.is_admin);

  // részesedés-módosítási javaslatok (a másik fél beleegyezése kell)
  const shareRequests = useTable<ShareChangeRequest>('share_change_requests');
  const pendingReq = shareRequests.find((r) => r.status === 'pending');

  const [rates, setRates] = useState<Record<string, string>>({});
  const [shares, setShares] = useState<Record<string, number>>({});
  const [threshold, setThreshold] = useState('');
  const [newCat, setNewCat] = useState('');
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [theme, setThemeState] = useState<ThemeMode>(getThemeMode());
  // egyszerre egy szakasz van nyitva; ha az én jóváhagyásomra vár részesedés-javaslat, az nyílik ki
  const [open, setOpen] = useState<string | null>(() => (pendingReq && pendingReq.proposed_by !== me ? 'shares' : null));
  const tog = (id: string) => setOpen((cur) => (cur === id ? null : id));

  // zárt regisztráció: csak az itt engedélyezett e-mailek regisztrálhatnak
  const allowed = useOnlineView<{ email: string; is_admin?: boolean }[]>(
    'allowed-emails',
    () => fetchView('allowed_emails', (q) => q.order('email')),
    [],
  );
  const [newEmail, setNewEmail] = useState('');

  const addAllowed = async () => {
    const email = newEmail.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) { notify('Hiba', 'Adj meg érvényes e-mail címet.'); return; }
    const { error } = await supabase.from('allowed_emails').insert({ email });
    if (error && !error.message.includes('duplicate')) notify('Hiba', error.message);
    setNewEmail('');
    void allowed.refresh();
  };

  const removeAllowed = async (email: string) => {
    if (!await confirmDialog('Hozzáférés visszavonása', `${email}\n\nEzzel az e-mail címmel többé nem lehet regisztrálni. A már létező fiókot nem érinti.`, 'Visszavonás', true)) return;
    const { error } = await supabase.from('allowed_emails').delete().eq('email', email);
    if (error) notify('Hiba', error.message);
    void allowed.refresh();
  };

  useEffect(() => {
    if (settings && loadedFor !== 'rates') {
      setRates({
        company_hourly_rate: String(Number(settings.company_hourly_rate) || ''),
        company_daily_rate: String(Number(settings.company_daily_rate) || ''),
        company_project_rate: String(Number(settings.company_project_rate) || ''),
        individual_hourly_rate: String(Number(settings.individual_hourly_rate) || ''),
        individual_daily_rate: String(Number(settings.individual_daily_rate) || ''),
        individual_project_rate: String(Number(settings.individual_project_rate) || ''),
        company_callout_fee: settings.company_callout_fee != null ? String(Number(settings.company_callout_fee)) : '',
        individual_callout_fee: settings.individual_callout_fee != null ? String(Number(settings.individual_callout_fee)) : '',
        out_hourly_rate: String(Number(settings.out_hourly_rate) || ''),
        out_daily_rate: String(Number(settings.out_daily_rate) || ''),
        out_project_rate: String(Number(settings.out_project_rate) || ''),
        default_vat_rate: String(Number(settings.default_vat_rate)),
        default_payment_days: String(Number(settings.default_payment_days) || 8),
      });
      setLoadedFor('rates');
    }
  }, [settings, loadedFor]);

  // ha a szerveren változik a részesedés (pl. jóváhagyott javaslat),
  // a csúszkák álljanak át az új értékre
  const shareKey = partners.map((p) => `${p.id}:${Math.round(Number(p.profit_share_percent))}`).join(',');
  useEffect(() => {
    if (partners.length) {
      setShares(Object.fromEntries(partners.map((p) => [p.id, Math.round(Number(p.profit_share_percent))])));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shareKey]);

  useEffect(() => {
    if (myProfile && threshold === '') {
      setThreshold(String(Number(myProfile.big_expense_threshold)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profiles.length, myProfile?.id]);

  const saveRates = () => {
    if (!settings) return;
    updateRow('app_settings', '1' as any, Object.fromEntries(
      // kiszállási díj: üres = nincs megadva (1 óra bére), 0 = nincs díj
      Object.entries(rates).map(([k, v]) => [k, k.endsWith('_callout_fee') ? (String(v ?? '').trim() === '' ? null : parseAmount(v)) : parseAmount(v)]),
    ));
    notify('Mentve', 'Alapértelmezett díjak frissítve.');
  };

  /** Csúszka-állítás: a többi partner arányosan kapja a maradékot, így
   *  az összeg mindig pontosan 100. */
  const setShare = (id: string, val: number) => {
    const others = partners.filter((p) => p.id !== id);
    const rest = 100 - val;
    const prevSum = others.reduce((s, p) => s + (shares[p.id] ?? 0), 0);
    const next: Record<string, number> = { ...shares, [id]: val };
    let acc = 0;
    others.forEach((p, i) => {
      const w = prevSum > 0 ? (shares[p.id] ?? 0) / prevSum : 1 / others.length;
      const v = i === others.length - 1 ? rest - acc : Math.round(rest * w);
      next[p.id] = Math.max(0, v);
      acc += v;
    });
    setShares(next);
  };

  const sharesChanged = partners.some((p) => Math.round(Number(p.profit_share_percent)) !== (shares[p.id] ?? 0));

  const proposeShares = async () => {
    try {
      const status = await callRpc<string>('propose_profit_shares', {
        p_shares: partners.map((p) => ({ user_id: p.id, percent: shares[p.id] ?? 0 })),
      });
      void syncNow();
      if (status === 'approved') notify('Mentve ✅', 'A részesedés a mai naptól érvényes. A korábbi tételeket nem érinti.');
      else notify('Javaslat elküldve 🤝', 'A módosításhoz a másik fél beleegyezése kell — jóváhagyás után, annak napjától érvényes. A korábbi tételeket nem érinti.');
    } catch (e: any) {
      notify('Hiba', String(e?.message ?? e));
    }
  };

  const decideShares = async (id: string, approve: boolean) => {
    try {
      const status = await callRpc<string>('decide_share_change', { p_id: id, p_approve: approve });
      void syncNow();
      if (status === 'approved') notify('Jóváhagyva ✅', 'Az új részesedés a mai naptól érvényes. A korábbi tételeket nem érinti.');
      else if (status === 'rejected') notify('Elutasítva', 'A részesedések változatlanok maradtak.');
      else notify('Visszavonva', 'A javaslatot visszavontad.');
    } catch (e: any) {
      notify('Hiba', String(e?.message ?? e));
    }
  };

  const saveNotif = () => {
    if (!myProfile) return;
    updateRow('profiles', myProfile.id, { big_expense_threshold: parseAmount(threshold) });
    notify('Mentve', 'Értesítési beállítások frissítve.');
  };

  const toggleNotif = (field: keyof Profile) => {
    if (!myProfile) return;
    updateRow('profiles', myProfile.id, { [field]: !myProfile[field] });
  };

  if (!settings) return <Screen><Sub>Beállítások betöltése (első szinkron)…</Sub></Screen>;

  const RATE_ROWS: { label: string; ind: string; comp: string; out?: string; ph?: string }[] = [
    { label: 'Órabér', ind: 'individual_hourly_rate', comp: 'company_hourly_rate', out: 'out_hourly_rate' },
    { label: 'Napi díj', ind: 'individual_daily_rate', comp: 'company_daily_rate', out: 'out_daily_rate' },
    { label: 'Projektdíj', ind: 'individual_project_rate', comp: 'company_project_rate', out: 'out_project_rate' },
    { label: 'Kiszállás', ind: 'individual_callout_fee', comp: 'company_callout_fee', ph: '1 óra' },
  ];
  const setRate = (k: string, v: string) => setRates({ ...rates, [k]: v });
  const notifOn = myProfile ? [myProfile.notify_comments, myProfile.notify_big_expense, myProfile.notify_weekly, myProfile.notify_overdue].filter(Boolean).length : 0;
  const allowedList = (allowed.data ?? []).filter((x) => !x.is_admin);

  return (
    <Screen>
      <Section icon="👤" title="Fiókom" summary={myProfile?.display_name ?? ''} open={open === 'account'} onToggle={() => tog('account')}>
        <PartnerAccountCard bare />
      </Section>

      <Section icon="🌗" title="Megjelenés" summary={theme === 'dark' ? 'Esti (sötét)' : 'Világos'} open={open === 'theme'} onToggle={() => tog('theme')}>
        <Segmented
          options={[
            { value: 'light', label: '☀️ Világos' },
            { value: 'dark', label: '🌙 Esti (sötét)' },
          ]}
          value={theme}
          onChange={(v: ThemeMode) => { setThemeMode(v); setThemeState(v); }}
        />
      </Section>

      <Section icon="💰" title="Díjak" open={open === 'rates'} onToggle={() => tog('rates')}
        summary={`órabér ${rates.individual_hourly_rate || '—'} / ${rates.company_hourly_rate || '—'} Ft`}>
        <Sub>Alapértelmezett díjak (Ft). A munkavállalónál megadott egyedi díj ezeket felülírja.</Sub>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={{ width: 78 }} />
          {['Magánsz.', 'Céges', 'Kimenő'].map((h) => (
            <Text key={h} style={{ flex: 1, textAlign: 'center', fontSize: 12, fontWeight: '700', color: C.sub }}>{h}</Text>
          ))}
        </View>
        {RATE_ROWS.map((r) => (
          <View key={r.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={{ width: 78, fontSize: 13, fontWeight: '600', color: C.text }}>{r.label}</Text>
            <Cell value={rates[r.ind] ?? ''} onChange={(v) => setRate(r.ind, v)} placeholder={r.ph} />
            <Cell value={rates[r.comp] ?? ''} onChange={(v) => setRate(r.comp, v)} placeholder={r.ph} />
            {r.out ? <Cell value={rates[r.out] ?? ''} onChange={(v) => setRate(r.out!, v)} /> : <View style={{ flex: 1 }} />}
          </View>
        ))}
        <Sub style={{ fontSize: 11 }}>Kiszállás: helyszínenként és naponként egyszer. Üres = 1 óra bére, 0 = nincs díj. „Kimenő” = amit a megrendelőnek számlázol.</Sub>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={{ flex: 2, fontSize: 13, fontWeight: '600', color: C.text }}>Alapértelmezett ÁFA (%)</Text>
          <Cell value={rates.default_vat_rate ?? '27'} onChange={(v) => setRate('default_vat_rate', v)} />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={{ flex: 2, fontSize: 13, fontWeight: '600', color: C.text }}>Fizetési határidő (nap)</Text>
          <Cell value={rates.default_payment_days ?? '8'} onChange={(v) => setRate('default_payment_days', v)} />
        </View>
        <Btn title="Díjak mentése" onPress={saveRates} />
      </Section>

      <Section icon="🤝" title="Profitrészesedés" open={open === 'shares'} onToggle={() => tog('shares')}
        summary={pendingReq ? '⏳ függő javaslat' : partners.map((p) => `${p.display_name} ${Math.round(Number(p.profit_share_percent ?? 0))}%`).join(' · ')}>
        {pendingReq ? (
          <>
            <Sub>🤝 Függőben lévő módosítási javaslat ({hd(pendingReq.created_at.slice(0, 10))}, javasolta: {profiles.find((p) => p.id === pendingReq.proposed_by)?.display_name ?? '?'}):</Sub>
            {pendingReq.shares.map((s) => (
              <Body key={s.user_id} style={{ fontWeight: '700' }}>
                {profiles.find((p) => p.id === s.user_id)?.display_name ?? '?'}: {Number(s.percent)}%
                <Body style={{ fontWeight: '400', color: C.sub }}>
                  {'  '}(most: {Math.round(Number(profiles.find((p) => p.id === s.user_id)?.profit_share_percent ?? 0))}%)
                </Body>
              </Body>
            ))}
            <Sub>Jóváhagyás után az új arány annak napjától érvényes — a korábbi tételek a régi arányban maradnak.</Sub>
            {pendingReq.proposed_by === me ? (
              <Btn title="Javaslat visszavonása" kind="ghost" onPress={() => void decideShares(pendingReq.id, false)} />
            ) : myProfile && !myProfile.is_admin && !myProfile.worker_id ? (
              <View style={{ flexDirection: 'row', gap: S.md }}>
                <View style={{ flex: 1 }}><Btn title="Elutasítom" kind="ghost" onPress={() => void decideShares(pendingReq.id, false)} /></View>
                <View style={{ flex: 1 }}><Btn title="Jóváhagyom ✓" onPress={() => void decideShares(pendingReq.id, true)} /></View>
              </View>
            ) : (
              <Sub>A másik fél döntésére vár.</Sub>
            )}
          </>
        ) : (
          <>
            <Sub>A módosításhoz a másik fél beleegyezése kell, és csak a jóváhagyás napjától érvényes.</Sub>
            {partners.map((p) => (
              <View key={p.id} style={{ gap: 2 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Body style={{ fontWeight: '600' }}>{p.display_name}</Body>
                  <Body style={{ fontWeight: '800', color: C.primary }}>{shares[p.id] ?? 0}%</Body>
                </View>
                <PercentSlider value={shares[p.id] ?? 0} onChange={(v) => setShare(p.id, v)} />
              </View>
            ))}
            <Btn
              title={partners.length > 1 ? 'Módosítás javaslása 🤝' : 'Részesedés mentése'}
              onPress={() => void proposeShares()}
              disabled={!sharesChanged}
            />
          </>
        )}
      </Section>

      <Section icon="🔔" title="Értesítések" summary={`${notifOn} bekapcsolva`} open={open === 'notif'} onToggle={() => tog('notif')}>
        {myProfile ? (
          <>
            {Platform.OS === 'web' ? <><WebPushRow /><Divider /></> : null}
            <Check checked={myProfile.notify_comments} onToggle={() => toggleNotif('notify_comments')} label="Komment az általam rögzített tételhez" />
            <Check checked={myProfile.notify_big_expense} onToggle={() => toggleNotif('notify_big_expense')} label="Nagy költés riasztás" />
            {myProfile.notify_big_expense ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={{ flex: 2, fontSize: 13, fontWeight: '600', color: C.text }}>Riasztási küszöb (Ft)</Text>
                <Cell value={threshold} onChange={setThreshold} />
                <Btn title="Mentés" kind="ghost" small onPress={saveNotif} />
              </View>
            ) : null}
            <Check checked={myProfile.notify_weekly} onToggle={() => toggleNotif('notify_weekly')} label="Heti összefoglaló (péntek délután)" />
            <Check checked={myProfile.notify_overdue} onToggle={() => toggleNotif('notify_overdue')} label="Régi kifizetetlen bér / be nem folyt számla" />
          </>
        ) : null}
      </Section>

      {canManageAccess ? (
        <Section icon="🔐" title="Hozzáférés" summary={`${allowedList.length} e-mail`} open={open === 'access'} onToggle={() => tog('access')}>
          <Sub>Csak az itt engedélyezett e-mail címekkel lehet vezetőként regisztrálni. A meglévő fiókokat nem érinti.</Sub>
          {allowedList.map((a) => (
            <View key={a.email} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Body style={{ flex: 1 }}>{a.email}</Body>
              <Btn title="Visszavon" kind="ghost" small onPress={() => void removeAllowed(a.email)} />
            </View>
          ))}
          {allowed.fromCache ? <Sub style={{ color: C.warning }}>⚠️ Offline — a lista kezeléséhez internet kell.</Sub> : null}
          <View style={{ flexDirection: 'row', gap: S.sm, alignItems: 'flex-end' }}>
            <View style={{ flex: 1 }}>
              <Input value={newEmail} onChangeText={setNewEmail}
                placeholder="új e-mail, pl. tars@pelda.hu" keyboardType="email-address" autoCapitalize="none" />
            </View>
            <Btn title="Engedélyez" small onPress={() => void addAllowed()} />
          </View>
        </Section>
      ) : null}

      <Section icon="🏷️" title="Költség-kategóriák" summary={`${categories.length} db`} open={open === 'cats'} onToggle={() => tog('cats')}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {categories.map((c) => (
            <Pressable key={c.id} onPress={() => {
              void confirmDialog(
                'Kategória törlése',
                `${c.name}\n\nA korábbi költségeken megmarad, csak új költséghez nem lesz választható.`,
                'Törlés', true,
              ).then((ok) => { if (ok) softDeleteRow('expense_categories', c.id); });
            }} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.chipBg, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12, opacity: pressed ? 0.7 : 1 })}>
              <Text style={{ color: C.text, fontSize: 13, fontWeight: '600' }}>{c.name}</Text>
              <Text style={{ color: C.sub, fontSize: 13 }}>✕</Text>
            </Pressable>
          ))}
        </View>
        <View style={{ flexDirection: 'row', gap: S.sm, alignItems: 'flex-end' }}>
          <View style={{ flex: 1 }}>
            <Input value={newCat} onChangeText={setNewCat} placeholder="új kategória, pl. Bérleti díj" />
          </View>
          <Btn title="Felvesz" small onPress={() => {
            if (!newCat.trim()) return;
            insertRow('expense_categories', { name: newCat.trim(), is_builtin: false });
            setNewCat('');
          }} />
        </View>
      </Section>
    </Screen>
  );
}

/** Vezetői oldal: munkavállalói fiók nem nyithatja meg (a hookok
 *  sorrendje miatt külön burkolóban, nem a komponensen belüli korai visszatéréssel). */
export default function Settings() {
  if (useIsWorker()) return <Screen><Empty text="Nincs jogosultságod ehhez az oldalhoz." /></Screen>;
  return <SettingsInner />;
}
