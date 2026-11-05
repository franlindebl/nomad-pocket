import { router, Stack, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { Backpack, BookOpen, ExternalLink, Map, Phone, ShieldCheck, Users, type LucideIcon } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Card, EmptyState, IconBadge, ListGroup, ListRow, Row, Screen, SectionHeader, Text } from '@/components/ui';
import { current, type Alert, type Hazard } from '@/features/alerts/alerts-core';
import { AlertMark, AlertsDisclaimer, LevelChip, useAlertsView } from '@/features/alerts/components';
import {
  alertKey,
  alertTitle,
  appLang,
  distanceLabel,
  formatMag,
  formatWhen,
  officialText,
  sourceName,
  windowLabel,
} from '@/features/alerts/present';
import { getGuideCard } from '@/features/guide/guide';
import { callPhones } from '@/features/maps/call';
import { useEmergencyNumber } from '@/features/maps/emergency';
import { useMapUi } from '@/features/maps/store';
import { space, type Hue } from '@/theme';

/** The guide card for each hazard (none about health, so every build has them). */
const GUIDE_CARD: Partial<Record<Hazard, string>> = {
  rain: 'flood',
  flood: 'flood',
  coastal: 'flood',
  storm: 'thunderstorms',
  snow: 'winter-storm',
  cold: 'winter-storm',
  heat: 'extreme-heat',
  fire: 'wildfire',
  quake: 'earthquake',
  tsunami: 'tsunami',
  tornado: 'shelter-in-place',
  wind: 'shelter-in-place',
  cyclone: 'evacuation',
  volcano: 'evacuation',
};

/** Fits the alert's area (or a quake's surroundings) on the map, then shows the Maps tab. */
function showOnMap(a: Alert) {
  const pts = a.polygons?.flat() ?? [];
  let bounds: [number, number, number, number] | null = null;
  if (pts.length) {
    const lons = pts.filter((_, i) => i % 2 === 0);
    const lats = pts.filter((_, i) => i % 2 === 1);
    bounds = [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)];
  } else if (a.point) {
    const d = a.kind === 'quake' ? 1 : 2;
    bounds = [a.point.lon - d, a.point.lat - d, a.point.lon + d, a.point.lat + d];
  }
  if (!bounds) return;
  const ui = useMapUi.getState();
  const [w, s, e, n] = bounds;
  const zoom = Math.max(4, Math.min(11, Math.log2(360 / Math.max(e - w, n - s, 0.01)) - 0.5));
  // The viewport is where a map that mounts now opens; focus() moves one already mounted.
  ui.setViewport({ center: [(w + e) / 2, (s + n) / 2], zoom, bounds });
  router.navigate('/maps');
  // A hidden tab's map ignores camera moves: ask once the Maps tab is on screen.
  setTimeout(() => ui.focus({ bounds }), 600);
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <Row style={{ justifyContent: 'space-between' }} gap={space.md}>
      <Text variant="footnote" color="textSecondary">
        {label}
      </Text>
      <Text variant="footnote" style={{ flexShrink: 1, textAlign: 'right' }} tabular>
        {value}
      </Text>
    </Row>
  );
}

