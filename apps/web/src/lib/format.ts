const KG_PER_LB = 0.45359237;

export function kgToDisplay(kg: number | null | undefined, units: 'lb' | 'kg'): string {
  if (kg == null) return '—';
  if (units === 'kg') return `${Math.round(kg * 10) / 10}`;
  return `${Math.round(kg / KG_PER_LB)}`;
}

export function displayToKg(value: number, units: 'lb' | 'kg'): number {
  return units === 'kg' ? value : value * KG_PER_LB;
}

export function weightLabel(kg: number | null | undefined, units: 'lb' | 'kg'): string {
  if (kg == null) return '—';
  return `${kgToDisplay(kg, units)} ${units}`;
}

export function money(cents: number | null | undefined, currency = 'USD'): string {
  if (cents == null) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
}

export function shortDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

export function timeOnly(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export function clockMMSS(totalS: number): string {
  const m = Math.floor(totalS / 60);
  const s = totalS % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function minutesToTime(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  const ampm = h >= 12 ? 'pm' : 'am';
  const hh = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hh}${ampm}` : `${hh}:${String(m).padStart(2, '0')}${ampm}`;
}

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Plate calculator: plates per side for a target total (bar + plates). */
export function platesPerSide(totalKg: number, units: 'lb' | 'kg'): { plate: number; count: number }[] | null {
  const barKg = units === 'kg' ? 20 : 45 * KG_PER_LB;
  const plates = units === 'kg' ? [25, 20, 15, 10, 5, 2.5, 1.25] : [45, 35, 25, 10, 5, 2.5];
  let perSide = (totalKg - barKg) / 2;
  if (units === 'lb') perSide = perSide / KG_PER_LB;
  if (perSide < 0) return null;
  const out: { plate: number; count: number }[] = [];
  for (const p of plates) {
    const count = Math.floor((perSide + 1e-9) / p);
    if (count > 0) {
      out.push({ plate: p, count });
      perSide -= count * p;
    }
  }
  return out;
}
