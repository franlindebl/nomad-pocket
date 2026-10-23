import { router } from 'expo-router';
import { BookOpen, Check, Compass, Feather, Layers, Map, Sparkles, Stethoscope, Wifi, type LucideIcon } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, FadeOutUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Chip, IconBadge, PressableScale, Row, Segmented, Text } from '@/components/ui';
import { downloadResource, sumMB } from '@/features/catalog';
import { showDownloadError } from '@/features/catalog/DownloadButton';
import { packResources, type PackId } from '@/features/onboarding/packs';
import type { AppLanguage } from '@/i18n';
import { formatBytes, formatMB } from '@/lib/format';
import { freeBytes, STORAGE_HEADROOM } from '@/lib/storage';
import { useSettings } from '@/stores/settings';
import { radius, space, useTheme, type Hue } from '@/theme';

const PACKS: { id: PackId; icon: LucideIcon; hue: Hue }[] = [
  { id: 'light', icon: Feather, hue: 'agriculture' },
  { id: 'balanced', icon: Layers, hue: 'reference' },
  { id: 'complete', icon: BookOpen, hue: 'computing' },
  { id: 'none', icon: Compass, hue: 'neutral' },
];

export default function OnboardingScreen() {
  const { t } = useTranslation('home');
  const { t: tc } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const s = useSettings();
  const [step, setStep] = useState(0);
  const [pack, setPack] = useState<PackId>('light');
  const [started, setStarted] = useState({ count: 0, mb: 0 });
  const free = freeBytes() - STORAGE_HEADROOM;

  const packs = useMemo(
    () => PACKS.map((p) => ({ ...p, resources: packResources(p.id, s.contentLanguages, s.language) })),
    [s.contentLanguages, s.language],
  );

  const toggleLang = (l: AppLanguage) => {
    const next = s.contentLanguages.includes(l) ? s.contentLanguages.filter((x) => x !== l) : [...s.contentLanguages, l];
    if (next.length) s.setContentLanguages(next);
  };

  const startDownloads = async () => {
    const chosen = packs.find((p) => p.id === pack)?.resources ?? [];
    let count = 0;
    for (const r of chosen) {
      try {
        await downloadResource(r);
        count++;
      } catch (e) {
        showDownloadError(e, tc, startDownloads);
        return;
      }
    }
    setStarted({ count, mb: sumMB(chosen.slice(0, count)) });
    setStep(2);
  };

  const finish = () => {
    s.setOnboarded(true);
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.bg, paddingTop: insets.top + space.lg, paddingBottom: insets.bottom + space.lg }]}>
      <Row style={styles.dots}>
        {[0, 1, 2].map((i) => (
          <View
            key={i}
            style={[styles.dot, { backgroundColor: i <= step ? colors.accent : colors.surfaceAlt, width: i === step ? 24 : 8 }]}
          />
        ))}
      </Row>

      {step === 0 ? (
        <Animated.View key="s0" entering={FadeInDown.duration(320)} exiting={FadeOutUp.duration(200)} style={styles.flex}>
          <ScrollView contentContainerStyle={styles.content}>
            <View style={[styles.logo, { backgroundColor: colors.ink }]}>
              <Compass size={40} color={colors.accent} strokeWidth={1.75} />
            </View>
            <Text variant="display">{t('onboarding.welcomeTitle')}</Text>
            <Text variant="body" color="textSecondary">
              {t('onboarding.welcomeBody')}
            </Text>
            <Row gap={space.sm} style={{ flexWrap: 'wrap' }}>
              {[
                { icon: Stethoscope, hue: 'medicine' as Hue },
                { icon: Map, hue: 'maps' as Hue },
                { icon: BookOpen, hue: 'education' as Hue },
                { icon: Sparkles, hue: 'ai' as Hue },
              ].map((f, i) => (
                <IconBadge key={i} icon={f.icon} hue={f.hue} size={48} />
              ))}
            </Row>
            <View style={{ gap: space.sm, marginTop: space.lg }}>
              <Text variant="overline" color="textSecondary">
                {t('onboarding.appLanguage')}
              </Text>
              <Segmented<AppLanguage>
                value={s.language}
                onChange={s.setLanguage}
                options={[
                  { value: 'es', label: 'Español' },
                  { value: 'en', label: 'English' },
                ]}
              />
            </View>
            <View style={{ gap: space.sm }}>
              <Text variant="overline" color="textSecondary">
                {t('onboarding.contentLanguages')}
              </Text>
              <Row>
                {(['es', 'en'] as AppLanguage[]).map((l) => (
                  <Chip key={l} label={tc(`language.${l}`)} selected={s.contentLanguages.includes(l)} onPress={() => toggleLang(l)} />
                ))}
              </Row>
            </View>
          </ScrollView>
          <Button title={t('onboarding.next')} size="lg" fullWidth onPress={() => setStep(1)} />
        </Animated.View>
      ) : null}

      {step === 1 ? (
        <Animated.View key="s1" entering={FadeInDown.duration(320)} exiting={FadeOutUp.duration(200)} style={styles.flex}>
          <ScrollView contentContainerStyle={styles.content}>
            <Text variant="title1">{t('onboarding.packTitle')}</Text>
            <Text variant="callout" color="textSecondary">
              {t('onboarding.packBody')} {t('onboarding.free', { size: formatBytes(Math.max(0, free)) })}
            </Text>
            <View style={{ gap: space.md }}>
              {packs.map((p) => {
                const mb = sumMB(p.resources);
                const fits = mb * 1e6 <= free;
                const selected = pack === p.id;
                return (
                  <PressableScale
                    key={p.id}
                    haptic="selection"
                    disabled={!fits}
                    onPress={() => setPack(p.id)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected, disabled: !fits }}
                    style={[
                      styles.pack,
                      {
                        backgroundColor: colors.surface,
                        borderColor: selected ? colors.ink : colors.border,
                        borderWidth: selected ? 2 : StyleSheet.hairlineWidth,
                      },
                    ]}>
                    <IconBadge icon={p.icon} hue={p.hue} size={44} />
                    <View style={{ flex: 1, gap: 2 }}>
                      <Row style={{ justifyContent: 'space-between' }}>
                        <Text variant="headline">{t(`onboarding.packs.${p.id}.name`)}</Text>
                        {p.id !== 'none' ? (
                          <Text variant="headline" tabular>
                            {formatMB(mb)}
                          </Text>
                        ) : null}
                      </Row>
                      <Text variant="footnote" color="textSecondary">
                        {t(`onboarding.packs.${p.id}.body`)}
                      </Text>
                      {p.id !== 'none' ? (
                        <Text variant="caption" color={fits ? 'textTertiary' : 'danger'}>
                          {fits ? t('onboarding.items', { count: p.resources.length }) : t('onboarding.tooBig')}
                        </Text>
                      ) : null}
                    </View>
                    {selected ? (
                      <View style={[styles.check, { backgroundColor: colors.ink }]}>
                        <Check size={14} color={colors.onInk} strokeWidth={3} />
                      </View>
                    ) : null}
                  </PressableScale>
                );
              })}
            </View>
          </ScrollView>
          <Row>
            <Button title={tc('actions.back')} variant="secondary" size="lg" onPress={() => setStep(0)} />
            <Button
              title={pack === 'none' ? t('onboarding.next') : tc('actions.download')}
              size="lg"
              style={{ flex: 1 }}
              onPress={pack === 'none' ? () => setStep(2) : startDownloads}
            />
          </Row>
        </Animated.View>
      ) : null}

      {step === 2 ? (
        <Animated.View key="s2" entering={FadeInDown.duration(320)} style={styles.flex}>
          <ScrollView contentContainerStyle={styles.content}>
            <IconBadge icon={Check} hue="agriculture" size={64} />
            <Text variant="display">{t('onboarding.readyTitle')}</Text>
            <Text variant="body" color="textSecondary">
              {started.count
                ? t('onboarding.readyBodyDownloads', { count: started.count, size: formatMB(started.mb) })
                : t('onboarding.readyBodyEmpty')}
            </Text>
            <View style={{ gap: space.md, marginTop: space.md }}>
              {[
                { icon: Wifi, key: 'tipWifi', hue: 'reference' as Hue },
                { icon: Map, key: 'tipMaps', hue: 'maps' as Hue },
                { icon: Sparkles, key: 'tipAi', hue: 'ai' as Hue },
              ].map((tip) => (
                <Row key={tip.key} gap={space.md} align="flex-start">
                  <IconBadge icon={tip.icon} hue={tip.hue} size={36} />
                  <Text variant="callout" style={{ flex: 1, marginTop: 6 }}>
                    {t(`onboarding.${tip.key}`)}
                  </Text>
                </Row>
              ))}
            </View>
          </ScrollView>
          <Button title={t('onboarding.finish')} size="lg" fullWidth onPress={finish} />
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: space.gutter },
  flex: { flex: 1, gap: space.lg },
  dots: { gap: 6, marginBottom: space.lg },
  dot: { height: 8, borderRadius: 4 },
  content: { gap: space.lg, paddingBottom: space.xl },
  logo: { width: 80, height: 80, borderRadius: 24, alignItems: 'center', justifyContent: 'center', borderCurve: 'continuous' },
  pack: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.lg,
    borderCurve: 'continuous',
  },
  check: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
});
