// The kit as the screens and the PDF show it: template + custom items for this
// household, translated, with computed quantities and expiry status.
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { formatNumber, formatWater } from '@/lib/format';

import { expiryStatus, KIT_CATEGORIES, kitFor, supplies, type ExpiryStatus, type KitCategory, type KitItemDef } from './kit';
import { EMPTY_KIT_ENTRY, usePrepare } from './store';
import type { KitEntry, PrepareData } from './types';

export type KitRow = {
  id: string;
  title: string;
  /** Computed quantity ("24 L") or the template's hint. */
  detail: string;
  entry: KitEntry;
  def: KitItemDef | null;
  status: ExpiryStatus | null;
};

export type KitGroup = { category: KitCategory | 'custom'; title: string; rows: KitRow[] };

function quantity(def: KitItemDef, data: PrepareData, t: (k: string, options?: Record<string, unknown>) => string): string {
  const s = supplies(data.household);
  switch (def.quantity) {
    case 'water':
      return formatWater(s.waterLiters);
    case 'food':
      return t('prepare:kit.quantity.food', { days: data.household.days, kcal: formatNumber(s.foodKcal) });
    case 'medication':
      return t('prepare:kit.quantity.medication', { days: s.medicationDays });
    default:
      return t(`prepare:kit.items.${def.id}.hint`);
  }
}

export function kitGroups(data: PrepareData, t: (k: string, options?: Record<string, unknown>) => string, now = new Date()): KitGroup[] {
  const row = (id: string, title: string, detail: string, def: KitItemDef | null): KitRow => {
    const entry = data.kit[id] ?? EMPTY_KIT_ENTRY;
    return { id, title, detail, entry, def, status: entry.expires ? expiryStatus(entry.expires, now) : null };
  };
  const items = kitFor(data.household);
  const groups: KitGroup[] = KIT_CATEGORIES.map((category) => ({
    category,
    title: t(`prepare:kit.categories.${category}`),
    rows: items.filter((d) => d.category === category).map((d) => row(d.id, t(`prepare:kit.items.${d.id}.title`), quantity(d, data, t), d)),
  }));
  groups.push({ category: 'custom', title: t('prepare:kit.categories.custom'), rows: data.custom.map((c) => row(c.id, c.name, '', null)) });
  return groups.filter((g) => g.rows.length);
}

export type PrepareSummary = {
  done: number;
  total: number;
  /** Items expired or expiring this month or the next. */
  attention: number;
  /** Of those, the ones already expired: they need replacing now, not soon. */
  expired: number;
  contacts: number;
  meeting: boolean;
  started: boolean;
};

export function summarize(data: PrepareData, groups: KitGroup[]): PrepareSummary {
  const rows = groups.flatMap((g) => g.rows);
  return {
    done: rows.filter((r) => r.entry.have).length,
    total: rows.length,
    attention: rows.filter((r) => r.status === 'expired' || r.status === 'soon').length,
    expired: rows.filter((r) => r.status === 'expired').length,
    contacts: data.contacts.length,
    meeting: !!(data.meeting.primary || data.meeting.secondary),
    started:
      rows.some((r) => r.entry.have) ||
      data.contacts.length > 0 ||
      !!data.meeting.primary ||
      data.people.length > 0 ||
      data.numbers.length > 0,
  };
}

/** Subscribes to the whole plan: fine, it is small and only these screens use it. */
export function useKitGroups(): { data: PrepareData; groups: KitGroup[]; summary: PrepareSummary } {
  // `t` changes with the language, which also re-formats the quantities.
  const { t } = useTranslation('prepare');
  const data = usePrepare();
  return useMemo(() => {
    const groups = kitGroups(data, t);
    return { data, groups, summary: summarize(data, groups) };
  }, [data, t]);
}
