// Munkavállalói regisztráció meghívó-linkkel / QR-kóddal (?token=…)

import React, { useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Screen, Card, Title, Sub, Input, Btn, Body , Check } from '../ui/kit';
import { C, S } from '../ui/theme';
import { useAuth } from '../lib/auth';
import { callRpc } from '../lib/repo';
import { EyeToggle } from '../components/EyeToggle';

export default function Invite() {
  const { token, c } = useLocalSearchParams<{ token?: string; c?: string }>();
  const viaContractor = c === '1';
  // személyre szóló meghívó: a partner által felvitt adatok előtöltve, csak jelszó kell
  const [kind, setKind] = useState<'loading' | 'personal' | 'generic' | 'contractor' | 'invalid'>('loading');
  const { session, signUp, signOut } = useAuth();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [trade, setTrade] = useState('');
  const [contractor, setContractor] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) { setKind('invalid'); return; }
    let alive = true;
    callRpc<{ kind: string; name?: string; email?: string; phone?: string; trade?: string }>('invite_info', { p_token: token })
      .then((info) => {
        if (!alive) return;
        if (info?.kind === 'personal') {
          setName((v) => v || info.name || '');
          setEmail((v) => v || info.email || '');
          setPhone((v) => v || info.phone || '');
          setTrade((v) => v || info.trade || '');
        }
        setKind((info?.kind as any) ?? 'generic');
      })
      .catch(() => { if (alive) setKind('generic'); }); // offline / régi szerver: sima űrlap
    return () => { alive = false; };
  }, [token]);
  const personal = kind === 'personal';

  const submit = async () => {
    if (!token) return;
    setBusy(true);
    setError(null);
    const err = await signUp(email.trim(), password, name.trim(), token,
      { phone: phone.trim(), trade: trade.trim(), is_contractor: !viaContractor && contractor });
    setBusy(false);
    if (err) { setError(err); return; }
    setDone(true);
  };

  return (
    <Screen>
      <View style={{ paddingTop: 40, gap: S.lg }}>
        <View style={{ alignItems: 'center', gap: 4 }}>
          <Text style={{ fontSize: 40 }}>👷</Text>
          <Title>Munkavállalói regisztráció</Title>
          <Sub>Építkezés Költségkövető</Sub>
        </View>

        {!token || kind === 'invalid' ? (
          <Card>
            <Body>{!token ? 'Ez a link nem tartalmaz meghívót.' : 'Ez a meghívó érvénytelen, lejárt vagy már felhasználták.'} Kérj új meghívó linket vagy QR-kódot a vezetőktől.</Body>
          </Card>
        ) : kind === 'loading' ? (
          <Card><Sub>Meghívó ellenőrzése…</Sub></Card>
        ) : session && !done ? (
          <Card>
            <Body>Már be vagy jelentkezve ({session.user.email}).</Body>
            <Sub>Ha a meghívóval új fiókot szeretnél, előbb jelentkezz ki.</Sub>
            <Btn title="Tovább az appba" onPress={() => router.replace('/')} />
            <Btn title="Kijelentkezés" kind="ghost" onPress={() => void signOut()} />
          </Card>
        ) : done ? (
          <Card>
            <Body style={{ fontWeight: '700' }}>✅ A fiókod létrejött.</Body>
            {session ? (
              <Btn title="Belépés az appba" onPress={() => router.replace('/')} />
            ) : (
              <>
                <Sub>Küldtünk egy megerősítő e-mailt a(z) {email.trim()} címre — kattints a benne lévő linkre, utána be tudsz lépni.</Sub>
                <Btn title="Belépés" kind="ghost" onPress={() => router.replace('/login')} />
              </>
            )}
          </Card>
        ) : (
          <Card>
            <Sub>{personal
              ? 'A vezetők már felvették az adataidat — nézd át, javítsd, ha kell, és adj meg egy jelszót. A fiókod a meglévő profilodhoz kapcsolódik, a korábbi napjaidat is látod majd.'
              : viaContractor
              ? 'Egy vállalkozó meghívott a csapatába. Add meg az adataid — a profilod az ő embereként jön létre, a béred hozzá kerül (emberenként részletezve), és rögtön be tudsz lépni.'
              : 'A vezetők meghívtak az appba. Add meg az adataid — ezekből jön létre a munkavállalói profilod.'}</Sub>
            <Input label="Teljes név *" value={name} onChangeText={setName} placeholder="pl. Kovács Márton" autoCapitalize="words" />
            <Input label="Telefonszám" value={phone} onChangeText={setPhone} placeholder="+36 30 …" keyboardType="phone-pad" />
            <Input label="Szakma" value={trade} onChangeText={setTrade} placeholder="pl. burkoló, villanyszerelő (ha van)" />
            {!viaContractor && !personal ? <Check checked={contractor} onToggle={() => setContractor(!contractor)} label="Vállalkozóként regisztrálok — saját embereket hozok"
              sub="Az embereidet te veszed fel és jelentkezteted be; a bérük hozzád kerül, emberenként részletezve." /> : null}
            <Input label="E-mail" value={email} onChangeText={setEmail} placeholder="pl. en@pelda.hu" keyboardType="email-address" autoCapitalize="none" />
            <Input label="Jelszó" value={password} onChangeText={setPassword} placeholder="legalább 6 karakter" secureTextEntry={!showPw} autoCapitalize="none" autoComplete="new-password"
              right={<EyeToggle shown={showPw} onToggle={() => setShowPw(!showPw)} />} />
            {error ? <Text style={{ color: C.danger, fontSize: 13 }}>{error}</Text> : null}
            <Btn title={busy ? '…' : 'Regisztráció'} onPress={() => void submit()} disabled={busy || !email || !name.trim() || password.length < 6} />
          </Card>
        )}
      </View>
    </Screen>
  );
}
