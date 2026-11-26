import React, { useState } from 'react';
import { View, Text } from 'react-native';
import { Screen, Card, H2, Sub, Btn, Input, Picker, Segmented, Empty } from '../ui/kit';
import { C, S } from '../ui/theme';
import { useTable, useIsWorker } from '../lib/hooks';
import { downloadExport, callExport, saveDownload, fetchWorksheetPdfs } from '../lib/exportfile';
import { makeZip, base64ToBytes, ZipEntry } from '../lib/zip';
import { todayISO, ft, weekRangeLabel } from '../lib/format';
import { Site, Worker, AppSettings } from '../lib/types';
import { notify } from '../lib/dialogs';
import { pickFile } from '../lib/pickfile';

function ExportScreenInner() {
  const sites = useTable<Site>('sites');
  const [from, setFrom] = useState(todayISO().slice(0, 7) + '-01');
  const [to, setTo] = useState(todayISO());
  const [site, setSite] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState('');
  // havi bérkimutatás
  const workers = useTable<Worker>('workers');
  const [month, setMonth] = useState(todayISO().slice(0, 7));
  const [workerId, setWorkerId] = useState<string | null>(null);
  const shiftMonth = (d: number) => {
    const [y, m] = month.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1 + d, 1));
    setMonth(`${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}`);
  };
  const monthLabel = `${month.slice(0, 4)}. ${['január', 'február', 'március', 'április', 'május', 'június', 'július', 'augusztus', 'szeptember', 'október', 'november', 'december'][Number(month.slice(5)) - 1]}`;

  // feladat-összesítő: állapot-szűrő + időszak (hét léptethető, a dátumok kézzel is írhatók; üres kezdet = kezdettől)
  type TaskStatusFilter = 'all' | 'open' | 'done' | 'failed';
  const mondayOf = (iso: string) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
  const addDays = (iso: string, n: number) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const [tStatus, setTStatus] = useState<TaskStatusFilter>('done');
  const [wFrom, setWFrom] = useState(mondayOf(todayISO()));
  const [wTo, setWTo] = useState(addDays(mondayOf(todayISO()), 6));
  const [wSite, setWSite] = useState<string | null>(null);
  const shiftWeek = (n: number) => { const m = addDays(mondayOf(wFrom.trim() || todayISO()), 7 * n); setWFrom(m); setWTo(addDays(m, 6)); };
  const dateLabel = tStatus === 'done' ? 'Készre jelentve' : tStatus === 'failed' ? 'Nem sikerültre jelentve' : 'Kiadva';

  // elszámolás az ügyfél felé („Heti elszámolás” minta): feladatonként tömb — munkaóra, kiszállás, anyagok, összesen
  const settings = useTable<AppSettings>('app_settings')[0];
  const [sStatus, setSStatus] = useState<TaskStatusFilter>('done');
  const [sFrom, setSFrom] = useState(mondayOf(todayISO()));
  const [sTo, setSTo] = useState(addDays(mondayOf(todayISO()), 6));
  const [sSite, setSSite] = useState<string | null>(null);
  const [sWorker, setSWorker] = useState<string | null>(null);
  const [sCode, setSCode] = useState('');
  // a beírt / bemásolt sorszámok (új sor, vessző, pontosvessző vagy szóköz választja el)
  const sCodes = [...new Set(sCode.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean))];
  // az ügyfél felé számlázott órabér és kiszállási díj egy helyen van megadva: Beállítások › Díjak (a szerver is onnan veszi)
  const outHourly = Number(settings?.out_hourly_rate ?? 0);
  const outCallout = Number(settings?.out_callout_fee ?? 0);
  const monthRange = (shift: number) => {
    const d = new Date(todayISO() + 'T00:00:00Z'); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + shift);
    const first = d.toISOString().slice(0, 10); d.setUTCMonth(d.getUTCMonth() + 1); d.setUTCDate(0);
    setSFrom(first); setSTo(d.toISOString().slice(0, 10));
  };
  const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
  const shiftSWeek = (n: number) => { const m = addDays(mondayOf(sFrom.trim() || todayISO()), 7 * n); setSFrom(m); setSTo(addDays(m, 6)); };

  // munkalapok a javított elszámolás-Excelből: a letöltött Excel javítva visszatöltve → a munkaóra, kiszállás, anyagok
  // onnan, a dátum / munkavégző / helyszín / idők / megjegyzések az appból
  const worksheetsFromXlsx = async () => {
    const file = await pickFile('.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    if (!file) return;
    setBusy('worksheet-xlsx'); setProgress('');
    try {
      // 1. terv a szervertől (lapónként a feladatok + az Excel felülírásai), 2. PDF-ek darabonként, 3. ZIP itt
      const plan = await callExport({ mode: 'worksheet_xlsx', xlsx_base64: file.base64, filename: file.name, plan_only: true });
      const groups: { key: string; items: any[] }[] = plan.groups ?? [];
      const entries: ZipEntry[] = [];
      for (const g of groups) {
        const pdfs = await fetchWorksheetPdfs(g.items, (d, t) => setProgress(`${g.key}: ${d}/${t}`));
        for (const p of pdfs) entries.push({ path: groups.length > 1 ? `${g.key}/${p.name}` : p.name, bytes: p.bytes });
      }
      if (entries.length === 1) await saveDownload(entries[0].path.split('/').pop()!, 'application/pdf', entries[0].bytes);
      else await saveDownload(String(plan.filename ?? 'munkalapok.zip'), 'application/zip', makeZip(entries));
      const missing: string[] = Array.isArray(plan.missing) ? plan.missing.map(String) : [];
      if (missing.length > 0) notify('Nem minden sorszámhoz készült munkalap', `${missing.length} sorszámhoz nincs feladat az appban:\n${missing.join(', ')}`);
    } catch (e: any) {
      notify('Export hiba', 'Az exporthoz internetkapcsolat kell.\n' + String(e?.message ?? e));
    } finally {
      setBusy(null); setProgress('');
    }
  };

  // elszámolás az ügyfél felé: a szerver a heti Exceleket adja (fájllista), a munkalap-PDF-eket darabonként kérjük,
  // és a ZIP-et (hetenként mappa: Excel + feladatonként egy munkalap) itt rakjuk össze — egyben a szerver CPU-kerete nem bírta
  const settlementDownload = async () => {
    if (outHourly <= 0) {
      notify('Hiányzik az órabér', 'Add meg az ügyfél felé számlázott órabért a Beállítások › Díjak részben — elég egyszer, utána az elszámolás mindig azzal számol.');
      return;
    }
    setBusy('settlement-xlsx'); setProgress('');
    try {
      const body = { mode: 'tasks', layout: 'settlement', status: sStatus, from: sFrom.trim() || undefined, to: sTo.trim() || undefined,
        site_id: sSite, worker_id: sWorker, code: sCodes.join(',') || undefined, as_files: true };
      const data = await callExport(body);
      const missing: string[] = Array.isArray(data.missing) ? data.missing.map(String) : [];
      if (!Array.isArray(data.files)) {
        // egy feladat / sorszám-lista: egyetlen Excel
        await saveDownload(data.filename, data.mime, base64ToBytes(data.base64));
      } else {
        const entries: ZipEntry[] = data.files.map((f: any) => ({ path: String(f.path), bytes: base64ToBytes(String(f.base64)) }));
        const groups: { key: string; taskIds: string[] }[] = data.groups ?? [];
        const total = groups.reduce((a, g) => a + g.taskIds.length, 0); let done = 0;
        for (const g of groups) {
          const pdfs = await fetchWorksheetPdfs(g.taskIds.map((id) => ({ task_id: id })), (d) => setProgress(`munkalapok: ${done + d}/${total}`));
          done += g.taskIds.length;
          for (const p of pdfs) entries.push({ path: `${g.key}/${p.name}`, bytes: p.bytes });
        }
        await saveDownload(String(data.filename), 'application/zip', makeZip(entries));
      }
      if (missing.length > 0) notify('Nem minden sorszám került bele', `${missing.length} megadott sorszámhoz nincs találat (elírás, vagy más az állapota / területe / embere):\n${missing.join(', ')}`);
    } catch (e: any) {
      notify('Export hiba', 'Az exporthoz internetkapcsolat kell.\n' + String(e?.message ?? e));
    } finally {
      setBusy(null); setProgress('');
    }
  };

  // munkalapok az app adataiból a szűrőkkel: terv (hetenként a feladatok), PDF-ek darabonként, ZIP itt
  const worksheetsDownload = async () => {
    setBusy('worksheet-pdf'); setProgress('');
    try {
      const plan = await callExport({ mode: 'worksheet', status: sStatus, from: sFrom.trim() || undefined, to: sTo.trim() || undefined,
        site_id: sSite, worker_id: sWorker, code: sCodes.join(',') || undefined, plan_only: true });
      const groups: { key: string; taskIds: string[] }[] = plan.groups ?? [];
      const total = groups.reduce((a, g) => a + g.taskIds.length, 0); let done = 0;
      if (total === 0) { notify('Nincs feladat', 'A szűrésnek megfelelő feladat nincs.'); return; }
      const entries: ZipEntry[] = [];
      for (const g of groups) {
        const pdfs = await fetchWorksheetPdfs(g.taskIds.map((id) => ({ task_id: id })), (d) => setProgress(`munkalapok: ${done + d}/${total}`));
        done += g.taskIds.length;
        for (const p of pdfs) entries.push({ path: groups.length > 1 ? `${g.key}/${p.name}` : p.name, bytes: p.bytes });
      }
      if (entries.length === 1) await saveDownload(entries[0].path.split('/').pop()!, 'application/pdf', entries[0].bytes);
      else await saveDownload(String(plan.filename ?? 'munkalapok.zip'), 'application/zip', makeZip(entries));
    } catch (e: any) {
      notify('Export hiba', 'Az exporthoz internetkapcsolat kell.\n' + String(e?.message ?? e));
    } finally {
      setBusy(null); setProgress('');
    }
  };

  const doExport = async (format: 'xlsx' | 'pdf', mode: 'books' | 'wages' | 'tasks' | 'settlement' | 'worksheet' = 'books') => {
    if (mode === 'settlement' && outHourly <= 0) {
      notify('Hiányzik az órabér', 'Add meg az ügyfél felé számlázott órabért a Beállítások › Díjak részben — elég egyszer, utána az elszámolás mindig azzal számol.');
      return;
    }
    setBusy(`${mode}-${format}`);
    try {
      const res = await downloadExport(
        mode === 'wages' ? { mode, month, worker_id: workerId, format }
          : mode === 'tasks' ? { mode, status: tStatus, from: wFrom.trim() || undefined, to: wTo.trim() || undefined, site_id: wSite }
          : mode === 'settlement' ? { mode: 'tasks', layout: 'settlement', status: sStatus, from: sFrom.trim() || undefined, to: sTo.trim() || undefined,
              site_id: sSite, worker_id: sWorker, code: sCodes.join(',') || undefined }
          : mode === 'worksheet' ? { mode: 'worksheet', status: sStatus, from: sFrom.trim() || undefined, to: sTo.trim() || undefined,
              site_id: sSite, worker_id: sWorker, code: sCodes.join(',') || undefined }
          : { from, to, site_id: site, format },
      );
      if (mode === 'settlement' && res.missing.length > 0) {
        notify('Nem minden sorszám került bele', `${res.missing.length} megadott sorszámhoz nincs találat (elírás, vagy más az állapota / területe / embere):\n${res.missing.join(', ')}`);
      }
    } catch (e: any) {
      notify('Export hiba', 'Az exporthoz internetkapcsolat kell.\n' + String(e?.message ?? e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen>
      <Card>
        <H2>Könyvelési export</H2>
        <Sub>
          Excel: költséglista számlafotó-hivatkozásokkal, bérek, bevételek,
          ÁFA-bontás külön munkalapokon. PDF: nyomtatható összesítő.
        </Sub>
        <Input label="Időszak kezdete (ÉÉÉÉ-HH-NN)" value={from} onChangeText={setFrom} />
        <Input label="Időszak vége (ÉÉÉÉ-HH-NN)" value={to} onChangeText={setTo} />
        <Picker
          label="Építkezés"
          items={sites}
          selectedId={site}
          getId={(s) => s.id}
          getLabel={(s) => s.name}
          onSelect={setSite}
          allowNull
          nullLabel="— minden építkezés —"
        />
        <View style={{ flexDirection: 'row', gap: S.md }}>
          <View style={{ flex: 1 }}>
            <Btn title={busy === 'books-xlsx' ? 'Készül…' : '📊 Excel (xlsx)'} onPress={() => void doExport('xlsx')} disabled={!!busy} />
          </View>
          <View style={{ flex: 1 }}>
            <Btn title={busy === 'books-pdf' ? 'Készül…' : '📄 PDF'} kind="secondary" onPress={() => void doExport('pdf')} disabled={!!busy} />
          </View>
        </View>
      </Card>

      <Card>
        <H2>Havi bérkimutatás</H2>
        <Sub>Munkavállalónként a hónap napjai, órái, bére és kiszállási díja, kifizetve / függő bontásban. Excel: összesítő + napok munkalap; PDF: nyomtatható kimutatás.</Sub>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.md }}>
          <Btn title="‹" kind="ghost" small onPress={() => shiftMonth(-1)} />
          <H2 style={{ flex: 1, textAlign: 'center' }}>{monthLabel}</H2>
          <Btn title="›" kind="ghost" small onPress={() => shiftMonth(1)} />
        </View>
        <Picker
          label="Munkavállaló"
          items={[...workers].sort((a, b) => a.name.localeCompare(b.name, 'hu'))}
          selectedId={workerId}
          getId={(w) => w.id}
          getLabel={(w) => w.name}
          onSelect={setWorkerId}
          allowNull
          nullLabel="— mindenki —"
        />
        <View style={{ flexDirection: 'row', gap: S.md }}>
          <View style={{ flex: 1 }}>
            <Btn title={busy === 'wages-xlsx' ? 'Készül…' : '📊 Excel (xlsx)'} onPress={() => void doExport('xlsx', 'wages')} disabled={!!busy} />
          </View>
          <View style={{ flex: 1 }}>
            <Btn title={busy === 'wages-pdf' ? 'Készül…' : '📄 PDF'} kind="secondary" onPress={() => void doExport('pdf', 'wages')} disabled={!!busy} />
          </View>
        </View>
      </Card>

      <Card>
        <H2>Feladat-összesítő</H2>
        <Sub>Helyszínenként a hozzá tartozó feladatok kódjai; feladatonként a munkaóra, a munkabér, a kiszállás és az anyagköltség. Excel: Feladatok, Helyszínek, Munkaidő, Anyagok munkalap. Egy feladat összefoglalója a feladat Pénzügy részéből is kérhető.</Sub>
        <Segmented label="Melyik feladatok" value={tStatus} onChange={setTStatus}
          options={[{ value: 'done', label: 'Kész' }, { value: 'open', label: 'Folyamatban' }, { value: 'failed', label: 'Nem sikerült' }, { value: 'all', label: 'Minden' }]} />
        <Sub>{tStatus === 'done' ? 'A készre jelentés dátuma szerint.' : tStatus === 'failed' ? 'A nem sikerült jelentés dátuma szerint.' : 'A kiadás dátuma szerint.'} A hét léptethető, a dátumok kézzel is átírhatók (üres kezdet = kezdettől).</Sub>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.md }}>
          <Btn title="‹" kind="ghost" small onPress={() => shiftWeek(-1)} />
          <H2 style={{ flex: 1, textAlign: 'center' }}>{wFrom.trim() ? `${wFrom.replace(/-/g, '.')}.` : 'kezdettől'} – {wTo.replace(/-/g, '.')}.</H2>
          <Btn title="›" kind="ghost" small onPress={() => shiftWeek(1)} />
        </View>
        <Input label={`${dateLabel} ettől (ÉÉÉÉ-HH-NN)`} value={wFrom} onChangeText={setWFrom} />
        <Input label={`${dateLabel} eddig (ÉÉÉÉ-HH-NN)`} value={wTo} onChangeText={setWTo} />
        <Picker
          label="Építkezés"
          items={sites}
          selectedId={wSite}
          getId={(s) => s.id}
          getLabel={(s) => s.name}
          onSelect={setWSite}
          allowNull
          nullLabel="— minden építkezés —"
        />
        <Btn title={busy === 'tasks-xlsx' ? 'Készül…' : '📊 Excel (xlsx)'} onPress={() => void doExport('xlsx', 'tasks')} disabled={!!busy} />
      </Card>

      <Card>
        <H2>Elszámolás az ügyfél felé</H2>
        <Sub>Feladatonként egy tömb: munka sorszáma és megnevezése, majd Munkaóra (óra × kimenő órabér), Kiszállás (alkalom × kimenő díj), a rögzített anyagok a továbbszámlázott áron (ha nincs beárazva, a bekerülési összegen), Összesen — a lap alján Mindösszesen. Az összegek képletek: a mennyiség vagy az ár Excelben átírható. A letöltés ZIP: hetenként egy mappa (a készre jelentés napja szerint), benne a hét elszámolás-Excelje és feladatonként egy karbantartási munkalap (PDF); több hétnél egy összesítő is. Sok feladatnál a munkalapok darabonként készülnek, ez eltarthat egy-két percig.</Sub>
        <Segmented label="Melyik feladatok" value={sStatus} onChange={setSStatus}
          options={[{ value: 'done', label: 'Kész' }, { value: 'open', label: 'Folyamatban' }, { value: 'all', label: 'Minden' }]} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.md }}>
          <Btn title="‹" kind="ghost" small onPress={() => shiftSWeek(-1)} />
          <View style={{ flex: 1, alignItems: 'center' }}>
            <H2 style={{ textAlign: 'center' }}>{sFrom.trim() ? `${sFrom.replace(/-/g, '.')}.` : 'kezdettől'} – {sTo.replace(/-/g, '.')}.</H2>
            {/* hanyadik hét az évben (ISO-hét: hétfőtől vasárnapig) — az ügyfél elszámolása hetenként megy */}
            {ISO_DATE.test(sTo.trim()) && (!sFrom.trim() || ISO_DATE.test(sFrom.trim())) ? (
              <Sub style={{ textAlign: 'center' }}>{weekRangeLabel(sFrom.trim(), sTo.trim())}</Sub>
            ) : null}
          </View>
          <Btn title="›" kind="ghost" small onPress={() => shiftSWeek(1)} />
        </View>
        <View style={{ flexDirection: 'row', gap: S.sm }}>
          <View style={{ flex: 1 }}><Btn title="Ez a hét" kind="ghost" small onPress={() => shiftSWeek(0)} /></View>
          <View style={{ flex: 1 }}><Btn title="Ez a hónap" kind="ghost" small onPress={() => monthRange(0)} /></View>
          <View style={{ flex: 1 }}><Btn title="Előző hónap" kind="ghost" small onPress={() => monthRange(-1)} /></View>
        </View>
        <Input label={`${sStatus === 'done' ? 'Készre jelentve' : 'Kiadva'} ettől (ÉÉÉÉ-HH-NN)`} value={sFrom} onChangeText={setSFrom} />
        <Input label={`${sStatus === 'done' ? 'Készre jelentve' : 'Kiadva'} eddig (ÉÉÉÉ-HH-NN)`} value={sTo} onChangeText={setSTo} />
        <Picker label="Terület (építkezés)" items={sites} selectedId={sSite} getId={(s) => s.id} getLabel={(s) => s.name} onSelect={setSSite}
          allowNull nullLabel="— minden terület —" />
        <Picker label="Ember (munkavállaló)" items={[...workers].sort((a, b) => a.name.localeCompare(b.name, 'hu'))} selectedId={sWorker} getId={(w) => w.id}
          getLabel={(w) => w.name} onSelect={setSWorker} allowNull nullLabel="— mindenki —" />
        <Input label="Munka sorszáma — több is megadható (új sorban, vesszővel vagy szóközzel; részlet is elég)" value={sCode} onChangeText={setSCode}
          placeholder={'pl. 1502209\nvagy egy bemásolt lista, soronként egy sorszám'} autoCapitalize="none" multiline />
        {sCodes.length > 0 ? (
          <Sub>{sCodes.length} sorszám megadva — ilyenkor az időszak nem számít: a megadott sorszámok kerülnek az elszámolásba (az állapot, a terület és az ember szűrése érvényes marad), a lista sorrendjében.</Sub>
        ) : null}
        <View style={{ borderWidth: 1, borderColor: outHourly > 0 ? C.border : C.warning, borderRadius: S.radiusSm, padding: S.sm, gap: 4 }}>
          {outHourly > 0 ? (
            <>
              <Text style={{ color: C.text, fontWeight: '700' }}>Órabér: {ft(outHourly)} / megkezdett óra</Text>
              <Text style={{ color: C.text, fontWeight: '700' }}>Kiszállási díj: {outCallout > 0 ? `${ft(outCallout)} / alkalom` : 'nincs megadva (0 Ft)'}</Text>
              <Sub>A Beállítások › Díjak részben megadott értékek — itt nem kell újra beírni.</Sub>
            </>
          ) : (
            <Sub style={{ color: C.warning, fontWeight: '700' }}>Még nincs megadva, milyen órabéren számolsz el az ügyfél felé. Add meg egyszer a Beállítások › Díjak részben.</Sub>
          )}
        </View>
        <Btn title={busy === 'settlement-xlsx' ? `Készül… ${progress}` : '🧾 Elszámolás Excelbe'} onPress={() => void settlementDownload()} disabled={!!busy} />
        <Sub>Karbantartási munkalap: feladatonként egy A4-es PDF a munkavállalók által rögzített adatokból (kód, dátum, munkavégző, munkaidő, elvégzett munkálatok, felhasznált anyagok, megjegyzések) — ugyanezekkel a szűrőkkel; több feladatnál ZIP-ben.</Sub>
        <Btn title={busy === 'worksheet-pdf' ? `Készül… ${progress}` : '📋 Munkalapok PDF-ben (az app adataiból)'} kind="secondary" onPress={() => void worksheetsDownload()} disabled={!!busy} />
        <Sub>Ha a letöltött elszámolás-Excelt javítottad (óra, anyag), töltsd vissza, és a munkalapok abból készülnek: a munkaóra, a kiszállás és az anyagok az Excelből, a dátum, a munkavégző, a helyszín, a kezdés és a megjegyzések az appból. Egy heti fájl vagy az egész elszámolás Excelje is feltölthető.</Sub>
        <Btn title={busy === 'worksheet-xlsx' ? `Készül… ${progress}` : '📤 Munkalapok a javított Excelből (feltöltés)'} kind="secondary" onPress={() => void worksheetsFromXlsx()} disabled={!!busy} />
      </Card>
    </Screen>
  );
}

/** Vezetői oldal: munkavállalói fiók nem nyithatja meg (a hookok
 *  sorrendje miatt külön burkolóban, nem a komponensen belüli korai visszatéréssel). */
export default function ExportScreen() {
  if (useIsWorker()) return <Screen><Empty text="Nincs jogosultságod ehhez az oldalhoz." /></Screen>;
  return <ExportScreenInner />;
}
