// "Your preparation" on Home (docs/UX_SURVIVAL_PLAN.md): what is ready for a crisis and what
// is missing, each with where to fix it. Computed from what is installed, the downloads in
// flight and the preparedness plan.
import type { Href } from 'expo-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useActiveModel } from '@/features/assistant/useActiveModel';
import { catalog } from '@/features/catalog';
import { useItems } from '@/features/content/items';
import { useDownloads, type DownloadRecord } from '@/features/downloads/manager';
import { useCountries } from '@/features/maps/countries';
import { getRegion, regionName } from '@/features/maps/regions';
import { guideResources } from '@/features/onboarding/kit';
import { useKitGroups } from '@/features/prepare/rows';
import { useSettings } from '@/stores/settings';

export type ReadinessKey = 'map' | 'guides' | 'wikipedia' | 'assistant' | 'plan' | 'kit';

export type ReadinessItem = {
  key: ReadinessKey;
  title: string;
  /** What is there, or what to do. */
  detail: string;
  done: boolean;
  /** 0–1 while downloading. */
  progress: number | null;
  /** Needs a refresh while there is a connection (old map data, expiring kit items). */
  warning: boolean;
  href: Href;
};

/** Map data older than this is worth refreshing while online. */
const STALE_MONTHS = 6;

const IN_FLIGHT = new Set(['queued', 'running', 'paused', 'processing']);

/** 0–1 over the matching downloads in flight, or null when there are none. */
function progressOf(records: Record<string, DownloadRecord>, match: (r: DownloadRecord) => boolean): number | null {
  const active = Object.values(records).filter((r) => IN_FLIGHT.has(r.status) && match(r));
  const total = active.reduce((sum, r) => sum + r.totalBytes, 0);
  return active.length ? (total ? Math.min(1, active.reduce((sum, r) => sum + r.bytesWritten, 0) / total) : 0) : null;
}

function monthsSince(yyyymmdd: string | null | undefined): number {
  if (!yyyymmdd || yyyymmdd.length !== 8) return 0;
  const d = new Date(Number(yyyymmdd.slice(0, 4)), Number(yyyymmdd.slice(4, 6)) - 1, Number(yyyymmdd.slice(6, 8)));
  return (Date.now() - d.getTime()) / (30.4 * 24 * 3600_000);
}

export function useReadiness(): { items: ReadinessItem[]; done: number } {
  const { t, i18n } = useTranslation('home');
  const country = useSettings((s) => s.country);
  const langs = useSettings((s) => s.contentLanguages);
  const zims = useItems('zim');
  const { countries } = useCountries();
  const model = useActiveModel();
  const { summary } = useKitGroups();
  // Pieces still downloading show their progress instead of a to-do (Home doesn't offer them again).
  const records = useDownloads((s) => s.records);

  return useMemo(() => {
    const region = country ? getRegion(country) : undefined;
    const mine = countries.find((c) => c.regionId === country) ?? (country ? undefined : countries[0]);
    const name = mine?.title ?? (region ? regionName(region, i18n.language) : '');
    const installedIds = new Set(zims.map((z) => z.catalogId ?? z.id));
    const guides = guideResources(langs);
    const guidesHave = guides.filter((r) => installedIds.has(r.id)).length;
    const wikiIds = new Set(Object.values(catalog.wikipedia).flatMap((opts) => opts.map((o) => o.resourceId)));
    const wiki = zims.find((z) => wikiIds.has(z.catalogId ?? ''));
    const stale = !!mine?.map && (mine.update || monthsSince(mine.buildDate) > STALE_MONTHS);
    const guideIds = new Set(guides.map((r) => r.id));
    const guidesProgress = progressOf(records, (r) => guideIds.has(r.id));
    const wikiProgress = wiki ? null : progressOf(records, (r) => wikiIds.has(r.id));
    const modelProgress = model.ready ? null : progressOf(records, (r) => r.kind === 'model');
    const downloading = (p: number) => t('ready.downloading', { pct: Math.round(p * 100) });

    const items: ReadinessItem[] = [
      {
        key: 'map',
        title: name ? t('ready.map', { name }) : t('ready.mapAny'),
        detail: mine?.progress != null
          ? t('ready.downloading', { pct: Math.round(mine.progress * 100) })
          : mine?.preparing != null
            ? t('ready.preparing', { pct: Math.floor(mine.preparing * 100) })
            : mine?.map
              ? stale
                ? mine.update
                  ? t('ready.mapUpdate')
                  : t('ready.mapStale')
                : mine.packs.length
                  ? t('ready.mapDone')
                  : t('ready.mapDoneNoRouting')
              : t('ready.mapTodo'),
        // Ready once its search and points are in, not when its bytes are.
        done: !!mine?.map && mine.preparing === null,
        progress: mine?.progress ?? mine?.preparing ?? null,
        warning: stale,
        href: mine?.map || mine?.progress != null ? '/maps/regions' : country ? { pathname: '/maps/download', params: { regionId: country } } : '/maps/pick',
      },
      {
        key: 'guides',
        title: t('ready.guides'),
        detail:
          guidesProgress !== null
            ? downloading(guidesProgress)
            : guidesHave
              ? t('ready.guidesDone', { count: guidesHave, total: guides.length })
              : t('ready.guidesTodo'),
        // Not while any guide is still coming down: the first of 12 is not "ready".
        done: guidesHave > 0 && guidesProgress === null,
        progress: guidesProgress,
        warning: false,
        href: { pathname: '/library/category/[slug]', params: { slug: 'medicine' } },
      },
      {
        key: 'wikipedia',
        title: t('ready.wikipedia'),
        detail: wiki ? wiki.title : wikiProgress !== null ? downloading(wikiProgress) : t('ready.wikipediaTodo'),
        done: !!wiki,
        progress: wikiProgress,
        warning: false,
        href: '/library/wikipedia',
      },
      {
        key: 'assistant',
        title: t('ready.assistant'),
        detail: model.ready && model.name ? model.name : modelProgress !== null ? downloading(modelProgress) : t('ready.assistantTodo'),
        done: model.ready,
        progress: modelProgress,
        warning: false,
        href: '/assistant/models',
      },
      {
        key: 'plan',
        title: t('ready.plan'),
        detail:
          summary.meeting && summary.contacts
            ? t('ready.planDone', { count: summary.contacts })
            : summary.meeting
              ? t('ready.planMeeting')
              : summary.contacts
                ? t('ready.planContacts', { count: summary.contacts })
                : t('ready.planTodo'),
        done: summary.meeting || summary.contacts > 0,
        progress: null,
        warning: false,
        // The Preparedness hub: plan, kit, PDF export and offline guides.
        href: '/prepare',
      },
      {
        key: 'kit',
        title: t('ready.kit'),
        detail: summary.expired
          ? t('ready.kitExpired', { count: summary.expired })
          : summary.attention
            ? t('ready.kitAttention', { count: summary.attention })
            : summary.done
              ? t('ready.kitProgress', { done: summary.done, total: summary.total })
              : t('ready.kitTodo'),
        done: summary.total > 0 && summary.done >= summary.total,
        progress: null,
        warning: summary.attention > 0,
        href: '/prepare/kit',
      },
    ];
    return { items, done: items.filter((i) => i.done).length };
  }, [country, countries, zims, langs, model.ready, model.name, summary, records, t, i18n.language]);
}
