import { Download, WifiOff } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';

import { Platform, View } from 'react-native';

import { Button, Card, EmptyState, ListGroup, Row, Screen, Text } from '@/components/ui';
import { DownloadRow } from '@/features/downloads/DownloadRow';
import { groupDownloads } from '@/features/downloads/groups';
import { keepsAwake } from '@/features/downloads/keep-awake';
import { allowMobileData, useActiveDownloads, useDownloads, waitingReason } from '@/features/downloads/manager';
import { usePreparingCountries } from '@/features/maps/countries';
import { PreparingCountries } from '@/features/maps/PreparingCountries';
import { useSettings } from '@/stores/settings';
import { space, useTheme } from '@/theme';

export default function DownloadsScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const downloads = groupDownloads(useActiveDownloads());
  const network = useDownloads((s) => s.network);
  const records = useDownloads((s) => s.records);
  const wifiOnly = useSettings((s) => s.wifiOnly);
  const rows = downloads.map((d) => ({ entry: d, waiting: waitingReason(d.records, network, wifiOnly) }));
  const waitingForWifi = rows.filter((r) => r.entry.status === 'queued' && r.waiting === 'wifi');
  // Downloaded countries still being prepared: the last step of their download.
  const preparing = usePreparingCountries();
  return (
    <Screen contentStyle={{ paddingTop: space.lg }}>
      {/* Android form sheets have no native header. */}
      {Platform.OS === 'android' ? (
        <Text variant="title2" style={{ marginBottom: space.lg }}>
          {t('downloads.title')}
        </Text>
      ) : null}
      {waitingForWifi.length > 1 ? (
        <Card style={{ marginBottom: space.lg, gap: space.md }} testID="downloads-waiting-wifi">
          <Row gap={space.sm} align="flex-start">
            <WifiOff size={18} color={colors.textSecondary} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="headline">{t('downloads.waiting.wifi')}</Text>
              <Text variant="footnote" color="textSecondary">
                {t('downloads.wifi.bodyMany', { count: waitingForWifi.length })}
              </Text>
            </View>
          </Row>
          {/* Mobile data for these downloads only: the "Wi-Fi only" setting stays on. */}
          <Button
            testID="downloads-allow-cellular-all"
            title={t('downloads.wifi.useMobileDataAll')}
            size="sm"
            variant="secondary"
            onPress={() => allowMobileData(waitingForWifi.flatMap((r) => r.entry.records.map((x) => x.id)))}
          />
        </Card>
      ) : null}
      {downloads.length === 0 && preparing.length === 0 ? (
        <EmptyState icon={Download} hue="survival" title={t('downloads.empty')} body={t('downloads.emptyBody')} />
      ) : downloads.length ? (
        <ListGroup>
          {rows.map(({ entry, waiting }) => (
            <DownloadRow key={entry.id} entry={entry} waiting={waiting} />
          ))}
        </ListGroup>
      ) : null}
      <PreparingCountries countries={preparing} style={downloads.length ? { marginTop: space.md } : undefined} />
      {keepsAwake(records) ? (
        <Text variant="footnote" color="textSecondary" style={{ marginTop: space.md }} testID="downloads-keep-awake">
          {t('downloads.keepAwake')}
        </Text>
      ) : null}
    </Screen>
  );
}
