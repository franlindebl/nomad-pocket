import * as Device from 'expo-device';
import { router } from 'expo-router';
import { BookOpen, Check, Compass, Map, ShieldCheck, Sparkles, Stethoscope, Users, type LucideIcon } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, FadeOutUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Badge, Button, Card, IconBadge, PressableScale, Row, Segmented, Switch, Text } from '@/components/ui';
import { ramGB, SYSTEM_MODEL_ID } from '@/features/assistant/models';
import { downloadModel } from '@/features/assistant/register';
import { useSystemModel } from '@/features/assistant/system';
import { downloadResource, loc, sumMB, catalog } from '@/features/catalog';
import { showDownloadError } from '@/features/catalog/DownloadButton';
import { NotEnoughStorageError } from '@/features/downloads/manager';
import { downloadCountry, useCatalogsState, useCountryOffer, useCountrySize, useInstalledCountryIds } from '@/features/maps/countries';
import { CountryList, deviceCountry } from '@/features/maps/CountryList';
import { guideResources, pickModel, pickWikipedia } from '@/features/onboarding/kit';
import { useItems } from '@/features/content/items';
import type { AppLanguage } from '@/i18n';
import { formatBytes } from '@/lib/format';
import { freeBytes, STORAGE_HEADROOM } from '@/lib/storage';
import { useSettings } from '@/stores/settings';
import { layout, radius, space, useTheme, type Hue } from '@/theme';

type Piece = 'country' | 'guides' | 'wikipedia' | 'assistant';

/** Content languages follow the app language: Spanish speakers also get the (many) English-only guides. */
const contentLanguagesFor = (l: AppLanguage): AppLanguage[] => (l === 'es' ? ['es', 'en'] : ['en']);

function KitRow({
  icon,
  hue,
  title,
  body,
  size,
  value,
  onChange,
  included,
  testID,
}: {
  icon: LucideIcon;
  hue: Hue;
  title: string;
  body: string;
  size: string | null;
  value: boolean;
  onChange?: (v: boolean) => void;
  included?: string;
  testID: string;
}) {
  const { colors } = useTheme();
  // The whole row toggles (a bigger target than the switch; one element for VoiceOver).
  return (
    <PressableScale
      testID={testID}
      haptic={onChange ? 'selection' : 'none'}
      // Not `disabled`: an included piece must not look faded.
      onPress={onChange ? () => onChange(!value) : undefined}
      accessibilityRole={onChange ? 'switch' : undefined}
      accessibilityState={onChange ? { checked: value } : undefined}
      accessibilityLabel={[title, body, size, included].filter(Boolean).join(', ')}
      style={[styles.piece, { backgroundColor: colors.surface, borderColor: colors.border, opacity: onChange && !value ? 0.7 : 1 }]}>
      <IconBadge icon={icon} hue={hue} size={40} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="headline">{title}</Text>
        <Text variant="footnote" color="textSecondary">
          {body}
        </Text>
        {size ? (
          <Text variant="caption" color="textTertiary" tabular>
            {size}
          </Text>
        ) : null}
      </View>
      {included ? (
        <Badge label={included} tone="success" />
      ) : onChange ? (
        <View pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          <Switch value={value} onValueChange={onChange} />
        </View>
      ) : null}
    </PressableScale>
  );
}

