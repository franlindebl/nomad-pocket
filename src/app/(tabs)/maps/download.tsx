import { router, useLocalSearchParams } from 'expo-router';
import { AlertTriangle, WifiOff } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Button, Card, Row, Segmented, Text } from '@/components/ui';
import { NotEnoughStorageError } from '@/features/downloads/manager';
import {
  estimateExtract,
  startMapDownload,
  WORLD_BBOX,
  WORLD_ID,
  WORLD_MAX_ZOOM,
  ZOOM_CHOICES,
  type Estimate,
  type ZoomChoice,
} from '@/features/maps/extraction';
import { formatCoords } from '@/features/maps/markers';
import { getRegion, regionName } from '@/features/maps/regions';
import { formatBytes, formatNumber } from '@/lib/format';
import { countBBoxTiles, HttpError, type BBox } from '@/lib/pmtiles';
import { freeBytes, hasRoomFor } from '@/lib/storage';
import { space, useTheme } from '@/theme';

/** Above this many tiles the plan gets too heavy for a phone (memory, time). */
const MAX_TILES = 2_500_000;

type Target = { key: string; title: string; bbox: BBox; regionId: string | null; fixedZoom?: number };

type EstimateState =
  | { status: 'loading' }
  | { status: 'ready'; estimate: Estimate }
  | { status: 'tooLarge' }
  | { status: 'offline' }
  | { status: 'error'; message: string };

/** Area downloads get a fresh key so several areas can coexist. */
const areaKey = () => `area-${Date.now().toString(36)}`;

