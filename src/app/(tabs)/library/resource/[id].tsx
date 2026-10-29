import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';

import { Badge, Button, IconBadge, ProgressBar, Row, Text } from '@/components/ui';
import { getResource, loc } from '@/features/catalog';
import { startResourceDownload, useResourceState } from '@/features/catalog/DownloadButton';
import { categoryHue, categoryIcon } from '@/features/catalog/icons';
import { removeItem } from '@/features/content/items';
import { shareArchive } from '@/features/library/share';
import { cancelDownload, pauseDownload, resumeDownload } from '@/features/downloads/manager';
import { formatBytes, formatMB } from '@/lib/format';
import { layout, space } from '@/theme';

export default function ResourceSheet() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation('library');
  const { t: tc } = useTranslation();
  const resource = getResource(id);
  const { installed, download } = useResourceState(id);
  if (!resource) return null;

  const active = download && ['queued', 'running', 'paused', 'processing'].includes(download.status);
  const progress = download?.totalBytes ? download.bytesWritten / download.totalBytes : 0;

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Row gap={space.md}>
        <IconBadge icon={categoryIcon(resource.category)} hue={categoryHue(resource.category)} size={56} />
        <View style={{ flex: 1, gap: 4 }}>
          <Text variant="title2">{loc(resource.title)}</Text>
          <Row gap={6}>
            <Badge label={tc(`language.${resource.language}`)} />
            <Badge label={formatMB(resource.sizeMB)} />
            {installed ? <Badge label={tc('status.installed')} tone="success" /> : null}
          </Row>
        </View>
      </Row>
      <Text variant="body" color="textSecondary">
        {loc(resource.description)}
      </Text>
      {resource.medical ? (
        <Text variant="footnote" color="warning">
          {tc('health.disclaimer')}
        </Text>
      ) : null}
      <Text variant="caption" color="textTertiary">
        {t('version', { version: installed?.version ?? resource.version })} · {resource.id}
      </Text>

      {active && download ? (
        <View style={{ gap: space.sm }}>
          <ProgressBar value={progress} />
          <Text variant="caption" color="textSecondary" tabular>
            {tc(`status.${download.status}`)} · {formatBytes(download.bytesWritten)} / {formatBytes(download.totalBytes)}
          </Text>
          <Row>
            {download.status === 'paused' ? (
              <Button title={tc('actions.resume')} variant="secondary" onPress={() => resumeDownload(id)} />
            ) : (
              <Button title={tc('actions.pause')} variant="secondary" onPress={() => pauseDownload(id)} />
            )}
            {download.status !== 'processing' ? (
              <Button title={tc('actions.cancel')} variant="ghost" onPress={() => cancelDownload(id)} />
            ) : null}
          </Row>
        </View>
      ) : installed ? (
        <Row>
          <Button
            title={tc('actions.open')}
            onPress={() => {
              router.back();
              router.push({ pathname: '/reader/[itemId]', params: { itemId: installed.id } });
            }}
            style={{ flex: 1 }}
          />
          <Button
            title={t('share')}
            variant="secondary"
            onPress={() => shareArchive(installed).catch((e) => Alert.alert(t('shareFailed'), String((e as Error)?.message ?? e)))}
          />
          <Button
            title={tc('actions.delete')}
            variant="danger"
            onPress={() =>
              Alert.alert(installed.title, tc('settings:deleteConfirm', { title: installed.title, size: formatBytes(installed.sizeBytes) }), [
                { text: tc('actions.cancel'), style: 'cancel' },
                { text: tc('actions.delete'), style: 'destructive', onPress: () => removeItem(installed.id) },
              ])
            }
          />
        </Row>
      ) : (
        <Button
          title={tc('actions.downloadSize', { size: formatMB(resource.sizeMB) })}
          size="lg"
          fullWidth
          onPress={() => startResourceDownload(resource, tc)}
        />
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { ...layout.column, padding: space.xxl, gap: space.lg },
});