export default function OnboardingScreen() {
  const { t } = useTranslation('home');
  const { t: tc } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const s = useSettings();
  const [step, setStep] = useState(0);
  const [country, setCountry] = useState<string | null>(() => s.country ?? deviceCountry());
  const [on, setOn] = useState<Record<Piece, boolean>>({ country: true, guides: true, wikipedia: true, assistant: true });
  const [starting, setStarting] = useState(false);
  const [started, setStarted] = useState(0);

  const installedCountries = useInstalledCountryIds();
  const installed = useItems();
  const installedIds = useMemo(() => new Set(installed.map((i) => i.catalogId ?? i.id)), [installed]);
  const offer = useCountryOffer(country ?? undefined);
  const countrySize = useCountrySize(step >= 2 ? offer : null);
  const catalogs = useCatalogsState();
  const system = useSystemModel((st) => st.info);
  const refreshSystem = useSystemModel((st) => st.refresh);
  useEffect(() => {
    refreshSystem().catch(() => {});
  }, [refreshSystem]);

  const setLanguage = (l: AppLanguage) => {
    s.setLanguage(l);
    s.setContentLanguages(contentLanguagesFor(l));
  };

  // What the kit holds (skipping what is already on the phone, for a second run).
  const kit = useMemo(() => {
    const free = freeBytes() - STORAGE_HEADROOM;
    const countryInstalled = !!country && installedCountries.has(country);
    const countryBytes = countryInstalled ? 0 : countrySize.status === 'ready' ? countrySize.bytes : 0;
    const guides = guideResources(s.contentLanguages).filter((r) => !installedIds.has(r.id));
    const guidesBytes = sumMB(guides) * 1e6;
    const systemModel = system?.status === 'available' ? system.provider : null;
    const model = pickModel(ramGB(Device.totalMemory));
    const modelInstalled = installedIds.has(model.id);
    const modelBytes = systemModel || modelInstalled ? 0 : model.sizeBytes;
    const wikiLang = s.contentLanguages.includes(s.language) ? s.language : (s.contentLanguages[0] ?? 'en');
    const installedWiki = catalog.wikipedia[wikiLang]?.find((o) => installedIds.has(o.resourceId));
    const rest = (on.country ? countryBytes : 0) + (on.guides ? guidesBytes : 0) + (on.assistant ? modelBytes : 0);
    const wiki = installedWiki ? null : pickWikipedia(wikiLang, free - rest);
    const wikiBytes = wiki ? wiki.resource.sizeMB * 1e6 : 0;
    const total = rest + (on.wikipedia ? wikiBytes : 0);
    return { free, countryInstalled, countryBytes, guides, guidesBytes, systemModel, model, modelInstalled, modelBytes, installedWiki, wiki, wikiBytes, total };
  }, [country, installedCountries, countrySize, s.contentLanguages, s.language, installedIds, system, on]);

  const countryPending = on.country && !kit.countryInstalled && countrySize.status === 'loading';
  const countryFailed = on.country && !kit.countryInstalled && (countrySize.status === 'offline' || countrySize.status === 'error');
  const fits = kit.total <= kit.free;

  const startKit = async () => {
    setStarting(true);
    let count = 0;
    try {
      if (country) s.setCountry(country);
      if (on.country && offer && !kit.countryInstalled && countrySize.status === 'ready') {
        downloadCountry(offer, countrySize.estimate);
        count++;
      }
      const resources = [...(on.guides ? kit.guides : []), ...(on.wikipedia && kit.wiki ? [kit.wiki.resource] : [])];
      for (const r of resources) {
        await downloadResource(r);
        count++;
      }
      if (kit.systemModel) s.setAiModelId(SYSTEM_MODEL_ID);
      else if (on.assistant && !kit.modelInstalled) {
        await downloadModel(kit.model);
        count++;
      }
      setStarted(count);
      setStep(3);
    } catch (e) {
      if (e instanceof NotEnoughStorageError) showDownloadError(e, tc);
      else showDownloadError(e, tc, startKit);
    } finally {
      setStarting(false);
    }
  };

  const finish = (then?: '/prepare/plan') => {
    s.setOnboarded(true);
    if (router.canGoBack()) router.back();
    else router.replace('/');
    if (then) setTimeout(() => router.push(then), 350);
  };

  const countryTitle = offer?.title ?? '';
  const sizeLabel = (bytes: number) => formatBytes(bytes);
  const anything = (on.country && !kit.countryInstalled) || (on.guides && kit.guides.length > 0) || (on.wikipedia && !!kit.wiki) || (on.assistant && !kit.systemModel && !kit.modelInstalled);

  return (
    // The country search's keyboard must not cover the step's buttons.
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.root, { backgroundColor: colors.bg, paddingTop: insets.top + space.lg, paddingBottom: insets.bottom + space.lg }]}>
      <Row style={styles.dots}>
        {[0, 1, 2, 3].map((i) => (
          <View key={i} style={[styles.dot, { backgroundColor: i <= step ? colors.accent : colors.surfaceAlt, width: i === step ? 24 : 8 }]} />
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
            <View style={{ gap: space.md }}>
              {[
                { icon: Map, hue: 'maps' as Hue, key: 'pointMaps' },
                { icon: Stethoscope, hue: 'medicine' as Hue, key: 'pointGuides' },
                { icon: Sparkles, hue: 'ai' as Hue, key: 'pointAi' },
                { icon: Users, hue: 'survival' as Hue, key: 'pointPlan' },
              ].map((p) => (
                <Row key={p.key} gap={space.md}>
                  <IconBadge icon={p.icon} hue={p.hue} size={36} />
                  <Text variant="callout" style={{ flex: 1 }}>
                    {t(`onboarding.${p.key}`)}
                  </Text>
                </Row>
              ))}
            </View>
            <View style={{ gap: space.sm, marginTop: space.md }}>
              <Text variant="overline" color="textSecondary">
                {t('onboarding.appLanguage')}
              </Text>
              <Segmented<AppLanguage>
                value={s.language}
                onChange={setLanguage}
                options={[
                  { value: 'es', label: 'Español' },
                  { value: 'en', label: 'English' },
                ]}
              />
            </View>
          </ScrollView>
          <Button testID="onboarding-start" title={t('onboarding.start')} size="lg" fullWidth onPress={() => setStep(1)} />
        </Animated.View>
      ) : null}

      {step === 1 ? (
        <Animated.View key="s1" entering={FadeInDown.duration(320)} exiting={FadeOutUp.duration(200)} style={styles.flex}>
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
            <Text variant="title1">{t('onboarding.countryTitle')}</Text>
            <Text variant="callout" color="textSecondary">
              {t('onboarding.countryBody')}
            </Text>
            <View style={{ gap: space.sm }}>
              <CountryList selected={country} onPick={setCountry} />
            </View>
          </ScrollView>
          <Row>
            <Button title={tc('actions.back')} variant="secondary" size="lg" onPress={() => setStep(0)} />
            <Button testID="onboarding-next" title={t('onboarding.next')} size="lg" style={{ flex: 1 }} disabled={!country} onPress={() => setStep(2)} />
          </Row>
        </Animated.View>
      ) : null}

      {step === 2 ? (
        <Animated.View key="s2" entering={FadeInDown.duration(320)} exiting={FadeOutUp.duration(200)} style={styles.flex}>
          <ScrollView contentContainerStyle={styles.content}>
            <Text variant="title1">{t('onboarding.kitTitle')}</Text>
            <Text variant="callout" color="textSecondary">
              {t('onboarding.kitBody')}
            </Text>
            <View style={{ gap: space.md }}>
              <KitRow
                testID="kit-country"
                icon={Map}
                hue="maps"
                title={t('onboarding.kit.country', { name: countryTitle })}
                body={offer?.pack || catalogs !== 'ready' ? t('onboarding.kit.countryBody') : t('onboarding.kit.countryBodyNoRouting')}
                size={
                  kit.countryInstalled
                    ? null
                    : countrySize.status === 'ready'
                      ? sizeLabel(countrySize.bytes)
                      : countrySize.status === 'loading'
                        ? t('onboarding.kit.sizing')
                        : t('onboarding.kit.sizeFailed')
                }
                value={on.country}
                onChange={kit.countryInstalled ? undefined : (v) => setOn((o) => ({ ...o, country: v }))}
                included={kit.countryInstalled ? tc('status.installed') : undefined}
              />
              <KitRow
                testID="kit-guides"
                icon={Stethoscope}
                hue="medicine"
                title={t('onboarding.kit.guides')}
                body={t('onboarding.kit.guidesBody')}
                size={kit.guides.length ? t('onboarding.kit.guidesSize', { count: kit.guides.length, size: sizeLabel(kit.guidesBytes) }) : null}
                value={on.guides}
                onChange={kit.guides.length ? (v) => setOn((o) => ({ ...o, guides: v })) : undefined}
                included={kit.guides.length ? undefined : tc('status.installed')}
              />
              <KitRow
                testID="kit-wikipedia"
                icon={BookOpen}
                hue="reference"
                title={t('onboarding.kit.wikipedia')}
                body={kit.wiki ? loc(catalog.wikipedia[s.language]?.find((o) => o.id === kit.wiki?.optionId)?.name) || kit.wiki.resource.id : t('onboarding.kit.wikipediaInstalled')}
                size={kit.wiki ? sizeLabel(kit.wikiBytes) : null}
                value={on.wikipedia}
                onChange={kit.wiki ? (v) => setOn((o) => ({ ...o, wikipedia: v })) : undefined}
                included={kit.wiki ? undefined : tc('status.installed')}
              />
              <KitRow
                testID="kit-assistant"
                icon={Sparkles}
                hue="ai"
                title={t('onboarding.kit.assistant')}
                body={
                  kit.systemModel
                    ? t('onboarding.kit.assistantSystem', { provider: t(`assistant:models.systemProvider.${kit.systemModel}`) })
                    : t('onboarding.kit.assistantModel', { name: kit.model.name })
                }
                size={kit.systemModel || kit.modelInstalled ? null : sizeLabel(kit.modelBytes)}
                value={on.assistant}
                onChange={kit.systemModel || kit.modelInstalled ? undefined : (v) => setOn((o) => ({ ...o, assistant: v }))}
                included={kit.systemModel ? t('onboarding.kit.included') : kit.modelInstalled ? tc('status.installed') : undefined}
              />
            </View>
            <Card style={{ gap: space.xs }}>
              <Row style={{ justifyContent: 'space-between' }}>
                <Text variant="headline">{t('onboarding.kit.total')}</Text>
                {countryPending ? <ActivityIndicator color={colors.textSecondary} /> : <Text variant="headline" tabular>{formatBytes(kit.total)}</Text>}
              </Row>
              <Text variant="footnote" color={fits ? 'textSecondary' : 'danger'} tabular>
                {fits ? t('onboarding.free', { size: formatBytes(Math.max(0, kit.free)) }) : t('onboarding.tooBig')}
              </Text>
              {countryFailed ? (
                <Text variant="footnote" color="warning">
                  {countrySize.status === 'offline' ? t('onboarding.kit.offline') : t('onboarding.kit.sizeFailed')}
                </Text>
              ) : null}
            </Card>
            <Text variant="caption" color="textTertiary">
              {t('onboarding.tipWifi')}
            </Text>
          </ScrollView>
          <Row>
            <Button title={tc('actions.back')} variant="secondary" size="lg" onPress={() => setStep(1)} />
            <Button
              testID="onboarding-download"
              title={anything ? t('onboarding.kit.download', { size: formatBytes(kit.total) }) : t('onboarding.kit.skip')}
              size="lg"
              style={{ flex: 1 }}
              loading={starting}
              disabled={anything && (!fits || countryPending)}
              onPress={
                anything
                  ? () => {
                      if (on.country && countryFailed)
                        Alert.alert(t('onboarding.kit.country', { name: countryTitle }), t('onboarding.kit.countryLater'), [
                          { text: tc('actions.cancel'), style: 'cancel' },
                          { text: tc('actions.continue'), onPress: () => void startKit() },
                        ]);
                      else void startKit();
                    }
                  : () => {
                      if (country) s.setCountry(country);
                      if (kit.systemModel) s.setAiModelId(SYSTEM_MODEL_ID);
                      setStep(3);
                    }
              }
            />
          </Row>
        </Animated.View>
      ) : null}

      {step === 3 ? (
        <Animated.View key="s3" entering={FadeInDown.duration(320)} style={styles.flex}>
          <ScrollView contentContainerStyle={styles.content}>
            <IconBadge icon={started ? ShieldCheck : Check} hue="agriculture" size={64} />
            <Text variant="display">{started ? t('onboarding.readyTitle') : t('onboarding.readyTitleEmpty')}</Text>
            <Text variant="body" color="textSecondary">
              {started ? t('onboarding.readyBodyDownloads') : t('onboarding.readyBodyEmpty')}
            </Text>
            <Card style={{ gap: space.md }} onPress={() => finish('/prepare/plan')} testID="onboarding-plan">
              <Row gap={space.md}>
                <IconBadge icon={Users} hue="survival" />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text variant="headline">{t('onboarding.planTitle')}</Text>
                  <Text variant="footnote" color="textSecondary">
                    {t('onboarding.planBody')}
                  </Text>
                </View>
              </Row>
            </Card>
          </ScrollView>
          <Button testID="onboarding-finish" title={t('onboarding.finish')} size="lg" fullWidth onPress={() => finish()} />
        </Animated.View>
      ) : null}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, ...layout.column, paddingHorizontal: space.gutter },
  flex: { flex: 1, gap: space.lg },
  dots: { gap: 6, marginBottom: space.lg },
  dot: { height: 8, borderRadius: 4 },
  content: { gap: space.lg, paddingBottom: space.xl },
  logo: { width: 80, height: 80, borderRadius: 24, alignItems: 'center', justifyContent: 'center', borderCurve: 'continuous' },
  piece: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.lg,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
  },
});
