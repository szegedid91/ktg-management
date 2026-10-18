// Helyzetjelentés futó munkaidő alatt (2026-10-18): amíg a munkavállalónak fut a munkaideje ÉS az app nyitva
// van, 2 percenként elküldjük a helyzetét a szervernek (report_position), ami kiszámolja, a munkaterületen
// van-e. Ha a sugáron kívül van, a kezdőlapon azonnal felajánljuk a munkaidő lezárását; a szerver 3 perc
// után értesítést is küld neki és a vezetőknek.
//
// Korlát: a webes (főképernyőre tett) app a háttérben / bezárva NEM kap helyadatot — lásd lib/geo.ts. A
// háttérbeli figyelés a natív app geofence-e (lib/geofence.native.ts). Munkaidőn kívül nem mérünk semmit.

import { useEffect, useRef, useState } from 'react';
import { distanceM, geoPermission, getPosition } from './geo';
import { queueRpc } from './repo';
import type { Site, WorkSession } from './types';

const SAMPLE_EVERY_MS = 2 * 60_000;

export type TrackState = {
  at: string;
  /** null: a helyszínnek nincs koordinátája, nem tudjuk eldönteni */
  inside: boolean | null;
  distance: number | null;
  site: Site | null;
} | null;

const visible = () => typeof document === 'undefined' || document.visibilityState === 'visible';

/** A saját futó munkamenet helyzetének jelentése; az utolsó helyi mérés eredményét adja vissza. */
export function useSessionTracker(openSession: WorkSession | undefined, sites: Site[]): TrackState {
  const [state, setState] = useState<TrackState>(null);
  const busy = useRef(false);
  const sessionId = openSession?.id;
  const siteId = openSession?.site_id ?? null;
  const siteRef = useRef<Site | null>(null);
  siteRef.current = sites.find((s) => s.id === siteId) ?? null;

  useEffect(() => {
    if (!sessionId) { setState(null); return; }
    let alive = true;
    const sample = async () => {
      if (busy.current || !visible()) return;
      if ((await geoPermission()) !== 'granted') return;
      busy.current = true;
      try {
        const pos = await getPosition();
        if (!pos || !alive) return;
        const at = new Date().toISOString();
        const site = siteRef.current;
        let inside: boolean | null = null;
        let distance: number | null = null;
        if (site && site.lat != null && site.lng != null) {
          distance = Math.round(distanceM(pos.lat, pos.lng, site.lat, site.lng));
          inside = distance <= (site.geofence_radius_m ?? 150) + Math.min(pos.accuracy || 0, 100);
        }
        // offline is sorba áll; a szerver a lezárt munkamenetre érkező késői mintát csendben eldobja
        queueRpc('report_position', {
          p_session: sessionId, p_lat: pos.lat, p_lng: pos.lng,
          p_accuracy: Math.round(pos.accuracy || 0), p_at: at, p_source: 'app',
        });
        setState({ at, inside, distance, site });
      } finally { busy.current = false; }
    };
    void sample();
    const timer = setInterval(() => { void sample(); }, SAMPLE_EVERY_MS);
    const onVis = () => { if (visible()) void sample(); };
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVis);
    return () => {
      alive = false; clearInterval(timer);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVis);
    };
  }, [sessionId, siteId]);

  return state;
}
