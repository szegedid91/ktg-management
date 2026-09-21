// Térkép — ki hol van most bejelentkezve. A helyet a munkaterület (építkezés)
// koordinátája adja: a nyitott munkamenetek helyszínenként csoportosítva
// jelennek meg. Csak vezetőknek. A térkép weben Leaflet + OpenStreetMap.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Platform, Pressable } from 'react-native';
import { router } from 'expo-router';
import { Screen, Card, H2, Sub, Body, Btn, Empty } from '../ui/kit';
import { C, S } from '../ui/theme';
import { useTable, useIsWorker } from '../lib/hooks';
import { updateRow } from '../lib/repo';
import { geocodeAddress } from '../lib/geo';
import { notify } from '../lib/dialogs';
import { Site, Worker, WorkSession, WorkerTask } from '../lib/types';

type Group = { site: Site; people: { name: string; since: string; task: string | null }[] };

const hm = (iso: string) => new Date(iso).toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' });
const esc = (t: string) => t.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

function LeafletMap({ groups, idle }: { groups: Group[]; idle: Site[] }) {
  const host = useRef<any>(null);
  const map = useRef<any>(null);
  const layer = useRef<any>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let dead = false;
    void (async () => {
      // a Leaflet stíluslapja <link>-ként (a csomagoló dinamikus CSS-importja nem megbízható)
      if (!document.getElementById('leaflet-css')) {
        const link = document.createElement('link');
        link.id = 'leaflet-css'; link.rel = 'stylesheet';
        link.href = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css';
        await new Promise<void>((r) => { link.onload = () => r(); link.onerror = () => r(); document.head.appendChild(link); });
      }
      const L = (await import('leaflet')).default;
      if (dead || !host.current) return;
      map.current = L.map(host.current, { zoomControl: true, attributionControl: true }).setView([47.4979, 19.0402], 11);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map.current);
      layer.current = L.layerGroup().addTo(map.current);
      setReady(true);
    })();
    return () => { dead = true; map.current?.remove(); map.current = null; };
  }, []);

  useEffect(() => {
    if (!ready || !map.current) return;
    void (async () => {
      const L = (await import('leaflet')).default;
      layer.current.clearLayers();
      const pts: [number, number][] = [];
      for (const s of idle) {
        L.circleMarker([s.lat!, s.lng!], { radius: 5, color: '#718096', weight: 1, fillColor: '#A0AEC0', fillOpacity: 0.7 })
          .bindPopup(`<b>${esc(s.name)}</b><br/>most senki nincs bejelentkezve`).addTo(layer.current);
      }
      for (const g of groups) {
        const icon = L.divIcon({
          className: '',
          html: `<div style="background:#2F855A;color:#fff;border:2px solid #fff;border-radius:16px;min-width:30px;height:30px;padding:0 6px;display:flex;align-items:center;justify-content:center;font:800 14px system-ui;box-shadow:0 1px 4px rgba(0,0,0,.4);white-space:nowrap">👷 ${g.people.length}</div>`,
          iconSize: [44, 30], iconAnchor: [22, 15],
        });
        L.marker([g.site.lat!, g.site.lng!], { icon })
          .bindPopup(`<b>${esc(g.site.name)}</b><br/>${g.people.map((p) => `${esc(p.name)} · ${hm(p.since)} óta`).join('<br/>')}`)
          .addTo(layer.current);
        pts.push([g.site.lat!, g.site.lng!]);
      }
      const all = pts.length ? pts : idle.map((s) => [s.lat!, s.lng!] as [number, number]);
      if (all.length === 1) map.current.setView(all[0], 14);
      else if (all.length > 1) map.current.fitBounds(all, { padding: [40, 40], maxZoom: 15 });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, JSON.stringify(groups.map((g) => [g.site.id, g.site.lat, g.site.lng, g.people.length])), idle.length]);

  return <View ref={host} style={{ height: 420, borderRadius: S.radiusSm, overflow: 'hidden', borderWidth: 1, borderColor: C.border, zIndex: 0 }} />;
}

function MapInner() {
  const sites = useTable<Site>('sites');
  const workers = useTable<Worker>('workers');
  const sessions = useTable<WorkSession>('work_sessions');
  const tasks = useTable<WorkerTask>('worker_tasks');
  const [geoBusy, setGeoBusy] = useState<string | null>(null);

  const open = sessions.filter((s) => !s.ended_at && !s.deleted_at);
  const groups: Group[] = useMemo(() => {
    const m = new Map<string, Group>();
    for (const s of open) {
      const site = sites.find((x) => x.id === s.site_id);
      if (!site) continue;
      const g = m.get(site.id) ?? { site, people: [] };
      const t = s.task_id ? tasks.find((x) => x.id === s.task_id) : undefined;
      g.people.push({ name: workers.find((w) => w.id === s.worker_id)?.name ?? '?', since: s.started_at, task: t ? `${t.code ? `${t.code} · ` : ''}${t.title}` : null });
      m.set(site.id, g);
    }
    return [...m.values()].sort((a, b) => b.people.length - a.people.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions, sites, workers, tasks]);

  const noSite = open.filter((s) => !sites.some((x) => x.id === s.site_id));
  const hasLoc = (s: Site) => s.lat != null && s.lng != null;
  const onMap = groups.filter((g) => hasLoc(g.site));
  const activeSites = sites.filter((s) => s.status === 'active');
  const idle = activeSites.filter((s) => hasLoc(s) && !groups.some((g) => g.site.id === s.id));
  const missing = activeSites.filter((s) => !hasLoc(s) && (s.address ?? '').trim());

  // hiányzó helyek beállítása cím alapján (az OSM keresője másodpercenként egy kérést enged)
  const geocodeMissing = async () => {
    let ok = 0; const failed: string[] = [];
    for (let i = 0; i < missing.length; i++) {
      const s = missing[i];
      setGeoBusy(`${i + 1} / ${missing.length}`);
      const hit = await geocodeAddress(s.address!);
      if (hit) { updateRow('sites', s.id, { lat: hit.lat, lng: hit.lng }); ok++; } else failed.push(s.name);
      await new Promise((r) => setTimeout(r, 1100));
    }
    setGeoBusy(null);
    notify('Helyek beállítva', `${ok} munkaterület került a térképre.${failed.length ? `\n\nNem találtam a címét: ${failed.join(', ')} — ezeknél a munkaterület adatlapján állíthatod be a helyet.` : ''}`);
  };

  return (
    <Screen>
      <Card>
        <H2>Most bejelentkezve: {open.length} fő · {groups.length} helyen</H2>
        <Sub>A térkép azt mutatja, ki melyik munkaterületre van bejelentkezve (a munkaterület helye alapján). A szürke pontok az aktív területek, ahol most nincs senki.</Sub>
        {Platform.OS === 'web' ? <LeafletMap groups={onMap} idle={idle} /> : <Sub>A térkép a webes appban érhető el; a lista alább itt is látszik.</Sub>}
        {missing.length > 0 ? (
          <View style={{ gap: 4 }}>
            <Sub>{missing.length} aktív munkaterületnek még nincs helye a térképen.</Sub>
            <Btn title={geoBusy ? `Keresés… ${geoBusy}` : `📍 Helyek beállítása cím alapján (${missing.length})`} kind="secondary" small disabled={!!geoBusy} onPress={() => void geocodeMissing()} />
          </View>
        ) : null}
      </Card>

      {open.length === 0 ? <Empty text="Most senki nincs bejelentkezve." /> : null}
      {groups.map((g) => (
        <Card key={g.site.id}>
          <Pressable onPress={() => router.push(`/site/${g.site.id}` as any)} style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm }}>
            <Text style={{ fontSize: 18 }}>📍</Text>
            <View style={{ flex: 1 }}>
              <Body style={{ fontWeight: '800' }}>{g.site.name}</Body>
              <Sub>{g.site.address ?? ''}{hasLoc(g.site) ? '' : ' · nincs a térképen'}</Sub>
            </View>
            <View style={{ backgroundColor: C.success, borderRadius: 12, paddingHorizontal: 8, paddingVertical: 2 }}>
              <Text style={{ color: '#fff', fontWeight: '800' }}>{g.people.length} fő</Text>
            </View>
          </Pressable>
          {g.people.map((p, i) => (
            <View key={i} style={{ flexDirection: 'row', gap: S.sm, paddingVertical: 2, borderTopWidth: 1, borderTopColor: C.border }}>
              <Body style={{ flex: 1 }} >👷 {p.name}{p.task ? <Text style={{ color: C.sub, fontSize: 12 }}>  {p.task}</Text> : null}</Body>
              <Sub>{hm(p.since)} óta</Sub>
            </View>
          ))}
        </Card>
      ))}
      {noSite.length > 0 ? (
        <Card>
          <Body style={{ fontWeight: '800' }}>Helyszín nélkül</Body>
          {noSite.map((s) => <Sub key={s.id}>👷 {workers.find((w) => w.id === s.worker_id)?.name ?? '?'} · {hm(s.started_at)} óta</Sub>)}
        </Card>
      ) : null}
    </Screen>
  );
}

export default function MapScreen() {
  if (useIsWorker()) return <Screen><Empty text="Nincs jogosultságod ehhez az oldalhoz." /></Screen>;
  return <MapInner />;
}
