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
  RefreshCw,
  Settings,
  Siren,
  MessageSquareText,
  Stethoscope,
  Tent,
  Users,
  Backpack,
  type LucideIcon,
} from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Platform, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, Line, Pattern, Rect } from 'react-native-svg';

import {
  Button,
  Card,
  ChamferFill,
  IconBadge,
  IconButton,
  ListGroup,
  ListRow,
  PressableScale,
  ProgressBar,
  Row,
  Screen,
  SectionHeader,
  Text,
} from '@/components/ui';
import { searchIndexBytes } from '@/db';
import { useItems } from '@/features/content/items';
import { groupDownloads } from '@/features/downloads/groups';
import { useActiveDownloads } from '@/features/downloads/manager';
import { ContinueCarousel } from '@/features/home/ContinueCarousel';
import { useReadiness, type ReadinessKey } from '@/features/home/readiness';
import { callPhones } from '@/features/maps/call';
import { usePreparingCountries } from '@/features/maps/countries';
import { useEmergencyNumber } from '@/features/maps/emergency';
import { useUpdates } from '@/features/updates/updates';
import { formatBytes } from '@/lib/format';
import { HEALTH_FEATURES } from '@/lib/health';
import { freeBytes } from '@/lib/storage';
import { chamfer, displayFamily, space, useTheme, type Hue } from '@/theme';