/** One official alert: its frame (level, place, when, source), the source's own words, and what to do in the app. */
export default function AlertScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation('alerts');
  const { pos, now, state } = useAlertsView();
  const emergency = useEmergencyNumber();
  const all = Object.values(state.cache.sources).flatMap((s) => s?.alerts ?? []);
  const alert = current(all, now).find((a) => alertKey(a) === id) ?? all.find((a) => alertKey(a) === id && a.msgType !== 'cancel');
  const live = !!alert && (alert.expires === null || alert.expires > now) && current(all, now).some((a) => alertKey(a) === id);

  if (!alert) {
    return (
      <Screen>
        <Stack.Screen options={{ title: t('title') }} />
        <EmptyState icon={ShieldCheck} title={t('detail.gone')} body={t('detail.goneBody')} />
      </Screen>
    );
  }

  const text = officialText(alert);
  const lang = appLang();
  const translated = !!alert.texts[lang];
  const guideId = GUIDE_CARD[alert.hazard];
  const guide = guideId ? getGuideCard(guideId) : undefined;
  const distance = distanceLabel(alert, pos);
  const window = windowLabel(alert, now);

  const actions: { key: string; icon: LucideIcon; hue: Hue; title: string; onPress: () => void }[] = [];
  if (alert.polygons?.length || alert.point)
    actions.push({ key: 'map', icon: Map, hue: 'maps', title: t('detail.showMap'), onPress: () => showOnMap(alert) });
  if (guide) {
    actions.push({
      key: 'guide',
      icon: BookOpen,
      hue: 'survival',
      title: t('detail.guide', { title: guide[lang].title }),
      onPress: () => router.push({ pathname: '/guide/[id]', params: { id: guide.id } }),
    });
  }
  actions.push({ key: 'plan', icon: Users, hue: 'survival', title: t('detail.plan'), onPress: () => router.push('/prepare/plan') });
  actions.push({ key: 'kit', icon: Backpack, hue: 'survival', title: t('detail.kit'), onPress: () => router.push('/prepare/kit') });
  actions.push({
    key: 'call',
    icon: Phone,
    hue: 'medicine',
    title: t('detail.call', { number: emergency.number }),
    onPress: () => callPhones(emergency.number),
  });

  return (
    <Screen>
      <Stack.Screen options={{ title: t('title') }} />
      <Row gap={space.md} align="flex-start" style={{ marginTop: space.sm }}>
        <AlertMark alert={alert} size={48} />
        <View style={{ flex: 1, gap: space.xs }}>
          <LevelChip level={alert.level} />
          <Text variant="title2" testID="alert-title">
            {alertTitle(alert)}
          </Text>
          <Text variant="callout" color="textSecondary">
            {alert.area}
          </Text>
        </View>
      </Row>

      {!live ? (
        <Text variant="footnote" color="warning" style={{ marginTop: space.md }}>
          {t('detail.gone')}
        </Text>
      ) : null}

      <Card style={{ marginTop: space.lg, gap: space.sm }}>
        {alert.kind === 'quake' ? (
          <>
            <Fact label={t('detail.magnitude')} value={formatMag(alert.mag)} />
            {alert.sent !== null ? <Fact label={t('detail.time')} value={`${formatWhen(alert.sent, now)} · ${window}`} /> : null}
            {distance ? <Fact label={t('detail.distance')} value={distance} /> : null}
            {alert.depthKm !== undefined ? (
              <Fact label={t('detail.depth')} value={t('detail.depthValue', { km: Math.round(alert.depthKm) })} />
            ) : null}
          </>
        ) : (
          <>
            {window ? <Fact label={t('detail.valid')} value={window} /> : null}
            {distance ? <Fact label={t('detail.distance')} value={distance} /> : null}
          </>
        )}
        <Text variant="caption" color="textTertiary">
          {t('detail.issued', { source: sourceName(alert.source), when: alert.sent !== null ? formatWhen(alert.sent, now) : '—' })}
        </Text>
      </Card>

      {alert.kind === 'quake' ? (
        <Text variant="callout" style={{ marginTop: space.lg }}>
          {t('detail.quakeNote')}
        </Text>
      ) : null}

      {text.headline || text.description || text.instruction ? (
        <>
          <SectionHeader title={t('detail.official')} />
          <View style={{ gap: space.md }} testID="alert-official">
            {text.headline ? <Text variant="headline">{text.headline}</Text> : null}
            {text.description ? <Text variant="body">{text.description}</Text> : null}
            {text.instruction ? (
              <View style={{ gap: space.xs }}>
                <Text variant="overline" color="textSecondary">
                  {t('detail.instruction')}
                </Text>
                <Text variant="body">{text.instruction}</Text>
              </View>
            ) : null}
            {!translated ? (
              <Text variant="caption" color="textTertiary">
                {t('detail.untranslated')}
              </Text>
            ) : null}
          </View>
        </>
      ) : null}

      <SectionHeader title={t('detail.actions')} />
      <ListGroup>
        {actions.map((a) => (
          <ListRow
            key={a.key}
            testID={`alert-action-${a.key}`}
            leading={<IconBadge icon={a.icon} hue={a.hue} size={36} />}
            title={a.title}
            chevron
            onPress={a.onPress}
          />
        ))}
        {alert.url ? (
          <ListRow
            testID="alert-action-web"
            leading={<IconBadge icon={ExternalLink} hue="reference" size={36} />}
            title={t('detail.web', { source: sourceName(alert.source) })}
            onPress={() => void WebBrowser.openBrowserAsync(alert.url!)}
          />
        ) : null}
      </ListGroup>

      <View style={{ marginTop: space.xl, gap: space.md }}>
        <AlertsDisclaimer />
        <Text variant="caption" color="textTertiary">
          {t('list.credits')}
        </Text>
      </View>
    </Screen>
  );
}
