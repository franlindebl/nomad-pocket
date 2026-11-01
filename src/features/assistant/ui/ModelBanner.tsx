// Shown over the composer while no model is ready: the chat still answers vital questions with the emergency
// guide's cards (chats.ts), and this recommends the model that fits the device, downloadable from right here.
import * as Device from 'expo-device';
import { router } from 'expo-router';
import { ArrowDown, Cpu } from 'lucide-react-native';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, StyleSheet, View } from 'react-native';

import { Button, IconBadge, ProgressBar, Row, Text } from '@/components/ui';
import { formatPercent } from '@/features/assistant/format';
import { ramGB, recommendModel, SYSTEM_MODEL_ID } from '@/features/assistant/models';
import { downloadModel, OfflineError } from '@/features/assistant/register';
import { NotEnoughStorageError, useDownload } from '@/features/downloads/manager';
import { formatBytes } from '@/lib/format';
import { freeBytes } from '@/lib/storage';
import { useSettings } from '@/stores/settings';
import { radius, space, useTheme } from '@/theme';

/** Alert for a model download that couldn't start (no room, no connection…). */
export function showDownloadError(e: unknown, t: (k: string, o?: Record<string, unknown>) => string) {
  if (e instanceof NotEnoughStorageError) {
    Alert.alert(t('errors.generic'), t('storage.notEnough', { needed: formatBytes(e.needed), free: formatBytes(freeBytes()) }));
  } else if (e instanceof OfflineError) {
    Alert.alert(t('errors.generic'), t('downloads.needsConnection'));
  } else {
    Alert.alert(t('errors.generic'), String((e as Error)?.message ?? e));
  }
}

export function ModelBanner({ systemAvailable }: { systemAvailable: boolean }) {
  const { t } = useTranslation('assistant');
  const { t: tc } = useTranslation();
  const { colors } = useTheme();
  const setAiModelId = useSettings((s) => s.setAiModelId);
  const model = useMemo(() => recommendModel(ramGB(Device.totalMemory)), []);
  const download = useDownload(model.id);
  const downloading = download && ['queued', 'running', 'paused', 'processing'].includes(download.status);
  const progress = download?.status === 'processing' ? 1 : download?.totalBytes ? download.bytesWritten / download.totalBytes : 0;

  return (
    <View style={[styles.banner, { backgroundColor: colors.surface, borderColor: colors.border }]} testID="assistant-model-banner">
      <Row gap={space.md} align="flex-start">
        <IconBadge icon={Cpu} hue="ai" size={32} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="headline">
            {downloading ? t('modelBanner.downloading', { name: model.name }) : t('modelBanner.title', { name: model.name })}
          </Text>
          <Text variant="footnote" color="textSecondary">
            {t('modelBanner.body')}
          </Text>
        </View>
      </Row>
      {downloading && download ? (
        <View style={{ gap: space.xs }}>
          <ProgressBar value={progress} color={download.status === 'paused' ? colors.textTertiary : undefined} />
          <Row style={{ justifyContent: 'space-between' }}>
            <Text variant="caption" color="textSecondary" tabular>
              {download.status === 'running' ? formatPercent(progress) : tc(`status.${download.status}`)}
            </Text>
            <Button title={t('modelBanner.details')} variant="ghost" size="sm" onPress={() => router.push('/assistant/models')} />
          </Row>
        </View>
      ) : (
        <Row gap={space.sm} style={{ flexWrap: 'wrap' }}>
          <Button
            title={tc('actions.downloadSize', { size: formatBytes(model.sizeBytes) })}
            icon={ArrowDown}
            size="sm"
            onPress={() => downloadModel(model).catch((e) => showDownloadError(e, tc))}
          />
          {systemAvailable ? (
            <Button title={t('noModel.useSystem')} variant="secondary" size="sm" onPress={() => setAiModelId(SYSTEM_MODEL_ID)} />
          ) : (
            <Button title={t('modelBanner.others')} variant="secondary" size="sm" onPress={() => router.push('/assistant/models')} />
          )}
        </Row>
      )}
      {download?.status === 'failed' ? (
        <Text variant="caption" color="danger">
          {tc('status.failed')}
          {download.error ? ` · ${download.error}` : ''}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    gap: space.md,
    padding: space.md,
    marginBottom: space.sm,
    borderRadius: radius.lg,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
  },
});
