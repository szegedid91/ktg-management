// Audit napló — ember-olvasható formában: a nyers mező-diffek helyett
// nevekkel, formázott összegekkel és magyar címkékkel írjuk le, mi történt.

import React, { useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { Screen, Card, H2, Sub, Body, Btn, Empty, Picker, Loading, Input } from '../ui/kit';
import { C, S } from '../ui/theme';
import { useTable, useOnlineView } from '../lib/hooks';
import { fetchView } from '../lib/repo';
import { hdt, hd, ft, todayISO, addDaysISO } from '../lib/format';
import {
  AuditLogRow, Profile, Site, Worker, ExternalPerson, ExpenseCategory, Equipment,
} from '../lib/types';

const TABLE_LABELS: Record<string, string> = {
  sites: 'Építkezés', expenses: 'Költség', expense_photos: 'Számlafotó',
  workers: 'Munkavállaló', external_people: 'Külsős személy', attendance: 'Jelenlét',
  comments: 'Komment', invoices: 'Számla', settlements: 'Elszámolás',
  equipment: 'Eszköz', equipment_moves: 'Eszközmozgatás', profiles: 'Profil',
  app_settings: 'Beállítások', expense_categories: 'Kategória',
};

const FIELD_LABELS: Record<string, string> = {
  name: 'Név', title: 'Megnevezés', note: 'Megjegyzés', address: 'Cím', status: 'Státusz',
  body: 'Szöveg', display_name: 'Név', email: 'E-mail', phone: 'Telefon', phones: 'Telefonszámok',
  net_amount: 'Nettó összeg', gross_amount: 'Bruttó összeg', vat_amount: 'ÁFA összeg',
  vat_rate: 'ÁFA kulcs (%)', amount: 'Összeg', commission_amount: 'Közvetítői díj',
  expense_date: 'Dátum', work_date: 'Dátum', invoice_date: 'Számla kelte', settle_date: 'Dátum',
  due_date: 'Fizetési határidő', default_payment_days: 'Fizetési határidő (nap)',
  site_id: 'Építkezés', worker_id: 'Munkavállaló', category_id: 'Kategória',
  equipment_id: 'Eszköz', expense_id: 'Költség', paid_by: 'Fizette',
  pay_basis: 'Elszámolás', hours: 'Óraszám', day_multiplier: 'Nap szorzó', applied_rate: 'Alkalmazott díj',
  paid_note: 'Kifizetési megjegyzés', commission_paid_note: 'Közvetítői kifizetés megjegyzése',
  hourly_rate: 'Órabér', daily_rate: 'Napi díj', project_rate: 'Projektdíj',
  default_pay_basis: 'Alap elszámolás', trade: 'Szakipar', worker_type: 'Típus',
  company_name: 'Cégnév', tax_number: 'Adószám', hq_address: 'Székhely', is_vat_payer: 'ÁFA-körös',
  referrer_user_id: 'Közvetítő (tulajdonos)', referrer_external_id: 'Közvetítő (külsős)',
  commission_mode: 'Jutalék típusa', commission_value: 'Jutalék értéke', commission_unit: 'Jutalék egysége',
  location_label: 'Helyszín', taken_by: 'Elvitte', moved_at: 'Mozgatás ideje',
  from_user: 'Küldő', to_user: 'Fogadó', profit_share_percent: 'Profitrészesedés (%)',
  big_expense_threshold: 'Riasztási küszöb', overdue_days: 'Lejárat (nap)',
  company_hourly_rate: 'Céges órabér', company_daily_rate: 'Céges napi díj', company_project_rate: 'Céges projektdíj',
  individual_hourly_rate: 'Magánszemély órabér', individual_daily_rate: 'Magánszemély napi díj',
  individual_project_rate: 'Magánszemély projektdíj',
  out_hourly_rate: 'Kimenő órabér', out_daily_rate: 'Kimenő napi díj', out_project_rate: 'Kimenő projektdíj',
  default_vat_rate: 'Alapértelmezett ÁFA (%)',
  notify_comments: 'Komment értesítés', notify_big_expense: 'Nagy költés riasztás',
  notify_weekly: 'Heti összefoglaló', notify_overdue: 'Lejárat értesítés',
};

const MONEY_FIELDS = new Set([
  'net_amount', 'gross_amount', 'vat_amount', 'amount', 'commission_amount', 'applied_rate',
  'hourly_rate', 'daily_rate', 'project_rate', 'big_expense_threshold', 'commission_value',
  'company_hourly_rate', 'company_daily_rate', 'company_project_rate',
  'individual_hourly_rate', 'individual_daily_rate', 'individual_project_rate',
  'out_hourly_rate', 'out_daily_rate', 'out_project_rate',
]);
const DATE_FIELDS = new Set(['expense_date', 'work_date', 'invoice_date', 'settle_date', 'due_date']);
// technikai mezők, amiket nem sorolunk fel diffként (a fontosakat külön kezeljük)
const SKIP_FIELDS = new Set([
  'id', 'created_by', 'created_at', 'updated_at', 'updated_by', 'deleted_at',
  'paid_at', 'paid_by', 'commission_paid_at', 'commission_paid_by',
  'paid_marked_by', 'closed_at', 'closed_by', 'invoiced_at',
  'push_token', 'storage_path', 'photo_path', 'bank_account_enc',
]);

const BASIS_LABELS: Record<string, string> = {
  hourly: 'órabér', daily: 'napi díj', project: 'projektdíj', presence: 'csak jelenlét',
};

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={{ backgroundColor: on ? C.primary : C.chipBg, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 }}
    >
      <Text style={{ color: on ? '#fff' : C.text, fontSize: 13, fontWeight: '600' }}>{on ? '✓ ' : ''}{label}</Text>
    </Pressable>
  );
}

