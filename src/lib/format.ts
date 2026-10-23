import i18n from '@/i18n';

/** Decimal (SI) units, like the OS storage screens: 1 GB = 1e9 bytes. */
export function formatBytes(bytes: number, digits?: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = Math.min(units.length - 1, Math.floor(Math.log10(bytes) / 3));
  if (i < 2) i = 2; // never show B/KB for content sizes
  const value = bytes / 10 ** (i * 3);
  const fractionDigits = digits ?? (value >= 100 ? 0 : value >= 10 ? 1 : value >= 1 ? 1 : 2);
  const formatted = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: fractionDigits }).format(value);
  return `${formatted} ${units[i]}`;
}

export function formatMB(mb: number): string {
  return formatBytes(mb * 1e6);
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—';
  if (seconds < 60) return `${Math.ceil(seconds)} s`;
  if (seconds < 3600) return `${Math.ceil(seconds / 60)} min`;
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return m ? `${h} h ${m} min` : `${h} h`;
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat(i18n.language).format(n);
}

export function formatRelativeDate(ts: number): string {
  const diff = (ts - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(i18n.language, { numeric: 'auto' });
  const abs = Math.abs(diff);
  if (abs < 60) return rtf.format(Math.round(diff), 'second');
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), 'day');
  return new Date(ts).toLocaleDateString(i18n.language, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
