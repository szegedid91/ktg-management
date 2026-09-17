// Súgó: szerep szerinti rövid útmutató; a bevezető újra megnyitható.

import React from 'react';
import { Text } from 'react-native';
import { router } from 'expo-router';
import { Screen, Card, H2, Sub, Btn } from '../ui/kit';
import { C } from '../ui/theme';
import { useIsWorker } from '../lib/hooks';
import { getCurrentUserId } from '../lib/repo';
import { setOnboarded } from '../components/Onboarding';

const PARTNER: { t: string; items: string[] }[] = [
  { t: '🏗️ Építkezések', items: ['Új építkezés a kezdőlapról vagy az Építkezések oldalon; lezárás a lezáró listával.', 'A helyszín címéhez 🧭 útvonal gomb nyílik a térkép-appban.'] },
  { t: '👷 Munkavállalók', items: ['Felvétel kézzel, vagy meghívó link / QR — a regisztrációt te hagyod jóvá (díjazás ellenőrzéssel).', 'Vállalkozó: saját embereket hozhat; a bérük hozzá kerül, emberenként részletezve.', 'Több szakma, becenév (csak neked látszik), telefonszám másolás/hívás.'] },
  { t: '🛠️ Feladatok', items: ['Új feladat: helyszín, kinek (több is), SOS, határidő, ajánlatkérés, sablon.', 'Kiosztás később is módosítható; kiosztás nélkül is menthető (Kiosztatlan).', 'Hasonló korábbi feladatok költsége a cím beírásakor megjelenik.', 'Megjegyzések: csak neked, vagy a munkavállalónak is (megerősítéssel).', 'Utólagos rögzítés: ki, mikor dolgozott; anyagköltség; készre állítás.'] },
  { t: '⏱ Bér és óralap', items: ['Órabérnél minden megkezdett óra teljes óra; napi díjnál egy nap = egy díj.', 'Az Óralapok oldalon hagyod jóvá a heteket; utána a Függőben oldalon fizeted ki.', 'A munkavállaló menetét lezárhatod vagy javíthatod (⏱ Munkaidő).'] },
  { t: '📆 Naptár és emlékeztetők', items: ['Beosztás: a Naptárban napra és építkezésre osztod be az embereket; ütközést jelez.', 'Automatikus: 24 órája el nem fogadott feladat, este nyitva maradt munkaidő, vasárnap be nem küldött óralap.'] },
  { t: '📊 Pénzügy', items: ['Költségek fotóval és AI-felismeréssel, kimenő számlák, elszámolás a partnerek közt, pénzforgalmi előrejelzés, export könyvelőnek.'] },
];
const WORKER: { t: string; items: string[] }[] = [
  { t: '🛠️ Feladatok', items: ['Elfogadás vagy „Nem vállalom”; ajánlatkérésnél add meg az összeget.', 'A feladaton látod, ki dolgozik még rajta; megjegyzést írhatsz nekik és a fő felhasználóknak.', '🧭 gomb: útvonal az építkezéshez.'] },
  { t: '⏱ Munkaidő', items: ['„▶ Kezdés” feladaton vagy építkezésen, „⏹ Befejezés” a nap végén.', 'Ha nyitva marad, este emlékeztetőt kapsz; javítást a fő felhasználótól kérhetsz.', 'Órabérnél minden megkezdett óra teljes óra.'] },
  { t: '🗓️ Óralap és bér', items: ['Hét végén küldd be az óralapod a kezdőlapon; jóváhagyás után fizethető ki.', 'Napjaim: mi lett kifizetve, mi függ.'] },
  { t: '📆 Beosztás', items: ['A kezdőlapon látod, hová vagy beosztva a következő napokra.'] },
  { t: '👥 Vállalkozóknak', items: ['Embereidet az „Embereim” kártyán veszed fel vagy hívod meg; közösen jelentkeztek be; az óralapot értük is te küldöd.'] },
];

export default function Help() {
  const worker = useIsWorker();
  const uid = getCurrentUserId();
  return (
    <Screen>
      <Sub>Rövid útmutató {worker ? 'munkavállalóknak' : 'fő felhasználóknak'}. Kérdés esetén a fő felhasználók segítenek.</Sub>
      {(worker ? WORKER : PARTNER).map((sec) => (
        <Card key={sec.t}>
          <H2>{sec.t}</H2>
          {sec.items.map((it, i) => <Text key={i} style={{ color: C.text, fontSize: 14, lineHeight: 20 }}>• {it}</Text>)}
        </Card>
      ))}
      <Btn title="Bevezető újra megnyitása" kind="secondary" onPress={() => { if (uid) setOnboarded(uid, false); router.replace('/'); }} />
    </Screen>
  );
}
