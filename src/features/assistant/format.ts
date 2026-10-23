import i18n from '@/i18n';

/** 0..1 → "45 %" (es) / "45%" (en). */
export function formatPercent(value: number): string {
  const v = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
  return new Intl.NumberFormat(i18n.language, { style: 'percent', maximumFractionDigits: 0 }).format(v);
}

/**
 * Short label for a conversation timestamp: time for today, else day + month.
 * (Hermes has no Intl.RelativeTimeFormat, so lib/format's relative dates can't be used.)
 */
export function formatChatDate(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  if (ts >= new Date(now).setHours(0, 0, 0, 0)) return d.toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' });
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString(i18n.language, { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) });
}
