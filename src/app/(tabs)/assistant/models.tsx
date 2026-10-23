import * as Device from 'expo-device';
import { ArrowDown, Check, Cpu, Pause, Play, ShieldCheck, Sparkles, Trash2, X } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Platform, StyleSheet, View } from 'react-native';

import { Badge, Button, Card, IconBadge, IconButton, ProgressBar, Row, Screen, SectionHeader, Text } from '@/components/ui';
import { GGUF_MODELS, modelFit, ramGB, recommendModel, SYSTEM_MODEL_ID, type GgufModel } from '@/features/assistant/models';
import { downloadModel, OfflineError, WifiRequiredError } from '@/features/assistant/register';
import { useSystemModel } from '@/features/assistant/system';
import { removeItem, useItems } from '@/features/content/items';
import { cancelDownload, NotEnoughStorageError, pauseDownload, resumeDownload, useDownload } from '@/features/downloads/manager';
import { formatPercent } from '@/features/assistant/format';
import { formatBytes } from '@/lib/format';
import { freeBytes } from '@/lib/storage';
import { useSettings } from '@/stores/settings';
import { space, useTheme } from '@/theme';

import { downloadSystemModel } from '../../../../modules/nomad-llm';

export default function ModelsScreen() {
  const { t } = useTranslation('assistant');
  const ram = useMemo(() => ramGB(Device.totalMemory), []);
  const recommended = useMemo(() => recommendModel(ram), [ram]);
  const refresh = useSystemModel((s) => s.refresh);

  useEffect(() => {
    refresh().catch(() => {});
  }, [refresh]);

  return (
    <Screen>
      <DeviceCard ram={ram} />

      <SectionHeader title={t('models.system')} />
      <SystemModelCard />

      <SectionHeader title={t('models.downloadable')} />
      <Text variant="footnote" color="textSecondary" style={styles.lead}>
        {t('models.downloadableBody')}
      </Text>
      <View style={{ gap: space.md }}>
        {GGUF_MODELS.map((m) => (
          <ModelCard key={m.id} model={m} ram={ram} recommended={m.id === recommended.id} />
        ))}
      </View>

      <Row gap={space.sm} style={styles.privacy} align="flex-start">
        <ShieldCheck size={16} color={useTheme().colors.textSecondary} />
        <Text variant="caption" color="textSecondary" style={{ flex: 1 }}>
          {t('models.privacy')}
        </Text>
      </Row>
    </Screen>
  );
}

function DeviceCard({ ram }: { ram: number | null }) {
  const { t } = useTranslation('assistant');
  const name = Device.modelName ?? Device.deviceName ?? Platform.OS;
  return (
    <Card style={styles.device}>
      <IconBadge icon={Cpu} hue="neutral" size={44} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="overline" color="textSecondary">
          {t('models.device')}
        </Text>
        <Text variant="headline" numberOfLines={1}>
          {name}
        </Text>
        <Text variant="footnote" color="textSecondary" tabular>
          {ram ? t('models.deviceRam', { ram }) : t('models.deviceRamUnknown')} · {t('models.free', { size: formatBytes(freeBytes()) })}
        </Text>
      </View>
    </Card>
  );
}

function SystemModelCard() {
  const { t } = useTranslation('assistant');
  const info = useSystemModel((s) => s.info);
  const refresh = useSystemModel((s) => s.refresh);
  const { aiModelId, setAiModelId } = useSettings();
  const [progress, setProgress] = useState<number | null>(null);
  const active = aiModelId === SYSTEM_MODEL_ID;
  const status = info?.status;
  const provider = info?.provider ? t(`models.systemProvider.${info.provider}`) : Platform.OS === 'ios' ? t('models.systemProvider.apple') : t('models.systemProvider.gemini');

  const startDownload = async () => {
    setProgress(0);
    try {
      await downloadSystemModel((done, total) => setProgress(total > 0 ? done / total : 0));
    } catch (e) {
      Alert.alert(t('common:errors.generic'), String((e as Error)?.message ?? e));
    } finally {
      setProgress(null);
      refresh().catch(() => {});
    }
  };

  return (
    <Card style={{ gap: space.md }}>
      <Row gap={space.md} align="flex-start">
        <IconBadge icon={Sparkles} hue="ai" size={44} />
        <View style={{ flex: 1, gap: 4 }}>
          <Row gap={space.sm} style={{ flexWrap: 'wrap' }}>
            <Text variant="headline">{provider}</Text>
            {active && status === 'available' ? <Badge label={t('models.active')} tone="success" icon={Check} /> : null}
          </Row>
          <Text variant="footnote" color="textSecondary">
            {t(`models.systemStatus.${status ?? 'checking'}`)}
          </Text>
        </View>
      </Row>
      {status === 'available' && !active ? <Button title={t('models.use')} size="sm" onPress={() => setAiModelId(SYSTEM_MODEL_ID)} style={styles.action} /> : null}
      {status === 'downloadable' ? (
        progress != null ? (
          <ProgressBar value={progress} />
        ) : (
          <Button title={t('models.downloadSystem')} icon={ArrowDown} size="sm" variant="secondary" onPress={startDownload} style={styles.action} />
        )
      ) : null}
    </Card>
  );
}

