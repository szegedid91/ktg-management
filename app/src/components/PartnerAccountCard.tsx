// Vezető profilja: név, e-mail, jelszó módosítása.

import { View } from 'react-native';
import { S } from '../ui/theme';
import React, { useEffect, useState } from 'react';
import { Card, H2, Sub, Input, Btn } from '../ui/kit';
import { useTable } from '../lib/hooks';
import { getCurrentUserId, updateRow } from '../lib/repo';
import { supabase } from '../lib/supabase';
import { notify } from '../lib/dialogs';
import { EyeToggle } from './EyeToggle';
import { Profile } from '../lib/types';

export function PartnerAccountCard({ bare = false }: { bare?: boolean } = {}) {
  const me = getCurrentUserId();
  const profile = useTable<Profile>('profiles').find((p) => p.id === me);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (profile) setName(profile.display_name); }, [profile?.id]);
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? '')).catch(() => {});
  }, []);

  const saveName = () => {
    if (!profile || !name.trim()) return;
    updateRow('profiles', profile.id, { display_name: name.trim() });
    notify('Mentve ✅', 'A neved frissítve — a partnered és a munkavállalók ezt látják.');
  };

  const saveEmail = async () => {
    const em = email.trim();
    if (!/^\S+@\S+\.\S+$/.test(em)) { notify('Hiba', 'Adj meg érvényes e-mail címet.'); return; }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ email: em });
    setBusy(false);
    if (error) notify('Hiba', error.message);
    else notify('Megerősítés kell 📧', `Levelet küldtünk ide: ${em}. A benne lévő linkre kattintva lép életbe az új cím — addig a régivel lépsz be.`);
  };

  const savePassword = async () => {
    if (pw.length < 6) { notify('Hiba', 'A jelszó legalább 6 karakter legyen.'); return; }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) notify('Hiba', error.message);
    else { setPw(''); notify('Mentve ✅', 'Az új jelszó él. Ha gyors belépésként mentetted, ott is frissítsd.'); }
  };

  const content = (
    <>
      <Input label="Név" value={name} onChangeText={setName} autoCapitalize="words" />
      <Btn title="Név mentése" kind="ghost" small onPress={saveName} disabled={!name.trim() || name.trim() === profile?.display_name} />
      <Input label="E-mail cím" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
      <Btn title="E-mail módosítása" kind="ghost" small onPress={() => void saveEmail()} disabled={busy} />
      <Input label="Új jelszó" value={pw} onChangeText={setPw} placeholder="legalább 6 karakter" secureTextEntry={!showPw} autoCapitalize="none"
        right={<EyeToggle shown={showPw} onToggle={() => setShowPw(!showPw)} />} />
      <Btn title="Jelszó módosítása" kind="ghost" small onPress={() => void savePassword()} disabled={busy || !pw} />
      <Sub>Az e-mail csere megerősítő levéllel lép életbe; a régi és az új címre is érkezhet üzenet.</Sub>
    </>
  );
  // bare: keret és cím nélkül (a Beállítások összecsukható szakaszában)
  if (bare) return <View style={{ gap: S.sm }}>{content}</View>;
  return (
    <Card>
      <H2>👤 Profilom</H2>
      {content}
    </Card>
  );
}
