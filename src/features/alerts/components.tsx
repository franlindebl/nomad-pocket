// Official alerts UI pieces shared by the alerts screens, Home, onboarding and Settings: the level mark and chip, an
// alert's row, the opt-in offer, the Home card and the disclaimer (docs/ALERTS_PLAN.md, decisions 1, 7 and 9).
import { router } from 'expo-router';
import {
  Activity,
  ChevronRight,
  CloudFog,
  CloudLightning,
  CloudRain,
  Droplets,
  Flame,
  Haze,
  Mountain,
  ShieldCheck,
  MountainSnow,
  Snowflake,
  Sun,
  ThermometerSnowflake,
  ThermometerSun,
  Tornado,
  TriangleAlert,
  Waves,
  Wind,
  type LucideIcon,
} from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { showToast } from '@/components/Toast';
import { Badge, Button, Card, ListRow, Row, Text } from '@/components/ui';
import { useEmergencyNumber, useHereCountry } from '@/features/maps/emergency';
import { useSettings } from '@/stores/settings';
import { space, useTheme, type Colors } from '@/theme';

import { levelRank, sourcesFor, visible, type Alert, type Hazard, type LatLon, type Level } from './alerts-core';
import { enableAlerts, declineAlerts } from './enable';
import { alertKey, alertSubtitle, alertTitle } from './present';
import { useAlertsState } from './state';

export const HAZARD_ICONS: Record<Hazard, LucideIcon> = {
  rain: CloudRain,
  wind: Wind,
  storm: CloudLightning,
  snow: Snowflake,
  heat: ThermometerSun,
  cold: ThermometerSnowflake,
  coastal: Waves,
  fog: CloudFog,
  dust: Haze,
  avalanche: MountainSnow,
  flood: Droplets,
  tornado: Tornado,
  cyclone: Tornado,
  fire: Flame,
  quake: Activity,
  tsunami: Waves,
  volcano: Mountain,
  drought: Sun,
  other: TriangleAlert,
};

export function levelColor(level: Level, colors: Colors): string {
  return level === 'red' ? colors.levelRed : level === 'orange' ? colors.levelOrange : colors.levelYellow;
}

export function levelSoft(level: Level, colors: Colors): string {
  return level === 'red' ? colors.levelRedSoft : level === 'orange' ? colors.levelOrangeSoft : colors.levelYellowSoft;
}

/** The level as a filled chip ("NARANJA"), the colour never alone: the word is always there. */
export function LevelChip({ level }: { level: Level }) {
  const { t } = useTranslation('alerts');
  const { colors } = useTheme();
  return (
    <View style={[styles.chip, { backgroundColor: levelColor(level, colors) }]}>
      <Text variant="overline" color="onLevel">
        {t(`levelChip.${level}`)}
      </Text>
    </View>
  );
}

/** The hazard's icon on its level's tint, with the level's colour as a bar on the left. */
export function AlertMark({ alert, size = 40 }: { alert: Alert; size?: number }) {
  const { colors } = useTheme();
  const Icon = HAZARD_ICONS[alert.hazard];
  return (
    <View style={[styles.mark, { width: size, height: size, backgroundColor: levelSoft(alert.level, colors) }]}>
      <View style={[styles.markBar, { backgroundColor: levelColor(alert.level, colors) }]} />
      <Icon size={size * 0.5} color={levelColor(alert.level, colors)} strokeWidth={2} />
    </View>
  );
}

export function AlertRow({ alert, pos, testID }: { alert: Alert; pos: LatLon | null; testID?: string }) {
  const { t } = useTranslation('alerts');
  return (
    <ListRow
      testID={testID}
      leading={<AlertMark alert={alert} />}
      title={alertTitle(alert)}
      titleLines={2}
      subtitle={alertSubtitle(alert, pos)}
      accessibilityHint={t(`levelChip.${alert.level}`)}
      chevron
      onPress={() => router.push({ pathname: '/alerts/[id]', params: { id: alertKey(alert) } })}
    />
  );
}

