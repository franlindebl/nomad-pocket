import { AlertCircle, Check, Pause, Play, RotateCw, X } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { IconButton, ProgressBar, Row, Text } from '@/components/ui';
import { formatBytes, formatDuration } from '@/lib/format';
import { space, useTheme } from '@/theme';

import { cancelDownload, dismissDownload, pauseDownload, resumeDownload, type DownloadRecord } from './manager';

export function DownloadRow({ record }: { record: DownloadRecord }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { status, bytesWritten, totalBytes, speed } = record;
  const progress = totalBytes > 0 ? bytesWritten / totalBytes : 0;
  const eta = speed && speed > 0 && totalBytes > 0 ? (totalBytes - bytesWritten) / speed : 0;

  let detail = `${formatBytes(bytesWritten)} / ${formatBytes(totalBytes)}`;
  if (status === 'running' && eta) detail += ` · ${t('downloads.eta', { time: formatDuration(eta) })}`;
  if (status !== 'running') detail = `${t(`status.${status}`)} · ${detail}`;
  if (status === 'failed' && record.error) {
    // Known error codes get a translated message; anything else is shown as reported.
    const message = record.error === 'NOT_ENOUGH_STORAGE' ? t('storage.notEnoughShort') : record.error;
    detail = `${t('status.failed')} · ${message}`;
  }

  return (
    <View style={styles.row}>
      <View style={{ flex: 1, gap: 6 }}>
        <Text variant="headline" numberOfLines={1}>
          {record.title}
        </Text>
        <ProgressBar
          value={status === 'done' ? 1 : progress}
          color={status === 'failed' ? colors.danger : status === 'done' ? colors.success : status === 'paused' ? colors.textTertiary : undefined}
        />
        <Text variant="caption" color={status === 'failed' ? 'danger' : 'textSecondary'} numberOfLines={2} tabular>
          {detail}
        </Text>
      </View>
      <Row gap={space.xs}>
        {status === 'running' && !record.external ? (
          <IconButton icon={Pause} size={36} accessibilityLabel={t('actions.pause')} onPress={() => pauseDownload(record.id)} />
        ) : null}
        {status === 'paused' ? (
          <IconButton icon={Play} size={36} accessibilityLabel={t('actions.resume')} onPress={() => resumeDownload(record.id)} />
        ) : null}
        {status === 'failed' && !record.external ? (
          <IconButton icon={RotateCw} size={36} accessibilityLabel={t('actions.retry')} onPress={() => resumeDownload(record.id)} />
        ) : null}
        {status === 'done' ? <IconButton icon={Check} size={36} variant="plain" color={colors.success} accessibilityLabel={t('status.done')} /> : null}
        {status === 'failed' && record.external ? (
          <IconButton icon={AlertCircle} size={36} accessibilityLabel={t('actions.close')} onPress={() => dismissDownload(record.id)} />
        ) : null}
        {status !== 'done' && status !== 'processing' ? (
          <IconButton icon={X} size={36} accessibilityLabel={t('actions.cancel')} onPress={() => (status === 'failed' ? dismissDownload(record.id) : cancelDownload(record.id))} />
        ) : null}
      </Row>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg },
});
