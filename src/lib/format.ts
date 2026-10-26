import i18n from '@/i18n';

import { scaleBytes } from './units';

export { formatDuration } from './units';

/** Decimal (SI) units, like the OS storage screens: 1 GB = 1e9 bytes. */
export function formatBytes(bytes: number, digits?: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  const { value, unit, fractionDigits } = scaleBytes(bytes, digits);
  const formatted = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: fractionDigits }).format(value);
  return `${formatted} ${unit}`;
}

export function formatMB(mb: number): string {
  return formatBytes(mb * 1e6);
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat(i18n.language).format(n);
}

export function formatRelativeDate(ts: number): string {
  const diff = (ts - Date.now()) / 1000;
  // Hermes has no Intl.RelativeTimeFormat: fall back to an absolute date/time.
  if (typeof Intl.RelativeTimeFormat !== 'function') {
    return new Intl.DateTimeFormat(i18n.language, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(ts);
  }
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
