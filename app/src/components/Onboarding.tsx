// Bevezető: első belépéskor 3 lépés szerepenként; elvethető. Fiókonként tároljuk.

import React, { useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { Card, Sub, Btn } from '../ui/kit';
import { C, S } from '../ui/theme';
import { getCurrentUserId } from '../lib/repo';

const KEY = (uid: string) => `ktg:onboarded:${uid}`;
export const isOnboarded = (uid: string) => { try { return localStorage.getItem(KEY(uid)) === '1'; } catch { return true; } };
export const setOnboarded = (uid: string, v: boolean) => { try { if (v) localStorage.setItem(KEY(uid), '1'); else localStorage.removeItem(KEY(uid)); } catch { /* nincs tároló */ } };

const PARTNER = [
  { t: '1/3 · Építkezés és munkavállalók', b: 'Hozz létre egy építkezést (Építkezések), és vedd fel az embereket (Munkavállalók). Meghívó linkkel/QR-kóddal ők maguk is regisztrálhatnak — a jóváhagyás nálad marad.' },
  { t: '2/3 · Feladat és munkaidő', b: 'Adj ki feladatot (+ Új feladat): ajánlatot is kérhetsz. A munkavállaló az appban fogadja el és indítja a munkaidőt; a bér magától képződik (órabérnél megkezdett órák).' },
  { t: '3/3 · Óralap és kifizetés', b: 'Hét végén az Óralapok oldalon hagyod jóvá a heteket, a Függőben oldalon jelölöd kifizetettnek a bért. A Naptárban beosztást is adhatsz, a Statisztikában látod, mi mennyibe került.' },
];
const WORKER = [
  { t: '1/3 · Feladataid', b: 'A kezdőlapon látod a kiosztott feladatokat: fogadd el, vagy jelezd, ha nem vállalod. Ajánlatkérésnél add meg, mennyiért csinálod.' },
  { t: '2/3 · Munkaidő', b: '„▶ Kezdés” a feladaton vagy az építkezésen, „⏹ Befejezés” a nap végén. Ha elfelejted lezárni, este emlékeztetőt kapsz; a béred a rögzített idő alapján képződik.' },
  { t: '3/3 · Óralap és bér', b: 'Hét végén küldd be az óralapod a kezdőlapon; jóváhagyás után fizethető ki. A Napjaim résznél látod, mi lett kifizetve.' },
];

export function Onboarding({ worker }: { worker: boolean }) {
  const uid = getCurrentUserId();
  const [step, setStep] = useState(0);
  const [show, setShow] = useState(false);
  useEffect(() => { setShow(!!uid && !isOnboarded(uid)); }, [uid]);
  if (!show || !uid) return null;
  const steps = worker ? WORKER : PARTNER;
  const s = steps[step];
  const done = () => { setOnboarded(uid, true); setShow(false); };
  return (
    <Card style={{ borderColor: C.primary, gap: S.sm }}>
      <Text style={{ fontWeight: '800', fontSize: 15, color: C.text }}>👋 Üdv az appban — {s.t}</Text>
      <Sub>{s.b}</Sub>
      <View style={{ flexDirection: 'row', gap: S.sm }}>
        <View style={{ flex: 1 }}><Btn title="Ne mutasd többet" kind="ghost" small onPress={done} /></View>
        <View style={{ flex: 1 }}><Btn title={step < steps.length - 1 ? 'Tovább ›' : 'Kész ✓'} small onPress={() => step < steps.length - 1 ? setStep(step + 1) : done()} /></View>
      </View>
    </Card>
  );
}
