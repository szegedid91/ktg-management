// Adatmodell-típusok — a Postgres sémával szinkronban

export type UUID = string;

export interface BaseRow {
  id: UUID;
  created_by: UUID;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface Profile {
  id: UUID;
  display_name: string;
  email: string | null;
  /** admin: hozzáférést kezel, de nem szerepel az elszámolásban */
  is_admin: boolean;
  /** munkavállalói fiók: a hozzá tartozó munkavállaló — csak a sajátját látja */
  worker_id: string | null;
  profit_share_percent: number;
  push_token: string | null;
  notify_comments: boolean;
  notify_big_expense: boolean;
  big_expense_threshold: number;
  notify_weekly: boolean;
  notify_overdue: boolean;
  overdue_days: number;
  created_at: string;
  updated_at: string;
}

export interface AppSettings {
  id: 1;
  company_hourly_rate: number;
  company_daily_rate: number;
  company_project_rate: number;
  individual_hourly_rate: number;
  /** kiszállási díj alapértelmezése (Ft / helyszín / nap); null = 1 óra bére */
  company_callout_fee?: number | null;
  individual_callout_fee?: number | null;
  individual_daily_rate: number;
  individual_project_rate: number;
  out_hourly_rate: number;
  out_daily_rate: number;
  out_project_rate: number;
  default_vat_rate: number;
  /** alapértelmezett fizetési határidő: napok száma a számlázástól */
  default_payment_days: number;
  updated_by: UUID | null;
  updated_at: string;
}

export interface ExpenseCategory extends BaseRow {
  name: string;
  is_builtin: boolean;
}

export type SiteStatus = 'active' | 'closed';

export interface Site extends BaseRow {
  name: string;
  address: string | null;
  note: string | null;
  status: SiteStatus;
  /** a terület helye és a bejelentkezési sugár (m) — az „érkezés” jelzéséhez */
  lat?: number | null;
  lng?: number | null;
  geofence_radius_m?: number | null;
  closed_at: string | null;
  closed_by: UUID | null;
}

export interface ExternalPerson extends BaseRow {
  name: string;
  phone: string | null;
  note: string | null;
}

export type WorkerType = 'company' | 'individual';
export type PayBasis = 'hourly' | 'daily' | 'project';
export type AttendanceBasis = PayBasis | 'presence';

export interface Worker extends BaseRow {
  /** egyedi kiszállási díj (Ft / helyszín / nap); null = alapértelmezett */
  callout_fee?: number | null;
  name: string;
  /** becenév — listákban/csempéken ezt mutatjuk, ha meg van adva */
  nickname: string | null;
  phones: string[];
  email: string | null;
  company_name: string | null;
  tax_number: string | null;
  hq_address: string | null;
  note: string | null;
  worker_type: WorkerType;
  /** null = általános munkaerő; kitöltve = szakember (pl. 'Villanyszerelő') */
  trade: string | null;
  is_vat_payer: boolean;
  vat_rate: number;
  default_pay_basis: PayBasis | null;
  hourly_rate: number | null;
  daily_rate: number | null;
  project_rate: number | null;
  referrer_user_id: UUID | null;
  referrer_external_id: UUID | null;
  commission_mode: 'percent' | 'fixed' | null;
  commission_value: number | null;
  commission_unit: 'hour' | 'day' | 'project' | null;
  /** meghívóval regisztrált munkavállaló: amíg üres, egy vezető
   *  jóváhagyására vár (nem tud belépni) */
  approved_at: string | null;
  approved_by: UUID | null;
  /** vállalkozó: saját embereket hoz; azok bére hozzá kerül */
  is_contractor: boolean;
  /** ha ki van töltve: ennek a vállalkozónak az embere (fiók nélkül) */
  contractor_id: UUID | null;
}

export interface Expense extends BaseRow {
  /** null = közös, területhez nem kötött költség */
  site_id: UUID | null;
  paid_by: UUID;
  expense_date: string;
  title: string | null;
  net_amount: number;
  vat_rate: number;
  vat_amount: number;
  gross_amount: number;
  category_id: UUID | null;
  note: string | null;
}

export interface ExpensePhoto extends BaseRow {
  expense_id: UUID;
  storage_path: string;
}

export interface Attendance extends BaseRow {
  /** a sor összegében lévő kiszállási díj (Ft) */
  callout_fee?: number | null;
  work_date: string;
  site_id: UUID;
  worker_id: UUID;
  pay_basis: AttendanceBasis;
  hours: number | null;
  day_multiplier: number;
  applied_rate: number | null;
  amount: number;
  commission_amount: number;
  referrer_user_id: UUID | null;
  referrer_external_id: UUID | null;
  paid_at: string | null;
  paid_by: UUID | null;
  /** a kifizetéskor írt megjegyzés */
  paid_note: string | null;
  commission_paid_at: string | null;
  commission_paid_by: UUID | null;
  commission_paid_note: string | null;
  note: string | null;
  /** manual = partner rögzítette; session = munkaidőből automatikusan;
   *  task = fix áras (elfogadott ajánlatos) feladat készre jelentésekor */
  source: 'manual' | 'session' | 'task';
  task_id: UUID | null;
}

export interface Comment {
  id: UUID;
  entity_type: 'site' | 'expense' | 'worker' | 'attendance' | 'invoice' | 'equipment' | 'settlement';
  entity_id: UUID;
  author_id: UUID;
  body: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface Invoice extends BaseRow {
  site_id: UUID;
  invoice_date: string;
  invoiced_at: string | null;
  title: string | null;
  net_amount: number;
  vat_rate: number;
  vat_amount: number;
  gross_amount: number;
  /** fizetési határidő */
  due_date: string | null;
  paid_at: string | null;
  paid_marked_by: UUID | null;
  note: string | null;
}

export interface Settlement extends BaseRow {
  from_user: UUID;
  to_user: UUID;
  amount: number;
  settle_date: string;
  note: string | null;
}

export interface Equipment extends BaseRow {
  name: string;
  photo_path: string | null;
  note: string | null;
}

export interface EquipmentMove extends BaseRow {
  equipment_id: UUID;
  site_id: UUID | null;
  location_label: string | null;
  taken_by: string | null;
  moved_at: string;
  note: string | null;
}

export interface AuditLogRow {
  id: number;
  table_name: string;
  record_id: string | null;
  action: 'INSERT' | 'UPDATE' | 'DELETE';
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  changed_by: UUID | null;
  changed_at: string;
}

export interface UserBalance {
  user_id: UUID;
  display_name: string;
  profit_share_percent: number;
  profit_share_amount: number;
  spent_expenses: number;
  spent_wages: number;
  spent_commissions: number;
  settlements_out: number;
  commission_credit: number;
  received_invoices: number;
  settlements_in: number;
  balance: number;
}

export interface CommonResult {
  revenue_paid_net: number;
  revenue_invoiced_net: number;
  outstanding_net: number;
  expense_net: number;
  wage_net: number;
  profit_net: number;
}

export interface SiteTotals {
  site_id: UUID;
  name: string;
  status: SiteStatus;
  expense_net: number;
  expense_vat: number;
  wage_net: number;
  wage_vat: number;
  unpaid_wages: number;
  cost_net: number;
  invoiced_net: number;
  paid_net: number;
  invoice_vat: number;
  outstanding_net: number;
  profit_net: number;
  margin_percent: number | null;
}

/** Részesedés-történet: melyik naptól mennyi — a számítások a tétel
 *  dátumakor érvényes százalékot használják (nem visszamenőleges). */
export interface ProfitShareHistory {
  id: UUID;
  user_id: UUID;
  percent: number;
  valid_from: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/** Részesedés-módosítási javaslat: a másik partner beleegyezésével lép életbe */
export interface ShareChangeRequest {
  id: UUID;
  proposed_by: UUID;
  shares: { user_id: UUID; percent: number }[];
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  effective_from: string | null;
  decided_by: UUID | null;
  decided_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/** Alkalmazáson belüli értesítés (a harang alatt) — csak a címzett látja */
export interface AppNotification {
  id: number;
  kind: string;
  recipient: UUID;
  title: string;
  body: string;
  payload: Record<string, any> | null;
  created_at: string;
  sent_at: string | null;
  read_at: string | null;
  updated_at: string;
  deleted_at: string | null;
}

export type TaskStatus = 'assigned' | 'acknowledged' | 'done' | 'failed' | 'cancelled';

/** Kiadott feladat (kód, cím, helyszín); több munkavállalóra osztható */
export interface WorkerTask extends BaseRow {
  site_id: string | null;
  code: string | null;
  title: string;
  details: string | null;
  status: TaskStatus;
  /** 1 = prioritásos (sürgős) */
  priority: number;
  acknowledged_at: string | null;
  done_at: string | null;
  fail_reason: string | null;
  fail_photo_path: string | null;
  fail_photo_paths: string[];
  /** a kiadó által csatolt fotók (tárolóbeli útvonalak) */
  photo_paths: string[];
  quote_requested: boolean;
  quote_amount: number | null;
  quote_note: string | null;
  quote_submitted_at: string | null;
  quote_accepted_at: string | null;
  quote_accepted_by: string | null;
  /** határidő; lejárta után a partnerek és a munkavállaló riasztást kapnak */
  due_date: string | null;
  overdue_notified_at: string | null;
  /** cikktörzs-kód (item_codes) */
  item_code_id?: string | null;
  /** nem sikerült feladat vezetői lezárása („nem tudták megoldani”) — utána a munkavállaló már nem látja */
  closed_at?: string | null;
}

/** Feladat-folyamat eseménye (szerveroldali trigger írja; csak vezető olvassa) */
export interface TaskEvent {
  id: UUID;
  task_id: UUID;
  kind: 'created' | 'assigned' | 'unassigned' | 'accepted' | 'failed' | 'done' | 'closed' | 'reopened' | 'cancelled' | 'deleted'
    | 'quote_requested' | 'quote_submitted' | 'quote_accepted' | 'quote_rejected' | 'quote_declined' | string;
  worker_id: UUID | null;
  actor_user_id: UUID | null;
  note: string | null;
  photo_paths: string[];
  amount: number | null;
  at: string;
  updated_at: string;
  deleted_at: string | null;
}

/** Cikktörzs-kód (pl. 001S Épület Elektromosság); S = kivitelezés/szolgáltatás/karbantartás, A = anyagbeszerzés */
export interface ItemCode {
  id: UUID;
  code: string;
  name: string;
  group: 'S' | 'A';
  position: number;
  created_by: UUID | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}
export const ITEM_GROUP_LABEL: Record<ItemCode['group'], string> = { S: 'Kivitelezés / Szolgáltatás / Karbantartás', A: 'Anyagbeszerzés' };
export const itemCodeLabel = (c: ItemCode) => `${c.code} ${c.name}`;

/** Részfeladat (pipálható lépés); kötelező fotó esetén csak fotóval pipálható */
export interface TaskSubtask {
  id: UUID;
  task_id: UUID;
  title: string;
  position: number;
  photo_required: boolean;
  photo_paths: string[];
  done_at: string | null;
  done_by: UUID | null;
  created_by: UUID;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/** Feladat-sablon: cím, részletek, részfeladatok, határidő napokban */
export interface TaskTemplate {
  id: UUID;
  name: string;
  title: string;
  details: string | null;
  code_prefix: string | null;
  priority: number;
  quote_requested: boolean;
  due_days: number | null;
  subtasks: { title: string; photo_required?: boolean }[];
  created_by: UUID;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/** Heti óralap: a munkavállaló beküldi, a partner jóváhagyja */
export interface Timesheet {
  id: UUID;
  worker_id: UUID;
  week_start: string;
  status: 'open' | 'submitted' | 'approved' | 'rejected';
  hours: number;
  amount: number;
  days: number;
  submitted_at: string | null;
  submitted_note: string | null;
  decided_at: string | null;
  decided_by: UUID | null;
  decision_note: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface TaskAssignee {
  id: string;
  task_id: string;
  worker_id: string;
  acknowledged_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/** Munkavállaló által rögzített anyagköltség fotós bizonylattal;
 *  resale_net = amennyiért a partner továbbszámlázza (üres = beárazandó) */
export interface TaskMaterial extends BaseRow {
  task_id: string;
  worker_id: string | null;
  amount: number;
  note: string | null;
  photo_path: string | null;
  /** több fotó; az első = photo_path */
  photo_paths: string[];
}

/** Munkafotó a feladathoz: előtte / utána (a munkavállaló a sajátját látja, a vezető mindet) */
export interface TaskPhoto extends BaseRow {
  task_id: string;
  worker_id: string | null;
  kind: 'before' | 'after';
  path: string;
}

/** Feladat pénzügye — csak a vezetők látják (a munkavállaló nem) */
export interface TaskFinance {
  id: UUID;
  task_id: UUID;
  /** amennyiért a feladatot kiszámlázzuk (nettó) */
  invoice_net: number | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/** Anyagköltség továbbszámlázási ára — csak a vezetők látják */
export interface TaskMaterialPricing {
  id: UUID;
  material_id: UUID;
  resale_net: number;
  resale_by: UUID | null;
  resale_at: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export type QuoteStatus = 'requested' | 'submitted' | 'accepted' | 'rejected' | 'declined';

/** Ajánlatkérés-napló: feladat × munkavállaló × kérés. requested = ajánlatra
 *  várunk; submitted = a munkavállaló beküldte (visszaigazolásra vár);
 *  accepted = elfogadva (egyben a feladat elfogadása); rejected = a partner
 *  elutasította / mást választott; declined = a munkavállaló nem vállalja */
export interface TaskQuote {
  id: UUID;
  task_id: UUID;
  worker_id: UUID;
  requested_by: UUID | null;
  requested_at: string;
  amount: number | null;
  note: string | null;
  submitted_at: string | null;
  status: QuoteStatus;
  decided_at: string | null;
  decided_by: UUID | null;
  decision_note: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/** Munkaidő: mikor kezdte / fejezte be (feladathoz köthető) */
export interface WorkSession extends BaseRow {
  worker_id: string;
  site_id: string | null;
  task_id: string | null;
  started_at: string;
  ended_at: string | null;
  note: string | null;
}

// A szinkronizálható táblák nevei
/** Megjegyzés a feladathoz (vezetők írják; a munkavállaló csak a neki szánt, láthatóra állítottat látja) */
export interface TaskNote extends BaseRow {
  task_id: UUID;
  body: string;
  visible_to_workers: boolean;
}

/** Beosztás: ki melyik napon melyik építkezésen lesz (partner írja) */
export interface ScheduleEntry extends BaseRow {
  worker_id: UUID;
  site_id: UUID;
  work_date: string;
  note: string | null;
}

export const SYNC_TABLES = [
  'profiles', 'app_settings', 'expense_categories', 'sites', 'external_people',
  'workers', 'expenses', 'expense_photos', 'attendance', 'comments',
  'invoices', 'settlements', 'equipment', 'equipment_moves',
  'profit_share_history', 'share_change_requests',
  'worker_tasks', 'task_assignees', 'task_materials', 'work_sessions',
  'task_finance', 'task_material_pricing', 'notification_queue', 'task_quotes',
  'task_subtasks', 'task_templates', 'timesheets', 'task_notes', 'schedule_entries', 'task_photos',
  'item_codes', 'task_events',
] as const;

export type SyncTable = typeof SYNC_TABLES[number];
