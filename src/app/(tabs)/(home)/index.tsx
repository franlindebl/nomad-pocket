import * as Network from 'expo-network';
import { router, type Href } from 'expo-router';
import {
  AlertTriangle,
  BookOpen,
  Check,
  ChevronRight,
  Download,
  HeartPulse,
  Map,
  Phone,
  Settings,
  ShieldCheck,
  Siren,
  Sparkles,
  Stethoscope,
  Users,
  Backpack,
  Wifi,
  WifiOff,
  type LucideIcon,
} from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Platform, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Card, IconBadge, IconButton, ListGroup, ListRow, ProgressBar, Row, Screen, SectionHeader, Text } from '@/components/ui';
import { useItems } from '@/features/content/items';
import { groupDownloads } from '@/features/downloads/groups';
import { useActiveDownloads } from '@/features/downloads/manager';
import { ContinueCarousel } from '@/features/home/ContinueCarousel';
import { useReadiness, type ReadinessKey } from '@/features/home/readiness';
import { callPhones } from '@/features/maps/call';
import { emergencyNumber } from '@/features/maps/emergency';
import { formatBytes } from '@/lib/format';
import { freeBytes } from '@/lib/storage';
import { useSettings } from '@/stores/settings';
import { radius, space, useTheme, type Hue } from '@/theme';

/** First-aid archives, best first: the quick action opens the first one installed. */
const FIRST_AID = ['zimgit-medicine_en', 'wikipedia_es_medicine_nopic', 'wwwnc.cdc.gov_en_all', 'irp.fas.org_en_military-medicine', 'nhs.uk_en_medicines'];

const READY_ICONS: Record<ReadinessKey, { icon: LucideIcon; hue: Hue }> = {
  map: { icon: Map, hue: 'maps' },
  guides: { icon: Stethoscope, hue: 'medicine' },
  wikipedia: { icon: BookOpen, hue: 'reference' },
  assistant: { icon: Sparkles, hue: 'ai' },
  plan: { icon: Users, hue: 'survival' },
  kit: { icon: Backpack, hue: 'survival' },
};

/** "2 descargas activas · 1 en cola": queued downloads are not counted as active. */
function downloadsLabel(downloads: { status: string }[], tc: (k: string, options?: Record<string, unknown>) => string) {
  const queued = downloads.filter((d) => d.status === 'queued').length;
  const active = downloads.length - queued;
  return [active ? tc('downloads.active', { count: active }) : '', queued ? tc('downloads.queuedCount', { count: queued }) : '']
    .filter(Boolean)
    .join(' · ');
}

function QuickAction({ icon, hue, title, onPress, testID }: { icon: LucideIcon; hue: Hue; title: string; onPress: () => void; testID: string }) {
  return (
    <Card style={styles.quick} onPress={onPress} testID={testID} accessibilityLabel={title}>
      <IconBadge icon={icon} hue={hue} size={40} />
      <Text variant="headline" numberOfLines={2}>
        {title}
      </Text>
    </Card>
  );
}

