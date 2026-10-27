import * as Device from 'expo-device';
import { router } from 'expo-router';
import { BookOpen, Check, Compass, Map, ShieldCheck, Sparkles, Stethoscope, Users, X, type LucideIcon } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, FadeOutUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Badge, Button, Card, IconBadge, IconButton, PressableScale, Row, Segmented, Switch, Text } from '@/components/ui';
import { ramGB, SYSTEM_MODEL_ID } from '@/features/assistant/models';
import { downloadModel } from '@/features/assistant/register';
import { useSystemModel } from '@/features/assistant/system';
import { downloadResource, loc, sumMB, catalog } from '@/features/catalog';
import { showDownloadError } from '@/features/catalog/DownloadButton';
import { NotEnoughStorageError, useDownloads, type DownloadStatus } from '@/features/downloads/manager';
import {
  downloadCountry,
  useCatalogsState,
  useCountries,
  useCountryOffer,
  useChosenRegions,
  useCountrySize,
  useInstalledCountryIds,
} from '@/features/maps/countries';
import { countryRegionName } from '@/features/maps/country-maps';
import { CountryList, deviceCountry } from '@/features/maps/CountryList';
import { RegionList } from '@/features/maps/RegionList';
import { guideResources, pickModel, pickWikipedia } from '@/features/onboarding/kit';
import { useItems } from '@/features/content/items';
import type { AppLanguage } from '@/i18n';
import { formatBytes } from '@/lib/format';
import { freeBytes, STORAGE_HEADROOM } from '@/lib/storage';
import { useSettings } from '@/stores/settings';
import { layout, radius, space, useTheme, type Hue } from '@/theme';

type Piece = 'country' | 'guides' | 'wikipedia' | 'assistant';

