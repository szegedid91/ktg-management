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
  name: string;
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

// A szinkronizálható táblák nevei
export const SYNC_TABLES = [
  'profiles', 'app_settings', 'expense_categories', 'sites', 'external_people',
  'workers', 'expenses', 'expense_photos', 'attendance', 'comments',
  'invoices', 'settlements', 'equipment', 'equipment_moves',
] as const;

export type SyncTable = typeof SYNC_TABLES[number];
