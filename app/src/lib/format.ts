// Magyar formázási segédfüggvények — pénz, dátum

/** 1250000 -> "1 250 000 Ft" (ezres tagolás szóközzel) */
export function ft(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || isNaN(amount)) return '– Ft';
  const rounded = Math.round(amount);
  const sign = rounded < 0 ? '-' : '';
  const digits = Math.abs(rounded).toString();
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${sign}${grouped} Ft`;
}

/** "2026-08-26" vagy Date -> "2026.08.26." */
export function hd(date: string | Date | null | undefined): string {
  if (!date) return '–';
  const d = typeof date === 'string' ? new Date(date.slice(0, 10) + 'T00:00:00') : date;
  if (isNaN(d.getTime())) return '–';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}.${m}.${day}.`;
}

/** timestamptz -> "2026.08.26. 14:35" */
export function hdt(ts: string | null | undefined): string {
  if (!ts) return '–';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '–';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hd(d)} ${hh}:${mm}`;
}

/** Mai nap ISO formában (lokális idő szerint): "2026-08-26" */
export function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function addDaysISO(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const MONTHS = ['január', 'február', 'március', 'április', 'május', 'június',
  'július', 'augusztus', 'szeptember', 'október', 'november', 'december'];
const DAYS_SHORT = ['V', 'H', 'K', 'Sze', 'Cs', 'P', 'Szo'];

export function monthName(m: number): string {
  return MONTHS[m] ?? '';
}

export function dayShort(dow: number): string {
  return DAYS_SHORT[dow] ?? '';
}

/** Szám-input értelmezése: szóközök, Ft, vessző kezelése */
export function parseAmount(input: string): number {
  const cleaned = input.replace(/[^\d,.-]/g, '').replace(',', '.');
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}