/** A download in flight: a second run (Home's "Completar") must not offer it again. */
const IN_FLIGHT: DownloadStatus[] = ['queued', 'running', 'paused', 'processing'];
const WIKIPEDIA_IDS = new Set(Object.values(catalog.wikipedia).flatMap((options) => options.map((o) => o.resourceId)));

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
  badge,
  testID,
}: {
  icon: LucideIcon;
  hue: Hue;
  title: string;
  body: string;
  size: string | null;
  value: boolean;
  onChange?: (v: boolean) => void;
  /** Instead of the switch: why the piece isn't a choice (installed, downloading, won't fit). */
  badge?: { label: string; tone: 'success' | 'accent' | 'warning' };
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
      accessibilityLabel={[title, body, size, badge?.label].filter(Boolean).join(', ')}
      restOpacity={onChange && !value ? 0.6 : 1}
      style={[styles.piece, { backgroundColor: colors.surface, borderColor: colors.border }]}>
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
      {badge ? (
        <Badge label={badge.label} tone={badge.tone} />
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
  // A second run (Settings, or Home's "Completar"): the first-run choices are kept and the
  // wizard can be closed.
  const [rerun] = useState(() => useSettings.getState().onboarded);

  const installedCountries = useInstalledCountryIds();
  const { countries } = useCountries();
  const installed = useItems();
  const installedIds = useMemo(() => new Set(installed.map((i) => i.catalogId ?? i.id)), [installed]);
  const records = useDownloads((st) => st.records);
  const pendingIds = useMemo(
    () =>
      new Set(
        Object.values(records)
          .filter((r) => IN_FLIGHT.includes(r.status))
          .map((r) => r.id),
      ),
    [records],
  );
  const offer = useCountryOffer(country ?? undefined);
  // A country in regions (the USA): the kit brings the ones ticked, the one the person is in
  // to start with (the location is asked for on the kit step, only for such a country).
  const regions = useChosenRegions(step >= 2 ? offer : null, true);
  const regionSize = useCountrySize(step >= 2 ? offer : null, offer?.regions ? (regions ?? []) : undefined);
  const sizing = !!offer?.regions && regions === undefined;
  const countrySize = useMemo(() => (sizing ? { ...regionSize, status: 'loading' as const } : regionSize), [sizing, regionSize]);
  const noRegion = !!offer?.regions && !regions?.length;
  const catalogs = useCatalogsState();
  const system = useSystemModel((st) => st.info);
  const refreshSystem = useSystemModel((st) => st.refresh);
  useEffect(() => {
    refreshSystem().catch(() => {});
  }, [refreshSystem]);

  const setLanguage = (l: AppLanguage) => {
    if (l === s.language) return;
    s.setLanguage(l);
    // Only the first run derives them; later the user's own choice (Settings) stays.
    if (!rerun) s.setContentLanguages(contentLanguagesFor(l));
  };

  // What the kit holds, skipping what is already on the phone or still downloading (a second run).
  const kit = useMemo(() => {
    const free = freeBytes() - STORAGE_HEADROOM;
    const countryInstalled = !!country && installedCountries.has(country);
    const countryDownloading = !countryInstalled && countries.some((c) => c.regionId === country && c.progress !== null);
    const countryWanted = !countryInstalled && !countryDownloading && !noRegion;
    const countryBytes = countryWanted && countrySize.status === 'ready' ? countrySize.bytes : 0;
    // What it takes on disk while it installs (a multi-part archive is assembled next to its parts).
    const countryNeeded = countryWanted && countrySize.status === 'ready' ? countrySize.needed : 0;
    const allGuides = guideResources(s.contentLanguages).filter((r) => !installedIds.has(r.id));
    const guides = allGuides.filter((r) => !pendingIds.has(r.id));
    const guidesDownloading = guides.length < allGuides.length;
    const guidesBytes = sumMB(guides) * 1e6;
    const systemModel = system?.status === 'available' ? system.provider : null;
    const model = pickModel(ramGB(Device.totalMemory));
    const modelInstalled = installedIds.has(model.id);
    const modelDownloading = !modelInstalled && pendingIds.has(model.id);
    const modelBytes = systemModel || modelInstalled || modelDownloading ? 0 : model.sizeBytes;
    const wikiLang = s.contentLanguages.includes(s.language) ? s.language : (s.contentLanguages[0] ?? 'en');
    const installedWiki = catalog.wikipedia[wikiLang]?.find((o) => installedIds.has(o.resourceId));
    // Any Wikipedia on its way: the free space has shrunk since it was picked, so a new pick
    // could be another variant (another id, which the download queue wouldn't dedupe).
    const wikiDownloading = !installedWiki && [...pendingIds].some((id) => WIKIPEDIA_IDS.has(id));
    const others = (on.guides ? guidesBytes : 0) + (on.assistant ? modelBytes : 0);
    const rest = (on.country ? countryBytes : 0) + others;
    const restNeeded = (on.country ? countryNeeded : 0) + others;
    // Null with neither of those: not even the smallest one fits next to the rest.
    const wiki = installedWiki || wikiDownloading ? null : pickWikipedia(wikiLang, free - restNeeded);
    const wikiBytes = wiki ? wiki.resource.sizeMB * 1e6 : 0;
    const total = rest + (on.wikipedia ? wikiBytes : 0);
    const needed = restNeeded + (on.wikipedia ? wikiBytes : 0);
    return {
      free,
      countryInstalled,
      countryDownloading,
      countryWanted,
      countryBytes,
      guides,
      guidesDownloading,
      guidesBytes,
      systemModel,
      model,
      modelInstalled,
      modelDownloading,
      modelBytes,
      wikiLang,
      installedWiki,
      wikiDownloading,
      wiki,
      wikiBytes,
      total,
      needed,
    };
  }, [country, installedCountries, countries, countrySize, noRegion, s.contentLanguages, s.language, installedIds, pendingIds, system, on]);

  const countryPending = on.country && kit.countryWanted && countrySize.status === 'loading';
  const countryFailed = on.country && kit.countryWanted && (countrySize.status === 'offline' || countrySize.status === 'error');
  const fits = kit.needed <= kit.free;
  // The catalogs are fetched when the wizard opens: if that failed (a fresh install has no cached
  // copy), the kit step tries again rather than offering the kit without the map.
  const retryCountry = countrySize.retry;
  const failedOnArrival = step === 2 && countryFailed;
  useEffect(() => {
    if (failedOnArrival) retryCountry();
    // Once per arrival on the kit step; `retry` is a new function every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const startKit = async () => {
    setStarting(true);
    let count = 0;
    try {
      if (country) s.setCountry(country);
      if (on.country && offer && kit.countryWanted && countrySize.status === 'ready') {
        downloadCountry(offer, countrySize.estimate, { regions: offer.regions ? regions : undefined });
        count++;
      }
      const resources = [...(on.guides ? kit.guides : []), ...(on.wikipedia && kit.wiki ? [kit.wiki.resource] : [])];
      for (const r of resources) {
        await downloadResource(r);
        count++;
      }
      if (kit.systemModel) keepSystemModel();
      else if (on.assistant && !kit.modelInstalled && !kit.modelDownloading) {
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

  // The phone's own model, unless the user already chose one (a second run keeps it).
  const keepSystemModel = () => {
    if (!useSettings.getState().aiModelId) s.setAiModelId(SYSTEM_MODEL_ID);
  };

  const close = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  const finish = (then?: '/prepare/plan') => {
    s.setOnboarded(true);
    close();
    if (then) setTimeout(() => router.push(then), 350);
  };

  const countryTitle = offer?.title ?? '';
  const sizeLabel = (bytes: number) => formatBytes(bytes);
  const anything =
    (on.country && kit.countryWanted) ||
    (on.guides && kit.guides.length > 0) ||
    (on.wikipedia && !!kit.wiki) ||
    (on.assistant && !kit.systemModel && !kit.modelInstalled && !kit.modelDownloading);
  const installedBadge = { label: tc('status.installed'), tone: 'success' } as const;
  const downloadingBadge = { label: tc('status.running'), tone: 'accent' } as const;
  const preparingBadge = { label: tc('status.processing'), tone: 'accent' } as const;
  // Downloaded, its search and emergency points still on their way in.
  const countryPreparing = countries.some((c) => c.regionId === country && c.progress === null && c.preparing !== null);

  return (
    // The country search's keyboard must not cover the step's buttons. The bottom inset is a
    // spacer: in 'padding' mode KeyboardAvoidingView overwrites its own paddingBottom (0 with
    // no keyboard), which left the buttons on the screen's edge. The offset keeps that inset
    // from adding to the keyboard's height.
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={insets.bottom}
      style={[styles.root, { backgroundColor: colors.bg, paddingTop: insets.top + space.lg }]}>
      <Row style={styles.dots}>
        {[0, 1, 2, 3].map((i) => (
          <View key={i} style={[styles.dot, { backgroundColor: i <= step ? colors.accent : colors.surfaceAlt, width: i === step ? 24 : 8 }]} />
        ))}
        {rerun ? (
          // The first run can't be skipped; a second one is only a look at what's missing.
          <IconButton
            testID="onboarding-close"
            icon={X}
            size={32}
            accessibilityLabel={tc('actions.close')}
            onPress={close}
            style={styles.close}
          />
        ) : null}
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
                title={
                  // Some regions of a country in regions: which ones; all of them: the country.
                  regions?.length && regions.length < (offer?.regions?.length ?? 0)
                    ? t('onboarding.kit.countryRegions', { name: countryTitle, regions: regions.map(countryRegionName).join(', ') })
                    : t('onboarding.kit.country', { name: countryTitle })
                }
                body={
                  noRegion && !kit.countryInstalled && !kit.countryDownloading
                    ? t('onboarding.kit.noRegion')
                    : offer?.packs.length || catalogs !== 'ready'
                      ? t('onboarding.kit.countryBody')
                      : t('onboarding.kit.countryBodyNoRouting')
                }
                size={
                  !kit.countryWanted
                    ? null
                    : countrySize.status === 'ready'
                      ? sizeLabel(countrySize.bytes)
                      : countrySize.status === 'loading'
                        ? t('onboarding.kit.sizing')
                        : t('onboarding.kit.sizeFailed')
                }
                value={on.country}
                onChange={kit.countryWanted ? (v) => setOn((o) => ({ ...o, country: v })) : undefined}
                badge={
                  kit.countryInstalled ? (countryPreparing ? preparingBadge : installedBadge) : kit.countryDownloading ? downloadingBadge : undefined
                }
              />
              {offer?.regions && on.country && !kit.countryInstalled && !kit.countryDownloading ? (
                <RegionList offer={offer} chosen={regions} />
              ) : null}
              <KitRow
                testID="kit-guides"
                icon={Stethoscope}
                hue="medicine"
                title={t('onboarding.kit.guides')}
                body={t('onboarding.kit.guidesBody')}
                size={kit.guides.length ? t('onboarding.kit.guidesSize', { count: kit.guides.length, size: sizeLabel(kit.guidesBytes) }) : null}
                value={on.guides}
                onChange={kit.guides.length ? (v) => setOn((o) => ({ ...o, guides: v })) : undefined}
                badge={kit.guides.length ? undefined : kit.guidesDownloading ? downloadingBadge : installedBadge}
              />
              <KitRow
                testID="kit-wikipedia"
                icon={BookOpen}
                hue="reference"
                title={t('onboarding.kit.wikipedia')}
                body={
                  kit.wiki
                    ? loc(catalog.wikipedia[kit.wikiLang]?.find((o) => o.id === kit.wiki?.optionId)?.name) || kit.wiki.resource.id
                    : kit.installedWiki
                      ? t('onboarding.kit.wikipediaInstalled')
                      : kit.wikiDownloading
                        ? t('onboarding.kit.wikipediaDownloading')
                        : t('onboarding.kit.wikipediaNoRoom')
                }
                size={kit.wiki ? sizeLabel(kit.wikiBytes) : null}
                value={on.wikipedia}
                onChange={kit.wiki ? (v) => setOn((o) => ({ ...o, wikipedia: v })) : undefined}
                badge={
                  kit.wiki
                    ? undefined
                    : kit.installedWiki
                      ? installedBadge
                      : kit.wikiDownloading
                        ? downloadingBadge
                        : { label: t('onboarding.kit.noRoom'), tone: 'warning' }
                }
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
                size={kit.systemModel || kit.modelInstalled || kit.modelDownloading ? null : sizeLabel(kit.modelBytes)}
                value={on.assistant}
                onChange={
                  kit.systemModel || kit.modelInstalled || kit.modelDownloading ? undefined : (v) => setOn((o) => ({ ...o, assistant: v }))
                }
                badge={
                  kit.systemModel
                    ? { label: t('onboarding.kit.included'), tone: 'success' }
                    : kit.modelInstalled
                      ? installedBadge
                      : kit.modelDownloading
                        ? downloadingBadge
                        : undefined
                }
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
              title={anything ? tc('actions.downloadSize', { size: formatBytes(kit.total) }) : t('onboarding.kit.skip')}
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
                          { text: tc('actions.retry'), onPress: countrySize.retry },
                          { text: tc('actions.continue'), onPress: () => void startKit() },
                        ]);
                      else void startKit();
                    }
                  : () => {
                      if (country) s.setCountry(country);
                      if (kit.systemModel) keepSystemModel();
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
      <View style={{ height: insets.bottom + space.lg }} />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, ...layout.column, paddingHorizontal: space.gutter },
  flex: { flex: 1, gap: space.lg },
  dots: { gap: 6, marginBottom: space.lg },
  close: { marginLeft: 'auto' },
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
