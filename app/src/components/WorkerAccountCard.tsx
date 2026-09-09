// Munkavállalói fiók alapbeállításai: név, telefon, e-mail, jelszó, megjelenés.
// (A teljes Beállítások oldal a munkavállalónak nem érhető el.)

import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Card, H2, Sub, Input, Btn, Segmented } from '../ui/kit';
import { S, getThemeMode, setThemeMode, ThemeMode } from '../ui/theme';
import { useTable } from '../lib/hooks';
import { callRpc, getCurrentUserId } from '../lib/repo';
import { syncNow } from '../lib/sync';
import { supabase } from '../lib/supabase';
import { notify } from '../lib/dialogs';
import { EyeToggle } from './EyeToggle';
import { Profile, Worker } from '../lib/types';

export function WorkerAccountCard() {
  const me = getCurrentUserId();
  const profile = useTable<Profile>('profiles').find((p) => p.id === me);
  const worker = useTable<Worker>('workers').find((w) => w.id === profile?.worker_id);

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [theme, setThemeState] = useState<ThemeMode>(getThemeMode());

  useEffect(() => {
    if (worker) { setName(worker.name); setPhone(worker.phones?.[0] ?? ''); }
  }, [worker?.id]);
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? '')).catch(() => {});
  }, []);

  const saveBasics = async () => {
    setBusy(true);
    try {
      await callRpc('worker_update_self', { p_name: name, p_phone: phone });
      void syncNow();
      notify('Mentve ✅', 'Név és telefonszám frissítve.');
    } catch (e: any) {
      notify('Hiba', String(e?.message ?? e));
    } finally { setBusy(false); }
  };

  const saveEmail = async () => {
    const em = email.trim();
    if (!/^\S+@\S+\.\S+$/.test(em)) { notify('Hiba', 'Adj meg érvényes e-mail címet.'); return; }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ email: em });
    setBusy(false);
    if (error) notify('Hiba', error.message);
    else notify('Megerősítés kell 📧', `Levelet küldtünk ide: ${em}. A benne lévő linkre kattintva lép életbe az új cím.`);
  };

  const savePassword = async () => {
    if (pw.length < 6) { notify('Hiba', 'A jelszó legalább 6 karakter legyen.'); return; }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) notify('Hiba', error.message);
    else { setPw(''); notify('Mentve ✅', 'Az új jelszó él.'); }
  };

  return (
    <>
      <Card>
        <H2>👤 Saját adatok</H2>
        <Input label="Név" value={name} onChangeText={setName} autoCapitalize="words" />
        <Input label="Telefonszám" value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="+36 30 …" />
        <Btn title={busy ? '…' : 'Mentés'} onPress={() => void saveBasics()} disabled={busy || !name.trim()} />
      </Card>
      <Card>
        <H2>✉️ E-mail és jelszó</H2>
        <Input label="E-mail cím" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
        <Btn title="E-mail módosítása" kind="ghost" small onPress={() => void saveEmail()} disabled={busy} />
        <Input label="Új jelszó" value={pw} onChangeText={setPw} placeholder="legalább 6 karakter" secureTextEntry={!showPw} autoCapitalize="none"
          right={<EyeToggle shown={showPw} onToggle={() => setShowPw(!showPw)} />} />
        <Btn title="Jelszó módosítása" kind="ghost" small onPress={() => void savePassword()} disabled={busy || !pw} />
      </Card>
      <Card>
        <H2>🌗 Megjelenés</H2>
        <View style={{ gap: S.sm }}>
          <Segmented options={[{ value: 'light', label: '☀️ Világos' }, { value: 'dark', label: '🌙 Esti (sötét)' }]}
            value={theme} onChange={(v: ThemeMode) => { setThemeMode(v); setThemeState(v); }} />
          <Sub>Csak ezen az eszközön.</Sub>
        </View>
      </Card>
    </>
  );
}