export default function HomeScreen() {
  const { t } = useTranslation('home');
  const { t: tc } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const zims = useItems('zim');
  const all = useItems();
  // A country's files count as one download.
  const downloads = groupDownloads(useActiveDownloads()).filter((d) => d.status !== 'done' && d.status !== 'failed');
  const net = Network.useNetworkState();
  const online = net.isInternetReachable ?? net.isConnected ?? true;
  const { items, done } = useReadiness();
  // Re-render when the country (and so the emergency number) changes.
  useSettings((s) => s.country);
  const number = emergencyNumber();

  const firstAid = FIRST_AID.map((id) => zims.find((z) => z.catalogId === id)).find(Boolean);
  const openFirstAid = () =>
    firstAid
      ? router.push({ pathname: '/reader/[itemId]', params: { itemId: firstAid.id } })
      : router.navigate({ pathname: '/library/category/[slug]', params: { slug: 'medicine' } });

  const used = all.reduce((sum, i) => sum + i.sizeBytes, 0);
  const missing = items.filter((i) => !i.done && i.progress === null);

  return (
    // iOS native tabs already inset the screen below the status bar.
    <Screen contentStyle={{ paddingTop: (Platform.OS === 'ios' ? 0 : insets.top) + space.lg }} contentInsetAdjustmentBehavior="never">
      <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="display">{tc('appName')}</Text>
          <Row gap={6}>
            {online ? <Wifi size={14} color={colors.textSecondary} /> : <WifiOff size={14} color={colors.success} />}
            <Text variant="footnote" color={online ? 'textSecondary' : 'success'} testID="home-network">
              {online ? t('network.online') : t('network.offline')}
            </Text>
          </Row>
        </View>
        <Row gap={space.sm}>
          <IconButton testID="open-downloads" icon={Download} accessibilityLabel={tc('downloads.title')} onPress={() => router.push('/downloads')} />
          <IconButton testID="open-settings" icon={Settings} accessibilityLabel={tc('settings:title')} onPress={() => router.push('/settings')} />
        </Row>
      </Row>

      <SectionHeader title={t('crisis.title')} style={{ marginTop: space.xl }} />
      <View style={styles.grid}>
        <QuickAction testID="home-emergency" icon={Siren} hue="medicine" title={t('crisis.nearby')} onPress={() => router.navigate('/maps/emergency')} />
        <QuickAction testID="home-first-aid" icon={HeartPulse} hue="medicine" title={t('crisis.firstAid')} onPress={openFirstAid} />
        <QuickAction testID="home-plan" icon={Users} hue="survival" title={t('crisis.plan')} onPress={() => router.push('/prepare/plan')} />
        <QuickAction testID="home-call" icon={Phone} hue="medicine" title={t('crisis.call', { number })} onPress={() => callPhones(number)} />
      </View>

      {downloads.length > 0 ? (
        <Card style={{ marginTop: space.md }} onPress={() => router.push('/downloads')} testID="home-downloads">
          <Row gap={space.md}>
            <IconBadge icon={Download} hue="survival" />
            <View style={{ flex: 1, gap: 6 }}>
              <Text variant="headline">{downloadsLabel(downloads, tc)}</Text>
              <ProgressBar
                value={downloads.reduce((s, d) => s + d.bytesWritten, 0) / Math.max(1, downloads.reduce((s, d) => s + d.totalBytes, 0))}
              />
              <Text variant="caption" color="textSecondary">
                {t('downloadsHint')}
              </Text>
            </View>
          </Row>
        </Card>
      ) : null}

      <SectionHeader title={t('ready.title')} />
      <Card style={{ gap: space.sm, marginBottom: space.md }} testID="home-readiness">
        <Row style={{ justifyContent: 'space-between' }}>
          <Row gap={space.sm}>
            <ShieldCheck size={20} color={done === items.length ? colors.success : colors.textSecondary} />
            <Text variant="headline">{t('ready.count', { done, total: items.length })}</Text>
          </Row>
          {missing.length && online ? (
            <Button title={t('ready.complete')} size="sm" variant="secondary" onPress={() => router.push('/onboarding')} />
          ) : null}
        </Row>
        <ProgressBar value={done / items.length} />
        <Text variant="footnote" color="textSecondary">
          {done === items.length ? t('ready.allDone') : online ? t('ready.hintOnline') : t('ready.hintOffline')}
        </Text>
      </Card>
      <ListGroup>
        {items.map((i) => {
          const meta = READY_ICONS[i.key];
          return (
            <ListRow
              key={i.key}
              testID={`ready-${i.key}`}
              leading={<IconBadge icon={meta.icon} hue={meta.hue} size={36} />}
              title={i.title}
              subtitle={i.detail}
              trailing={
                i.progress !== null ? (
                  <ProgressBar value={i.progress} style={{ width: 48 }} />
                ) : i.warning ? (
                  <AlertTriangle size={18} color={colors.warning} />
                ) : i.done ? (
                  <View style={[styles.check, { backgroundColor: colors.successSoft }]}>
                    <Check size={14} color={colors.success} strokeWidth={3} />
                  </View>
                ) : (
                  <ChevronRight size={18} color={colors.textTertiary} />
                )
              }
              onPress={() => router.push(i.href as Href)}
            />
          );
        })}
      </ListGroup>

      <ContinueCarousel />

      <Text variant="caption" color="textTertiary" align="center" style={{ marginTop: space.xl }} tabular>
        {t('storageLine', { used: formatBytes(used), free: formatBytes(freeBytes()) })}
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  quick: { flexBasis: '47%', flexGrow: 1, gap: space.md, minHeight: 112, justifyContent: 'space-between', borderRadius: radius.lg },
  check: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
});