function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/** What the alerts list shows right now, from the cached answers and the kept position. */
export function useAlertsView() {
  const state = useAlertsState();
  const here = useHereCountry((s) => s.id);
  const chosen = useSettings((s) => s.country);
  const now = useMinuteClock();
  const country = here ?? chosen;
  const pos = state.position ? { lat: state.position.lat, lon: state.position.lon } : null;
  const sources = sourcesFor(country);
  const { cache } = state;
  const shown = useMemo(() => {
    const all = sources.flatMap((s) => cache.sources[s]?.alerts ?? []);
    return visible(all, { pos, country }, now);
    // The position and sources are rebuilt each render; their values are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cache, pos?.lat, pos?.lon, country, now]);
  return { ...shown, pos, country, sources, now, state };
}

/** "Nomad Pocket doesn't issue alerts…": in the offer, the list and each alert. */
export function AlertsDisclaimer() {
  const { t } = useTranslation('alerts');
  const { number } = useEmergencyNumber();
  return (
    <Text variant="footnote" color="textSecondary">
      {t('disclaimer', { number })}
    </Text>
  );
}

/**
 * The opt-in (decision 1): at the end of onboarding, once on Home for installs that had the app before, and the same
 * words as Settings' switch. "Ahora no" hides it for good.
 */
export function AlertsOffer({
  badge,
  secondary,
  onDone,
  testID = 'alerts-offer',
}: {
  badge?: boolean;
  /** Where the screen already has its one primary action (onboarding's "Ir a Nomad"). */
  secondary?: boolean;
  onDone?: () => void;
  testID?: string;
}) {
  const { t } = useTranslation('alerts');
  const [busy, setBusy] = useState(false);
  const enabled = useAlertsState((s) => s.enabled);
  if (enabled) {
    return (
      <Card testID={`${testID}-on`}>
        <Text variant="headline">{t('offer.enabled')}</Text>
      </Card>
    );
  }
  const enable = async () => {
    setBusy(true);
    try {
      const r = await enableAlerts();
      showToast(r.notifications ? t('offer.enabled') : t('offer.enabledNoNotifications'));
      onDone?.();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card style={{ gap: space.md }} testID={testID}>
      {badge ? <Badge label={t('offer.badge')} tone="accent" /> : null}
      <Text variant="title3">{t('offer.title')}</Text>
      <Text variant="callout" color="textSecondary">
        {t('offer.body')}
      </Text>
      <Text variant="footnote" color="textSecondary">
        {t('offer.privacy')}
      </Text>
      <AlertsDisclaimer />
      <Row gap={space.sm}>
        <Button
          testID={`${testID}-enable`}
          title={t('offer.enable')}
          variant={secondary ? 'secondary' : 'primary'}
          loading={busy}
          onPress={() => void enable()}
          style={{ flex: 1 }}
        />
        {badge ? (
          <Button
            testID={`${testID}-decline`}
            title={t('offer.notNow')}
            variant="ghost"
            onPress={() => {
              declineAlerts();
              onDone?.();
            }}
          />
        ) : null}
      </Row>
    </Card>
  );
}

/**
 * Home: the orange and red warnings in force where the person is (one card; the most serious first), or, for an
 * install that had the app before this feature, the once-only offer.
 */
export function AlertsHomeCard({ style }: { style?: StyleProp<ViewStyle> }) {
  const { t } = useTranslation('alerts');
  const { colors } = useTheme();
  const { alerts, nearby, pos, state } = useAlertsView();
  const onboarded = useSettings((s) => s.onboarded);
  if (!state.enabled) {
    return !state.offered && onboarded ? (
      <View style={style}>
        <AlertsOffer badge testID="home-alerts-offer" />
      </View>
    ) : null;
  }
  const serious = nearby ? alerts.filter((a) => levelRank(a.level) >= levelRank('orange')) : [];
  const top = serious[0];
  if (!top) {
    // Nothing serious: a quiet line with the state, the way into the list (yellow warnings, quakes further away).
    const yellow = nearby ? alerts.length : 0;
    const line = !pos ? t('home.noPosition') : yellow ? t('home.yellow', { count: yellow }) : t('home.none');
    return (
      <Card onPress={() => router.push('/alerts')} testID="home-alerts-status" style={style} accessibilityLabel={`${t('title')}. ${line}`}>
        <Row gap={space.md}>
          <ShieldCheck size={20} color={colors.textSecondary} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="headline">{t('title')}</Text>
            <Text variant="footnote" color="textSecondary">
              {line}
            </Text>
          </View>
          <ChevronRight size={18} color={colors.textTertiary} />
        </Row>
      </Card>
    );
  }
  const open = () =>
    serious.length === 1 ? router.push({ pathname: '/alerts/[id]', params: { id: alertKey(top) } }) : router.push('/alerts');
  return (
    <Card
      onPress={open}
      testID="home-alert"
      style={[{ borderColor: levelColor(top.level, colors) }, style]}
      accessibilityLabel={[
        alertTitle(top),
        alertSubtitle(top, pos),
        serious.length > 1 ? t('home.more', { count: serious.length - 1 }) : '',
      ]
        .filter(Boolean)
        .join('. ')}>
      <Row gap={space.md} align="flex-start">
        <AlertMark alert={top} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="headline">{alertTitle(top)}</Text>
          <Text variant="footnote" color="textSecondary">
            {alertSubtitle(top, pos)}
          </Text>
          {serious.length > 1 ? (
            <Text variant="footnote" color="text">
              {t('home.more', { count: serious.length - 1 })}
            </Text>
          ) : null}
        </View>
        <ChevronRight size={18} color={colors.textTertiary} />
      </Row>
    </Card>
  );
}

const styles = StyleSheet.create({
  chip: { alignSelf: 'flex-start', paddingHorizontal: 8, height: 22, justifyContent: 'center' },
  mark: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  markBar: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3 },
});
