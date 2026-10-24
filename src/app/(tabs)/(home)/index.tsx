import { router, type Href } from 'expo-router';
import { BookOpen, Download, GraduationCap, HardDrive, Map, Settings, Sparkles, type LucideIcon } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Platform, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Card, IconBadge, IconButton, ProgressBar, Row, Screen, SectionHeader, Text } from '@/components/ui';
import { ContinueCarousel } from '@/features/home/ContinueCarousel';
import { useItems } from '@/features/content/items';
import { useActiveDownloads } from '@/features/downloads/manager';
import { formatBytes } from '@/lib/format';
import { freeBytes, totalBytes } from '@/lib/storage';
import { radius, space, useTheme, type Hue } from '@/theme';

function greetingKey() {
  const h = new Date().getHours();
  return h < 13 ? 'morning' : h < 20 ? 'afternoon' : 'evening';
}

type Module = { key: 'library' | 'maps' | 'courses' | 'assistant'; icon: LucideIcon; hue: Hue; href: Href };

const MODULES: Module[] = [
  { key: 'library', icon: BookOpen, hue: 'reference', href: '/library' },
  { key: 'maps', icon: Map, hue: 'maps', href: '/maps' },
  { key: 'courses', icon: GraduationCap, hue: 'education', href: '/courses' },
  { key: 'assistant', icon: Sparkles, hue: 'ai', href: '/assistant' },
];

/** "2 descargas activas · 1 en cola": queued downloads are not counted as active. */
function downloadsLabel(downloads: { status: string }[], tc: (key: string, options?: Record<string, unknown>) => string) {
  const queued = downloads.filter((d) => d.status === 'queued').length;
  const active = downloads.length - queued;
  return [active ? tc('downloads.active', { count: active }) : '', queued ? tc('downloads.queuedCount', { count: queued }) : '']
    .filter(Boolean)
    .join(' · ');
}

export default function HomeScreen() {
  const { t } = useTranslation('home');
  const { t: tc } = useTranslation();
  const { colors, scheme } = useTheme();
  // The hero is ink on paper in light mode; in dark mode a raised surface instead of a white slab.
  const heroBg = scheme === 'dark' ? colors.surfaceAlt : colors.ink;
  const heroFg = scheme === 'dark' ? 'text' : 'onInk';
  const heroFgColor = colors[heroFg];
  const insets = useSafeAreaInsets();
  const items = useItems();
  const downloads = useActiveDownloads();
  const used = items.reduce((sum, i) => sum + i.sizeBytes, 0);
  const free = freeBytes();
  const total = totalBytes();

  return (
    // iOS native tabs already inset the screen below the status bar.
    <Screen contentStyle={{ paddingTop: (Platform.OS === 'ios' ? 0 : insets.top) + space.lg }} contentInsetAdjustmentBehavior="never">
      <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View style={{ flex: 1 }}>
          <Text variant="footnote" color="textSecondary">
            {t(`greeting.${greetingKey()}`)}
          </Text>
          <Text variant="display">{tc('appName')}</Text>
        </View>
        <Row gap={space.sm}>
          <IconButton testID="open-downloads" icon={Download} accessibilityLabel={tc('downloads.title')} onPress={() => router.push('/downloads')} />
          <IconButton testID="open-settings" icon={Settings} accessibilityLabel={tc('settings:title')} onPress={() => router.push('/settings')} />
        </Row>
      </Row>

      <Card style={styles.hero} background={heroBg} padded={false}>
        <View style={{ padding: space.xl, gap: space.md }}>
          <Row gap={space.md}>
            <View style={[styles.heroIcon, { backgroundColor: `${heroFgColor}1A` }]}>
              <HardDrive size={20} color={heroFgColor} />
            </View>
            <View style={{ flex: 1 }}>
              <Text variant="headline" color={heroFg}>
                {t('storageTitle')}
              </Text>
              <Text variant="footnote" color={heroFg} style={{ opacity: 0.7 }}>
                {items.length ? t('storageBody', { count: items.length, size: formatBytes(used) }) : downloads.length ? t('downloadsActive') : t('storageEmpty')}
              </Text>
            </View>
          </Row>
          <ProgressBar value={total ? (total - free) / total : 0} trackColor={`${heroFgColor}26`} />
          <Text variant="caption" color={heroFg} style={{ opacity: 0.7 }} tabular>
            {tc('storage.free', { size: formatBytes(free) })}
          </Text>
        </View>
      </Card>

      {items.length === 0 && downloads.length === 0 ? (
        <Card style={{ marginTop: space.md, gap: space.md }}>
          <Text variant="title3">{t('getStarted.title')}</Text>
          <Text variant="callout" color="textSecondary">
            {t('getStarted.body')}
          </Text>
          <Button title={t('getStarted.action')} onPress={() => router.push('/onboarding')} style={{ alignSelf: 'flex-start' }} />
        </Card>
      ) : null}

      {downloads.length > 0 ? (
        <Card style={{ marginTop: space.md }} onPress={() => router.push('/downloads')}>
          <Row gap={space.md}>
            <IconBadge icon={Download} hue="survival" />
            <View style={{ flex: 1, gap: 6 }}>
              <Text variant="headline">{downloadsLabel(downloads, tc)}</Text>
              <ProgressBar
                value={
                  downloads.reduce((s, d) => s + d.bytesWritten, 0) / Math.max(1, downloads.reduce((s, d) => s + d.totalBytes, 0))
                }
              />
            </View>
          </Row>
        </Card>
      ) : null}

      <ContinueCarousel />

      <SectionHeader title={t('modules')} />
      <View style={styles.grid}>
        {MODULES.map((m) => (
          <Card key={m.key} style={styles.tile} onPress={() => router.navigate(m.href)} accessibilityLabel={t(`module.${m.key}`)}>
            <IconBadge icon={m.icon} hue={m.hue} size={44} />
            <View style={{ gap: 2 }}>
              <Text variant="headline">{t(`module.${m.key}`)}</Text>
              <Text variant="footnote" color="textSecondary" numberOfLines={2}>
                {t(`module.${m.key}Body`)}
              </Text>
            </View>
          </Card>
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { marginTop: space.xl, borderRadius: radius.xl, borderWidth: 0 },
  heroIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  tile: { flexBasis: '47%', flexGrow: 1, gap: space.lg, minHeight: 150, justifyContent: 'space-between' },
});