function showError(e: unknown, t: (k: string, o?: Record<string, unknown>) => string) {
  if (e instanceof NotEnoughStorageError) {
    Alert.alert(t('errors.generic'), t('storage.notEnough', { needed: formatBytes(e.needed), free: formatBytes(freeBytes()) }));
  } else if (e instanceof WifiRequiredError) {
    Alert.alert(t('errors.generic'), t('library:wifiRequired'));
  } else if (e instanceof OfflineError) {
    Alert.alert(t('errors.generic'), t('downloads.needsConnection'));
  } else {
    Alert.alert(t('errors.generic'), String((e as Error)?.message ?? e));
  }
}

function ModelCard({ model, ram, recommended }: { model: GgufModel; ram: number | null; recommended: boolean }) {
  const { t } = useTranslation('assistant');
  const { t: tc } = useTranslation();
  const { colors } = useTheme();
  const installed = useItems('model').find((i) => i.id === model.id);
  const download = useDownload(model.id);
  const { aiModelId, setAiModelId } = useSettings();
  const active = aiModelId === model.id;
  const fit = modelFit(model, ram);
  const downloading = download && ['queued', 'running', 'paused', 'processing'].includes(download.status);

  const fitBadge =
    fit === 'good' ? (
      <Badge label={t('models.fitGood')} tone="success" />
    ) : fit === 'tight' ? (
      <Badge label={t('models.fitTight')} tone="warning" />
    ) : (
      <Badge label={t('models.fitTooBig', { ram: model.minRamGB })} tone="danger" />
    );

  const confirmDelete = () =>
    Alert.alert(t('models.delete'), t('models.deleteConfirm', { title: model.name, size: formatBytes(model.sizeBytes) }), [
      { text: tc('actions.cancel'), style: 'cancel' },
      { text: tc('actions.delete'), style: 'destructive', onPress: () => removeItem(model.id) },
    ]);

  return (
    <Card style={[{ gap: space.md }, active && { borderColor: colors.accent, borderWidth: 1.5 }]}>
      <View style={{ gap: 6 }}>
        <Row gap={space.sm} style={[{ flexWrap: 'wrap' }, installed && active && { paddingRight: 36 }]}>
          <Text variant="title3">{model.name}</Text>
          {recommended ? <Badge label={t('models.recommended')} tone="accent" icon={Sparkles} /> : null}
          {active ? <Badge label={t('models.active')} tone="success" icon={Check} /> : null}
        </Row>
        <Text variant="footnote" color="textSecondary">
          {t(`models.blurb.${model.blurbKey}`)}
        </Text>
        <Row gap={space.sm} style={{ flexWrap: 'wrap', marginTop: 2 }}>
          {installed ? <Badge label={tc('status.installed')} tone="neutral" icon={Check} /> : fitBadge}
          <Text variant="caption" color="textTertiary" tabular>
            {formatBytes(model.sizeBytes)} · {t('models.ramNeeded', { ram: model.minRamGB })} · {model.quant} · {model.license}
          </Text>
        </Row>
      </View>
      {installed && active ? (
        <IconButton icon={Trash2} size={34} variant="plain" color={colors.textSecondary} accessibilityLabel={t('models.delete')} onPress={confirmDelete} style={styles.cornerDelete} />
      ) : null}

      {downloading && download ? (
        <View style={{ gap: space.sm }}>
          <ProgressBar value={download.status === 'processing' ? 1 : download.totalBytes ? download.bytesWritten / download.totalBytes : 0} color={download.status === 'paused' ? colors.textTertiary : undefined} />
          <Row style={{ justifyContent: 'space-between' }}>
            <Text variant="caption" color="textSecondary" tabular>
              {download.status === 'running'
                ? `${formatPercent(download.totalBytes ? download.bytesWritten / download.totalBytes : 0)} · ${formatBytes(download.bytesWritten)} / ${formatBytes(download.totalBytes)}`
                : tc(`status.${download.status}`)}
            </Text>
            <Row gap={space.xs}>
              {download.status === 'paused' ? (
                <IconButton icon={Play} size={32} accessibilityLabel={tc('actions.resume')} onPress={() => resumeDownload(model.id)} />
              ) : download.status !== 'processing' ? (
                <IconButton icon={Pause} size={32} accessibilityLabel={tc('actions.pause')} onPress={() => pauseDownload(model.id)} />
              ) : null}
              {download.status !== 'processing' ? (
                <IconButton icon={X} size={32} accessibilityLabel={tc('actions.cancel')} onPress={() => cancelDownload(model.id)} />
              ) : null}
            </Row>
          </Row>
        </View>
      ) : installed && !active ? (
        <Row gap={space.sm}>
          {!active ? <Button title={t('models.use')} size="sm" onPress={() => setAiModelId(model.id)} /> : null}
          <View style={{ flex: 1 }} />
          <IconButton icon={Trash2} size={34} variant="plain" color={colors.textSecondary} accessibilityLabel={t('models.delete')} onPress={confirmDelete} />
        </Row>
      ) : installed ? null : (
        <Button
          title={tc('actions.downloadSize', { size: formatBytes(model.sizeBytes) })}
          icon={ArrowDown}
          size="sm"
          variant={recommended ? 'primary' : 'secondary'}
          onPress={() => downloadModel(model).catch((e) => showError(e, tc))}
          style={styles.action}
        />
      )}
      {download?.status === 'failed' ? (
        <Text variant="caption" color="danger">
          {tc('status.failed')}
          {download.error ? ` · ${download.error}` : ''}
        </Text>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  device: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  lead: { marginBottom: space.md, paddingHorizontal: space.xs },
  action: { alignSelf: 'flex-start' },
  privacy: { marginTop: space.xxl, paddingHorizontal: space.xs },
  cornerDelete: { position: 'absolute', right: space.sm, top: space.sm },
});
