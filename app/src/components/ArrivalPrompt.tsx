// „Megérkeztél — bejelentkezel?” kártya a munkavállalói kezdőlapon.
// Az app megnyitásakor, előtérbe kerülésekor és nyitott app mellett 3
// percenként megnézi a telefon helyzetét; ha egy beállított munkaterület
// sugarán belül van és nincs futó munkaideje, felajánlja a bejelentkezést.
// (Bezárt app mellett a webes app nem kap helyadatot — lásd lib/geo.ts.)

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, View, Text } from 'react-native';
import { Card, Sub, Btn } from '../ui/kit';
import { C, S } from '../ui/theme';
import { Site } from '../lib/types';
import { distanceM, geoPermission, getPosition, GeoPermission } from '../lib/geo';
import { getCurrentUserId } from '../lib/repo';
import { todayISO } from '../lib/format';

const CHECK_EVERY_MS = 3 * 60_000;
const ASK_SNOOZE_MS = 7 * 864e5;

const ls = {
  get(k: string) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* privát mód */ } },
};

export function ArrivalPrompt({ sites, openSiteIds, onCheckIn, onSwitch }: {
  sites: Site[];
  /** azok a területek, ahol épp fut munkaidő (saját / emberek) — üres, ha senki sincs bejelentkezve */
  openSiteIds: string[];
  onCheckIn: (siteId: string) => void;
  /** másik területre érkezett, miközben máshol fut a munkaideje: ott lezár, itt indít */
  onSwitch: (siteId: string) => void;
}) {
  const uid = getCurrentUserId() ?? 'anon';
  const geoSites = sites.filter((s) => s.lat != null && s.lng != null);
  const [perm, setPerm] = useState<GeoPermission | null>(null);
  const [here, setHere] = useState<{ site: Site; dist: number } | null>(null);
  const [askHidden, setAskHidden] = useState(false);
  const busy = useRef(false);
  const sitesRef = useRef(geoSites);
  sitesRef.current = geoSites;

  const check = useCallback(async () => {
    if (busy.current || sitesRef.current.length === 0) return;
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    busy.current = true;
    try {
      const pos = await getPosition();
      setPerm(await geoPermission());
      if (!pos) { setHere(null); return; }
      // a GPS pontatlanságát (legfeljebb 100 m-ig) ráhagyjuk a sugárra
      const slack = Math.min(pos.accuracy || 0, 100);
      const hits = sitesRef.current
        .map((s) => ({ site: s, dist: distanceM(pos.lat, pos.lng, s.lat as number, s.lng as number) }))
        .filter((h) => h.dist <= (h.site.geofence_radius_m ?? 150) + slack)
        .sort((a, b) => a.dist - b.dist);
      setHere(hits[0] ?? null);
    } finally { busy.current = false; }
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'web' || geoSites.length === 0) return;
    let alive = true;
    void geoPermission().then((p) => { if (!alive) return; setPerm(p); if (p === 'granted') void check(); });
    const onVis = () => { if (document.visibilityState === 'visible') void geoPermission().then((p) => { if (p === 'granted') void check(); }); };
    document.addEventListener('visibilitychange', onVis);
    const timer = setInterval(() => { void geoPermission().then((p) => { if (p === 'granted') void check(); }); }, CHECK_EVERY_MS);
    return () => { alive = false; document.removeEventListener('visibilitychange', onVis); clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geoSites.length, check]);

  if (Platform.OS !== 'web' || geoSites.length === 0 || perm === null) return null;

  // 1) még nincs engedély: egy koppintásos bekapcsolás (7 napig elhalasztható)
  if (perm === 'prompt') {
    const snoozed = Number(ls.get(`ktg:geoask:${uid}`) ?? 0);
    if (askHidden || (snoozed && Date.now() - snoozed < ASK_SNOOZE_MS)) return null;
    return (
      <Card style={{ borderColor: C.primary, gap: S.sm }}>
        <Text style={{ fontWeight: '800', fontSize: 16, color: C.text }}>📍 Szóljunk, ha megérkeztél?</Text>
        <Sub>Ha engedélyezed a helymeghatározást, az app jelzi, amikor egy munkaterületen vagy, és egy koppintással bejelentkezhetsz. A helyzetedet nem tároljuk és nem küldjük el sehova.</Sub>
        <Btn title="📍 Engedélyezem" onPress={() => void check()} />
        <View style={{ alignItems: 'center' }}><Btn title="Most nem" kind="ghost" small onPress={() => { ls.set(`ktg:geoask:${uid}`, String(Date.now())); setAskHidden(true); }} /></View>
      </Card>
    );
  }

  // 2) a területen van: ha itt már fut a munkaideje, nincs teendő; ha máshol
  //    fut (egy nap több helyszín), átjelentkezést ajánlunk; ha sehol, bejelentkezést
  if (perm !== 'granted' || !here) return null;
  if (openSiteIds.includes(here.site.id)) return null;
  const dismissKey = `ktg:arrival:${uid}:${here.site.id}:${todayISO()}`;
  if (ls.get(dismissKey)) return null;
  if (openSiteIds.length > 0) {
    const from = sites.filter((x) => openSiteIds.includes(x.id)).map((x) => x.name).join(', ') || 'másik terület';
    return (
      <Card style={{ borderColor: C.warning, borderWidth: 2, gap: S.sm }}>
        <Text style={{ fontWeight: '800', fontSize: 17, color: C.text }}>📍 Megérkeztél: {here.site.name}</Text>
        <Sub>A munkaidőd most itt fut: {from}. Átjelentkezel ide? Ott lezárjuk, itt elindítjuk.</Sub>
        <Btn title={`🔁 Átjelentkezés ide: ${here.site.name}`} onPress={() => { onSwitch(here.site.id); setHere(null); }} />
        <View style={{ alignItems: 'center' }}><Btn title="Most nem" kind="ghost" small onPress={() => { ls.set(dismissKey, '1'); setHere(null); }} /></View>
      </Card>
    );
  }
  return (
    <Card style={{ borderColor: C.success, borderWidth: 2, gap: S.sm }}>
      <Text style={{ fontWeight: '800', fontSize: 17, color: C.text }}>📍 Megérkeztél: {here.site.name}</Text>
      <Sub>Úgy látjuk, a munkaterületen vagy. Bejelentkezel most?</Sub>
      <Btn title="✅ Bejelentkezés" onPress={() => { onCheckIn(here.site.id); setHere(null); }} />
      <View style={{ alignItems: 'center' }}><Btn title="Most nem" kind="ghost" small onPress={() => { ls.set(dismissKey, '1'); setHere(null); }} /></View>
    </Card>
  );
}