const READY_ICONS: Record<ReadinessKey, { icon: LucideIcon; hue: Hue }> = {
  map: { icon: Map, hue: 'maps' },
  guides: HEALTH_FEATURES ? { icon: Stethoscope, hue: 'medicine' } : { icon: Tent, hue: 'survival' },
  wikipedia: { icon: BookOpen, hue: 'reference' },
  assistant: { icon: MessageSquareText, hue: 'ai' },
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

function QuickAction({ icon: Icon, title, onPress, testID }: { icon: LucideIcon; title: string; onPress: () => void; testID: string }) {
  const { colors } = useTheme();
  return (
    <Card style={styles.quick} onPress={onPress} testID={testID} accessibilityLabel={title} padded={false}>
      <Icon size={22} color={colors.accent} strokeWidth={1.9} />
      <Text variant="footnote" weight="600" numberOfLines={3}>
        {title}
      </Text>
    </Card>
  );
}

/** The emergency number as the screen's one big signal-yellow block: cut corner, faint diagonal hatch. */
function CallBlock({ number, label, accessibilityLabel, onPress }: { number: string; label: string; accessibilityLabel: string; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <PressableScale testID="home-call" accessibilityRole="button" accessibilityLabel={accessibilityLabel} onPress={onPress} haptic="medium" style={styles.call}>
      <ChamferFill color={colors.accent} cut={chamfer.lg} />
      <View style={styles.hatch} pointerEvents="none">
        <Svg width="100%" height="100%">
          <Defs>
            <Pattern id="call-hatch" width={7} height={7} patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
              <Line x1={0} y1={0} x2={0} y2={7} stroke={colors.onAccent} strokeOpacity={0.12} strokeWidth={1} />
            </Pattern>
          </Defs>
          <Rect width="100%" height="100%" fill="url(#call-hatch)" />
        </Svg>
      </View>
      <View style={{ flex: 1, gap: space.xs }}>
        <Text color="onAccent" style={styles.callNumber} numberOfLines={1} adjustsFontSizeToFit>
          {number}
        </Text>
        <Text variant="headline" color="onAccent" numberOfLines={2}>
          {label}
        </Text>
      </View>
      <View style={styles.callGo}>
        <ChamferFill color={colors.onAccent} cut={chamfer.sm} />
        <Phone size={20} color={colors.accent} strokeWidth={2.2} />
      </View>
    </PressableScale>
  );
}

export default function HomeScreen() {
  const { t, i18n } = useTranslation('home');
  const { t: tc } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const all = useItems();
  // A country's files count as one download.
  const downloads = groupDownloads(useActiveDownloads()).filter((d) => d.status !== 'done' && d.status !== 'failed');
  // A downloaded country is still being prepared (search, emergency points): the end of its download.
  const preparing = usePreparingCountries();
  const net = Network.useNetworkState();
  const online = net.isInternetReachable ?? net.isConnected ?? true;
  const { items, done } = useReadiness();
  // Old data with a newer version (or a routing pack this app can't read): worth a card while online.
  const urgent = useUpdates().filter((u) => u.urgent && !u.inFlight);
  const emergency = useEmergencyNumber();
  const { number } = emergency;

  // Same total as Settings: the map search index counts too.
  const used = all.reduce((sum, i) => sum + i.sizeBytes, 0) + searchIndexBytes();
  const missing = items.filter((i) => !i.done && i.progress === null);

  return (
    // iOS native tabs already inset the screen below the status bar.
    <Screen contentStyle={{ paddingTop: (Platform.OS === 'ios' ? 0 : insets.top) + space.lg }} contentInsetAdjustmentBehavior="never">
      <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View style={{ flex: 1, gap: space.sm }}>
          <Text variant="display">{tc('appName')}</Text>
          <Row gap={6}>
            <View style={[styles.netMark, { backgroundColor: online ? colors.textSecondary : colors.accent }]} />
            <Text variant="overline" color={online ? 'textSecondary' : 'accent'} testID="home-network">
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
      <CallBlock
        number={number}
        label={emergency.for === 'ambulance' ? t('crisis.callLabelAmbulance') : emergency.for === 'police' ? t('crisis.callLabelPolice') : t('crisis.callLabel')}
        accessibilityLabel={
          emergency.for === 'ambulance'
            ? t('crisis.callAmbulance', { number })
            : emergency.for === 'police'
              ? t('crisis.callPolice', { number })
              : t('crisis.call', { number })
        }
        onPress={() => callPhones(number)}
      />
      <View style={styles.grid}>
        <QuickAction testID="home-emergency" icon={Siren} title={t('crisis.nearby')} onPress={() => router.navigate('/maps/emergency')} />
        {HEALTH_FEATURES ? (
          <QuickAction testID="home-first-aid" icon={HeartPulse} title={t('crisis.firstAid')} onPress={() => router.push('/guide')} />
        ) : (
          <QuickAction
            testID="home-guides"
            icon={Tent}
            title={t('crisis.guides')}
            onPress={() => router.navigate({ pathname: '/library/category/[slug]', params: { slug: 'survival' } })}
          />
        )}
        <QuickAction testID="home-plan" icon={Users} title={t('crisis.plan')} onPress={() => router.push('/prepare/plan')} />
      </View>

      {downloads.length > 0 || preparing.length > 0 ? (
        <Card style={{ marginTop: space.md }} onPress={() => router.push('/downloads')} testID="home-downloads">
          <Row gap={space.md}>
            <IconBadge icon={Download} hue="survival" />
            <View style={{ flex: 1, gap: 6 }}>
              <Text variant="headline">
                {downloads.length ? downloadsLabel(downloads, tc) : tc('downloads.preparingTitle', { name: preparing.map((c) => c.title).join(', ') })}
              </Text>
              <ProgressBar
                value={
                  downloads.length
                    ? downloads.reduce((s, d) => s + d.bytesWritten, 0) / Math.max(1, downloads.reduce((s, d) => s + d.totalBytes, 0))
                    : (preparing[0]?.preparing ?? 0)
                }
              />
              <Text variant="caption" color="textSecondary">
                {t('downloadsHint')}
              </Text>
            </View>
          </Row>
        </Card>
      ) : null}

      {urgent.length && online ? (
        <Card style={{ marginTop: space.md }} onPress={() => router.push('/updates')} testID="home-updates">
          <Row gap={space.md} align="flex-start">
            <IconBadge icon={RefreshCw} hue="survival" />
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="headline">{tc('updates:homeTitle', { count: urgent.length })}</Text>
              <Text variant="footnote" color="textSecondary">
                {tc('updates:homeBody')}
              </Text>
            </View>
            <ChevronRight size={18} color={colors.textTertiary} />
          </Row>
        </Card>
      ) : null}

      <SectionHeader title={t('ready.title')} />
      <Card style={{ gap: space.md, marginBottom: space.md }} testID="home-readiness">
        <Row style={{ justifyContent: 'space-between' }}>
          <Row gap={space.sm} align="baseline" style={{ flexShrink: 1 }}>
            <Text style={styles.readyFigure} accessibilityLabel={t('ready.count', { done, total: items.length })} tabular>
              {done}
              <Text style={styles.readyFigure} color="faint">
                /
              </Text>
              {items.length}
            </Text>
            <Text variant="overline" color="textSecondary" numberOfLines={1} style={{ flexShrink: 1 }}>
              {t('ready.label')}
            </Text>
          </Row>
          {missing.length && online ? <Button title={t('ready.complete')} size="sm" onPress={() => router.push('/onboarding')} /> : null}
        </Row>
        <ProgressBar value={done / items.length} segments={items.length} />
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
                  <View style={[styles.check, { backgroundColor: colors.accent }]}>
                    <Check size={13} color={colors.onAccent} strokeWidth={3} />
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
        {t('storageLine', { used: formatBytes(used, undefined, i18n.language), free: formatBytes(freeBytes(), undefined, i18n.language) })}
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  netMark: { width: 6, height: 6 },
  call: { flexDirection: 'row', alignItems: 'flex-end', gap: space.md, padding: space.lg, minHeight: 112, overflow: 'hidden' },
  hatch: { position: 'absolute', top: 0, right: 0, bottom: 0, width: '42%' },
  callNumber: { fontFamily: displayFamily, fontWeight: '700', fontSize: 48, lineHeight: 50 },
  callGo: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  grid: { flexDirection: 'row', gap: space.sm, marginTop: space.sm },
  quick: { flex: 1, minHeight: 96, padding: space.md, gap: space.md, justifyContent: 'space-between' },
  readyFigure: { fontFamily: displayFamily, fontWeight: '700', fontSize: 30, lineHeight: 34 },
  check: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center' },
});
