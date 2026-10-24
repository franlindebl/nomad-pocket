import { router } from 'expo-router';
import { ArrowDown, Check, Pause, Play } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Alert, StyleSheet, View } from 'react-native';

import { PressableScale, ProgressRing, Text } from '@/components/ui';
import { useContent } from '@/features/content/items';
import { NotEnoughStorageError, pauseDownload, resumeDownload, useDownload } from '@/features/downloads/manager';
import { formatBytes, formatMB } from '@/lib/format';
import { freeBytes } from '@/lib/storage';
import { useSettings } from '@/stores/settings';
import { radius, space, useTheme } from '@/theme';

import { downloadResource, OfflineError, WifiRequiredError } from './index';
import type { CatalogResource } from './types';

/** Explain a failed download start. `retry` is offered after allowing mobile data. */
export function showDownloadError(e: unknown, t: (k: string, o?: Record<string, unknown>) => string, retry?: () => void) {
  if (e instanceof NotEnoughStorageError) {
    Alert.alert(t('errors.generic'), t('storage.notEnough', { needed: formatBytes(e.needed), free: formatBytes(freeBytes()) }));
  } else if (e instanceof WifiRequiredError) {
    Alert.alert(t('library:wifiTitle'), t('library:wifiRequired'), [
      { text: t('actions.cancel'), style: 'cancel' },
      {
        text: t('library:useMobileData'),
        onPress: () => {
          useSettings.getState().setWifiOnly(false);
          retry?.();
        },
      },
    ]);
  } else if (e instanceof OfflineError) {
    Alert.alert(t('errors.generic'), t('downloads.needsConnection'));
  } else {
    Alert.alert(t('errors.generic'), String((e as Error)?.message ?? e));
  }
}

/** Start a download, explaining failures (and retrying after allowing mobile data). */
export function startResourceDownload(resource: CatalogResource, t: (k: string, o?: Record<string, unknown>) => string) {
  const go = () => {
    downloadResource(resource).catch((e) => showDownloadError(e, t, go));
  };
  go();
}

export function useResourceState(resourceId: string) {
  const installed = useContent((s) => s.items.find((i) => i.catalogId === resourceId || i.id === resourceId));
  const download = useDownload(resourceId);
  return { installed, download };
}

/**
 * Compact download control for a catalog resource:
 * size pill → progress ring (tap to pause/resume) → "Open".
 */
export function DownloadButton({ resource, onOpen }: { resource: CatalogResource; onOpen?: () => void }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { installed, download } = useResourceState(resource.id);

  if (installed) {
    return (
      <PressableScale
        testID={`download-${resource.id}`}
        haptic="light"
        accessibilityRole="button"
        onPress={onOpen ?? (() => router.push({ pathname: '/reader/[itemId]', params: { itemId: installed.id } }))}
        style={[styles.pill, { backgroundColor: colors.surfaceAlt }]}>
        <Check size={14} color={colors.success} strokeWidth={2.5} />
        <Text variant="footnote" weight="600">
          {t('actions.open')}
        </Text>
      </PressableScale>
    );
  }

  const active = download && ['queued', 'running', 'paused', 'processing'].includes(download.status);
  if (active && download) {
    const progress = download.totalBytes ? download.bytesWritten / download.totalBytes : 0;
    const paused = download.status === 'paused';
    return (
      <PressableScale
        testID={`download-${resource.id}`}
        haptic="selection"
        accessibilityRole="button"
        accessibilityLabel={paused ? t('actions.resume') : t('actions.pause')}
        onPress={() => (paused ? resumeDownload(resource.id) : pauseDownload(resource.id))}
        pressedScale={0.92}>
        <ProgressRing value={download.status === 'processing' ? 1 : progress} size={36} stroke={3}>
          {paused ? <Play size={14} color={colors.text} fill={colors.text} /> : <Pause size={14} color={colors.text} fill={colors.text} />}
        </ProgressRing>
      </PressableScale>
    );
  }

  return (
    <PressableScale
      testID={`download-${resource.id}`}
      haptic="light"
      accessibilityRole="button"
      accessibilityLabel={t('actions.downloadSize', { size: formatMB(resource.sizeMB) })}
      onPress={() => startResourceDownload(resource, t)}
      style={[styles.pill, { backgroundColor: colors.ink }]}>
      <ArrowDown size={14} color={colors.onInk} strokeWidth={2.5} />
      <Text variant="footnote" weight="600" color="onInk" tabular>
        {formatMB(resource.sizeMB)}
      </Text>
    </PressableScale>
  );
}

export function LanguageTag({ language }: { language: string }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.lang, { borderColor: colors.border }]}>
      <Text variant="caption" weight="700" color="textSecondary">
        {language.toUpperCase()}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 32,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
  },
  lang: { borderWidth: 1, borderRadius: 5, paddingHorizontal: 4, height: 18, justifyContent: 'center' },
});