type DateRange = 'all' | 'today' | '7d' | '30d';
const DATE_OPTIONS: { value: DateRange; label: string }[] = [
  { value: 'all', label: 'Mind' },
  { value: 'today', label: 'Ma' },
  { value: '7d', label: '7 nap' },
  { value: '30d', label: '30 nap' },
];

export default function Audit() {
  const profiles = useTable<Profile>('profiles');
  const sites = useTable<Site>('sites', true);
  const workers = useTable<Worker>('workers', true);
  const externals = useTable<ExternalPerson>('external_people', true);
  const categories = useTable<ExpenseCategory>('expense_categories', true);
  const equipment = useTable<Equipment>('equipment', true);

  const [userFilter, setUserFilter] = useState<string | null>(null);
  const [tableFilter, setTableFilter] = useState<string | null>(null);
  // munkavállaló-szűrő — a törölt munkavállalók is választhatók
  const [workerFilter, setWorkerFilter] = useState<string | null>(null);
  const [dateFilter, setDateFilter] = useState<DateRange>('all');
  // egyéni tól–ig tartomány — kitöltve felülírja a gyors chipeket
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [limit, setLimit] = useState(50);

  const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
  const customFrom = ISO_DATE.test(fromDate) ? fromDate : null;
  const customTo = ISO_DATE.test(toDate) ? toDate : null;
  const customActive = !!(customFrom || customTo);

  const dateFrom = customActive ? customFrom
    : dateFilter === 'today' ? todayISO()
      : dateFilter === '7d' ? addDaysISO(todayISO(), -7)
        : dateFilter === '30d' ? addDaysISO(todayISO(), -30)
          : null;
  // az "ig" nap is beleszámít: a következő nap éjfélje előtti eseményekig szűrünk
  const dateToExcl = customTo ? addDaysISO(customTo, 1) : null;

  const rows = useOnlineView<AuditLogRow[]>(
    `audit-${userFilter}-${tableFilter}-${workerFilter}-${dateFilter}-${fromDate}-${toDate}-${limit}`,
    () => fetchView('audit_log', (q) => {
      let x = q.order('changed_at', { ascending: false }).limit(limit);
      if (userFilter) x = x.eq('changed_by', userFilter);
      if (tableFilter) x = x.eq('table_name', tableFilter);
      if (dateFrom) x = x.gte('changed_at', dateFrom);
      if (dateToExcl) x = x.lt('changed_at', dateToExcl);
      if (workerFilter) {
        // minden, ami a munkavállalóhoz köthető: a saját adatlapja,
        // a jelenlétei, és a rá írt kommentek
        x = x.or([
          `record_id.eq.${workerFilter}`,
          `new_data->>worker_id.eq.${workerFilter}`,
          `old_data->>worker_id.eq.${workerFilter}`,
          `new_data->>entity_id.eq.${workerFilter}`,
        ].join(','));
      }
      return x;
    }),
    [userFilter, tableFilter, workerFilter, dateFilter, fromDate, toDate, limit],
  );

  const hasFilter = !!(userFilter || tableFilter || workerFilter || dateFilter !== 'all' || fromDate || toDate);
  const clearFilters = () => {
    setUserFilter(null); setTableFilter(null); setWorkerFilter(null);
    setDateFilter('all'); setFromDate(''); setToDate('');
  };

  const userName = (id: unknown) => profiles.find((p) => p.id === id)?.display_name ?? 'rendszer';
  const siteName = (id: unknown) => (id ? sites.find((s) => s.id === id)?.name ?? 'ismeretlen építkezés' : 'közös');
  const workerNm = (id: unknown) => workers.find((w) => w.id === id)?.name ?? 'ismeretlen munkavállaló';
  const extName = (id: unknown) => externals.find((e) => e.id === id)?.name ?? 'ismeretlen külsős';
  const catName = (id: unknown) => categories.find((c) => c.id === id)?.name ?? 'ismeretlen kategória';
  const eqName = (id: unknown) => equipment.find((e) => e.id === id)?.name ?? 'ismeretlen eszköz';

  const fmtVal = (field: string, v: unknown): string => {
    if (v === null || v === undefined || v === '') return 'üres';
    if (typeof v === 'boolean') return v ? 'igen' : 'nem';
    if (MONEY_FIELDS.has(field)) return ft(Number(v));
    if (DATE_FIELDS.has(field)) return hd(String(v));
    if (field === 'site_id') return siteName(v);
    if (field === 'worker_id') return workerNm(v);
    if (field === 'category_id') return catName(v);
    if (field === 'equipment_id') return eqName(v);
    if (field === 'referrer_external_id') return extName(v);
    if (field === 'referrer_user_id' || field === 'paid_by' || field === 'from_user' || field === 'to_user') return userName(v);
    if (field === 'pay_basis' || field === 'default_pay_basis') return BASIS_LABELS[String(v)] ?? String(v);
    if (field === 'status') return v === 'active' ? 'aktív' : 'lezárt';
    if (field === 'worker_type') return v === 'company' ? 'céges' : 'magánszemély';
    if (field === 'moved_at') return hdt(String(v));
    if (Array.isArray(v)) return v.join(', ') || 'üres';
    return String(v);
  };

  /** Mi az érintett tétel? — pl. "Segéd Sanyi — 2026.04.07. · Újlak utca" */
  const subject = (r: AuditLogRow): string => {
    const d = (r.new_data ?? r.old_data ?? {}) as Record<string, unknown>;
    switch (r.table_name) {
      case 'sites': return String(d.name ?? '');
      case 'workers': return `${d.name}${d.trade ? ` (${d.trade})` : ''}`;
      case 'external_people': return String(d.name ?? '');
      case 'equipment': return String(d.name ?? '');
      case 'expense_categories': return String(d.name ?? '');
      case 'profiles': return String(d.display_name ?? '');
      case 'app_settings': return 'Alapértelmezett díjak és ÁFA';
      case 'attendance':
        return `${workerNm(d.worker_id)} — ${hd(String(d.work_date))} · ${siteName(d.site_id)}`;
      case 'expenses':
        return `${d.title ?? (d.category_id ? catName(d.category_id) : 'költség')} — ${ft(Number(d.net_amount ?? 0))} nettó · ${siteName(d.site_id)}`;
      case 'invoices':
        return `${d.title ?? 'számla'} — ${ft(Number(d.net_amount ?? 0))} nettó · ${siteName(d.site_id)}`;
      case 'settlements':
        return `${userName(d.from_user)} → ${userName(d.to_user)}: ${ft(Number(d.amount ?? 0))}`;
      case 'comments':
        return `„${String(d.body ?? '').slice(0, 60)}${String(d.body ?? '').length > 60 ? '…' : ''}”`;
      case 'equipment_moves':
        return `${eqName(d.equipment_id)} → ${d.site_id ? siteName(d.site_id) : d.location_label ?? '?'}`;
      case 'expense_photos': return 'számlafotó';
      default: return '';
    }
  };

  /** Fejléc: felismerjük a tipikus eseményeket, a többinél általános címke. */
  const headline = (r: AuditLogRow): string => {
    const label = TABLE_LABELS[r.table_name] ?? r.table_name;
    const o = (r.old_data ?? {}) as Record<string, unknown>;
    const n = (r.new_data ?? {}) as Record<string, unknown>;
    if (r.action === 'UPDATE') {
      if (!o.deleted_at && n.deleted_at) return `${label} törölve`;
      if (o.deleted_at && !n.deleted_at) return `${label} visszaállítva`;
      if (r.table_name === 'attendance') {
        if (!o.paid_at && n.paid_at) return 'Bér kifizetve jelölve';
        if (o.paid_at && !n.paid_at) return 'Bér kifizetése visszavonva';
        if (!o.commission_paid_at && n.commission_paid_at) return 'Közvetítői díj kifizetve jelölve';
        if (o.commission_paid_at && !n.commission_paid_at) return 'Közvetítői díj kifizetése visszavonva';
      }
      if (r.table_name === 'invoices') {
        if (!o.paid_at && n.paid_at) return 'Számla befolyt jelölve';
        if (o.paid_at && !n.paid_at) return 'Számla befolyás visszavonva';
      }
      if (r.table_name === 'sites') {
        if (o.status === 'active' && n.status === 'closed') return 'Építkezés lezárva';
        if (o.status === 'closed' && n.status === 'active') return 'Építkezés újranyitva';
      }
      return `${label} módosítva`;
    }
    if (r.action === 'DELETE') return `${label} végleg törölve`;
    return `${label} létrehozva`;
  };

  /** Módosításnál: mi változott, ember-olvashatóan. */
  const changes = (r: AuditLogRow): string[] => {
    if (r.action !== 'UPDATE' || !r.old_data || !r.new_data) return [];
    const out: string[] = [];
    for (const key of Object.keys(r.new_data)) {
      if (SKIP_FIELDS.has(key)) continue;
      const oldV = (r.old_data as any)[key];
      const newV = (r.new_data as any)[key];
      if (JSON.stringify(oldV) === JSON.stringify(newV)) continue;
      const label = FIELD_LABELS[key] ?? key;
      out.push(`${label}: ${fmtVal(key, oldV)} → ${fmtVal(key, newV)}`);
    }
    return out.slice(0, 8);
  };

  return (
    <Screen>
      <Card>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <H2>🔎 Szűrés</H2>
          {hasFilter ? (
            <Text onPress={clearFilters} style={{ color: C.primary, fontSize: 13, fontWeight: '700' }}>
              ✕ Szűrők törlése
            </Text>
          ) : null}
        </View>

        <Sub>Időszak:</Sub>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {DATE_OPTIONS.map((o) => (
            <Chip
              key={o.value}
              label={o.label}
              on={!customActive && dateFilter === o.value}
              onPress={() => { setDateFilter(o.value); setFromDate(''); setToDate(''); }}
            />
          ))}
        </View>
        <View style={{ flexDirection: 'row', gap: S.sm }}>
          <View style={{ flex: 1 }}>
            <Input label="Dátumtól" value={fromDate} onChangeText={setFromDate} placeholder="ÉÉÉÉ-HH-NN" />
          </View>
          <View style={{ flex: 1 }}>
            <Input label="Dátumig" value={toDate} onChangeText={setToDate} placeholder="ÉÉÉÉ-HH-NN" />
          </View>
        </View>

        <Sub>Ki csinálta:</Sub>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          <Chip label="Mindenki" on={!userFilter} onPress={() => setUserFilter(null)} />
          {profiles.map((p) => (
            <Chip
              key={p.id}
              label={p.display_name}
              on={userFilter === p.id}
              onPress={() => setUserFilter(userFilter === p.id ? null : p.id)}
            />
          ))}
        </View>

        <Picker
          label="Munkavállaló (a töröltek is kereshetők)"
          items={[...workers].sort((a, b) => a.name.localeCompare(b.name, 'hu'))}
          selectedId={workerFilter}
          getId={(w) => w.id}
          getLabel={(w) => `${w.name}${w.deleted_at ? ' (törölt)' : ''}`}
          onSelect={setWorkerFilter}
          allowNull
          nullLabel="— minden munkavállaló —"
        />
        <Picker
          label="Terület"
          items={Object.entries(TABLE_LABELS).map(([k, v]) => ({ id: k, label: v }))}
          selectedId={tableFilter}
          getId={(i) => i.id}
          getLabel={(i) => i.label}
          onSelect={setTableFilter}
          allowNull
          nullLabel="— minden terület —"
        />
      </Card>

      {rows.loading ? <Loading /> : null}
      {rows.fromCache ? <Sub style={{ color: C.warning }}>⚠️ Offline — utolsó ismert napló.</Sub> : null}
      {(rows.data ?? []).length === 0 && !rows.loading ? <Empty text="Nincs naplóbejegyzés." /> : null}
      {(rows.data ?? []).map((r) => {
        const diff = changes(r);
        const head = headline(r);
        const destructive = head.includes('töröl');
        return (
          <Card key={r.id} style={{ padding: S.md }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Body style={{ fontWeight: '700', color: destructive ? C.danger : C.text, flex: 1 }}>
                {head}
              </Body>
              <Sub>{hdt(r.changed_at)}</Sub>
            </View>
            <Body>{subject(r)}</Body>
            <Sub>{userName(r.changed_by)}</Sub>
            {diff.map((line, i) => (
              <Text key={i} style={{ fontSize: 13, color: C.sub }}>• {line}</Text>
            ))}
          </Card>
        );
      })}
      {(rows.data ?? []).length >= limit ? (
        <Btn title="Több betöltése" kind="ghost" onPress={() => setLimit(limit + 50)} />
      ) : null}
    </Screen>
  );
}