export default function DownloadSheet() {
  const { t, i18n } = useTranslation('maps');
  const { colors } = useTheme();
  const params = useLocalSearchParams<{ key?: string; regionId?: string; bbox?: string }>();

  const target = useMemo<Target | null>(() => {
    if (params.key === WORLD_ID) return { key: WORLD_ID, title: t('download.titleWorld'), bbox: WORLD_BBOX, regionId: null, fixedZoom: WORLD_MAX_ZOOM };
    if (params.regionId) {
      const r = getRegion(params.regionId);
      if (r) return { key: r.id, title: regionName(r, i18n.language), bbox: r.bbox, regionId: r.id };
    }
    if (params.bbox) {
      const bbox = params.bbox.split(',').map(Number) as BBox;
      if (bbox.length === 4 && bbox.every(Number.isFinite)) {
        const coords = formatCoords((bbox[1] + bbox[3]) / 2, (bbox[0] + bbox[2]) / 2, 2);
        return { key: 'area', title: t('download.areaName', { coords }), bbox, regionId: null };
      }
    }
    return null;
    // Params are fixed for the life of the sheet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fits = (z: number) => !!target && countBBoxTiles(target.bbox, 0, z) <= MAX_TILES;
  const [zoom, setZoom] = useState<number>(() => {
    if (!target) return 14;
    if (target.fixedZoom != null) return target.fixedZoom;
    const preferred = [...ZOOM_CHOICES].reverse().find((z) => z <= (target.regionId ? 14 : 15) && countBBoxTiles(target.bbox, 0, z) <= MAX_TILES);
    return preferred ?? 12;
  });
  // Result per zoom level; the shown state derives from it (no sync setState in effects).
  const [result, setResult] = useState<{ zoom: number; state: EstimateState } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tooLarge = !fits(zoom);

  useEffect(() => {
    if (!target || tooLarge) return;
    const ctrl = new AbortController();
    const done = (state: EstimateState) => !ctrl.signal.aborted && setResult({ zoom, state });
    estimateExtract(target.bbox, 0, zoom, ctrl.signal)
      .then((estimate) => done({ status: 'ready', estimate }))
      .catch((e) => {
        if (e instanceof HttpError) done({ status: 'error', message: e.message });
        else if (e instanceof TypeError || /network|internet|offline/i.test(String(e?.message))) done({ status: 'offline' });
        else done({ status: 'error', message: String(e?.message ?? e) });
      });
    return () => ctrl.abort();
  }, [target, zoom, tooLarge]);

  if (!target) return null;
  const state: EstimateState = tooLarge ? { status: 'tooLarge' } : result?.zoom === zoom ? result.state : { status: 'loading' };

  const est = state.status === 'ready' ? state.estimate : null;
  const size = est?.plan.archiveBytes ?? 0;
  const enough = est ? hasRoomFor(size) : true;

  const start = () => {
    if (!est) return;
    try {
      startMapDownload({ key: target.key === 'area' ? areaKey() : target.key, title: target.title, bbox: target.bbox, minZoom: 0, maxZoom: zoom, regionId: target.regionId, estimate: est });
      router.dismissTo('/maps/regions');
    } catch (e) {
      if (e instanceof NotEnoughStorageError) setError(t('common:storage.notEnough', { needed: formatBytes(e.needed), free: formatBytes(freeBytes()) }));
      else setError(String((e as Error)?.message ?? e));
    }
  };

  const date = est?.build.date;
  const dateLabel = date ? new Date(Number(date.slice(0, 4)), Number(date.slice(4, 6)) - 1, Number(date.slice(6, 8))).toLocaleDateString(i18n.language) : '';

  return (
    <View style={[styles.root, { backgroundColor: colors.bg, paddingBottom: space.xl }]}>
      <Text variant="title2" align="center" numberOfLines={2}>
        {target.title}
      </Text>

      {target.fixedZoom == null ? (
        <View style={{ gap: space.sm }}>
          <Text variant="overline" color="textSecondary">
            {t('download.detail')}
          </Text>
          <Segmented
            options={ZOOM_CHOICES.map((z) => ({ value: String(z), label: t(`download.zoom${z}`) }))}
            value={String(zoom)}
            onChange={(v) => setZoom(Number(v) as ZoomChoice)}
          />
          <Text variant="footnote" color="textSecondary">
            {t(`download.zoomHint.${zoom}`)}
          </Text>
        </View>
      ) : (
        <Text variant="callout" color="textSecondary">
          {t('regions.worldBody', { zoom: WORLD_MAX_ZOOM })}
        </Text>
      )}

      <Card style={{ gap: space.xs }}>
        <Text variant="overline" color="textSecondary">
          {t('download.size')}
        </Text>
        {state.status === 'loading' ? (
          <Row gap={space.sm} style={{ minHeight: 40 }}>
            <ActivityIndicator color={colors.textSecondary} />
            <Text variant="callout" color="textSecondary">
              {t('download.estimating')}
            </Text>
          </Row>
        ) : est ? (
          <>
            <Text variant="title1" tabular>
              {formatBytes(size)}
            </Text>
            <Text variant="footnote" color="textSecondary" tabular>
              {t('download.tiles', { n: formatNumber(est.plan.numAddressedTiles) })} · {t('download.free', { size: formatBytes(freeBytes()) })}
            </Text>
          </>
        ) : (
          <Row gap={space.sm} align="flex-start">
            {state.status === 'offline' ? <WifiOff size={18} color={colors.warning} /> : <AlertTriangle size={18} color={colors.warning} />}
            <Text variant="callout" color="textSecondary" style={{ flex: 1 }}>
              {state.status === 'tooLarge'
                ? t('download.tooLarge')
                : state.status === 'offline'
                  ? t('download.offline')
                  : t('download.estimateFailed', { error: state.status === 'error' ? state.message : '' })}
            </Text>
          </Row>
        )}
      </Card>

      {est && !enough ? (
        <Text variant="footnote" color="danger">
          {t('download.notEnough', { needed: formatBytes(size), free: formatBytes(freeBytes()) })}
        </Text>
      ) : null}
      {error ? (
        <Text variant="footnote" color="danger">
          {error}
        </Text>
      ) : null}

      <Button
        title={est ? t('download.action', { size: formatBytes(size) }) : t('common:actions.download')}
        disabled={!est || !enough}
        onPress={start}
        size="lg"
        fullWidth
      />
      {dateLabel ? (
        <Text variant="caption" color="textTertiary" align="center">
          {t('download.source', { date: dateLabel })}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { paddingHorizontal: space.gutter, paddingTop: space.xl, gap: space.lg },
});
