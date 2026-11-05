// A map answer in the chat (docs/ASSISTANT_MAP_PLAN.md): places near somewhere, the nearest one by travel
// time, a route, where the person is, sharing it, the emergency number, "which one?" and "not found".
// Every action is the person's tap (call, share, navigate) and opens what the Maps tab already has.
import { router } from 'expo-router';
import type { TFunction } from 'i18next';
import { Crosshair, MapPin, MessageSquare, Navigation, Phone, Share2 } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Linking, StyleSheet, View } from 'react-native';

import { Button, Card, Chip, IconBadge, IconButton, ListGroup, ListRow, Text } from '@/components/ui';
import { callPhones } from '@/features/maps/call';
import { formatLatLon, formatUtm, toUtm, type LatLon } from '@/features/maps/geo';
import { startGuidance, useGuidance } from '@/features/maps/guidance';
import { distanceWithDirection, kindColor, kindIcon, kindLabel } from '@/features/maps/labels';
import type { Costing } from '@/features/maps/routing-core';
import { shareLocation, smsLocation } from '@/features/maps/share-location';
import { useMapUi, type SelectedPlace } from '@/features/maps/store';
import { formatDistance, formatDuration, formatRelativeDate } from '@/lib/format';
import { space, useTheme } from '@/theme';

import { chooseMapOption } from '../chats';
import type { MapAnchor, MapCard, MapResult } from '../map-answer';

// ---------------------------------------------------------------------------
// Actions

/** Shows a place on the Maps tab with its card. A hidden tab's map ignores camera moves: focus once it's on screen. */
function openOnMap(p: MapResult) {
  const ui = useMapUi.getState();
  const zoom = Math.max(ui.viewport?.zoom ?? 0, 16);
  const d = 0.005;
  const place: SelectedPlace = { name: p.name, lat: p.lat, lon: p.lon, kind: p.kind, layer: 'poi', context: p.context ?? null, osmId: p.osmId ?? null };
  ui.setViewport({ center: [p.lon, p.lat], zoom, bounds: [p.lon - d, p.lat - d, p.lon + d, p.lat + d] });
  ui.select(place);
  router.navigate('/maps');
  setTimeout(() => ui.focus({ center: [p.lon, p.lat], zoom }), 600);
}

/** Both ends of a trip that doesn't start here, framed on the map. */
function openBoundsOnMap(a: LatLon, b: LatLon) {
  const ui = useMapUi.getState();
  const pad = 0.01;
  const bounds: [number, number, number, number] = [
    Math.min(a.lon, b.lon) - pad,
    Math.min(a.lat, b.lat) - pad,
    Math.max(a.lon, b.lon) + pad,
    Math.max(a.lat, b.lat) + pad,
  ];
  const [w, s, e, n] = bounds;
  const zoom = Math.max(4, Math.min(15, Math.log2(360 / Math.max(e - w, n - s, 0.001)) - 0.5));
  ui.setViewport({ center: [(w + e) / 2, (s + n) / 2], zoom, bounds });
  router.navigate('/maps');
  setTimeout(() => ui.focus({ bounds }), 600);
}

/**
 * The trip preview on the Maps tab (starting it stays the person's "Iniciar"), framed from `from` (where the
 * person is) to the place: a map that hasn't been opened yet would show its saved view, the whole world on a
 * fresh install. Denied location: startGuidance says so.
 */
async function goTo(p: MapResult, name: string, costing?: Costing, from?: LatLon | null) {
  if (costing) useGuidance.getState().setCosting(costing);
  if (await startGuidance({ name, lat: p.lat, lon: p.lon })) {
    useMapUi.getState().select(null);
    openBoundsOnMap(from ?? p, p);
  }
}

// ---------------------------------------------------------------------------
// Pieces

function Footnote({ children }: { children: string }) {
  return (
    <Text variant="footnote" color="textSecondary">
      {children}
    </Text>
  );
}

function ResultRow({ r, anchor, call, costing, testID }: { r: MapResult; anchor: MapAnchor; call?: boolean; costing?: Costing; testID: string }) {
  const { t } = useTranslation('assistant');
  const { colors } = useTheme();
  const name = r.name || kindLabel(t, r.kind);
  const away = r.distance != null ? (anchor.here ? distanceWithDirection(t, anchor, r, r.distance) : formatDistance(r.distance)) : null;
  // An unnamed point already shows its kind as the title.
  const lines = [
    [r.name ? kindLabel(t, r.kind) : null, r.context].filter(Boolean).join(' · '),
    r.travel ? `${formatDuration(r.travel.seconds)} · ${formatDistance(r.travel.meters)} · ${t(`map.mode.${r.travel.costing}`)}` : away,
    r.emergency === 1 ? t('maps:place.emergencyYes') : null,
    r.hours ? t('maps:place.hours', { hours: r.hours }) : null,
    r.phone,
  ].filter(Boolean);
  const action =
    call && r.phone ? (
      <IconButton testID="map-answer-call" icon={Phone} size={36} color={colors.accent} accessibilityLabel={t('map.callPlace', { name })} onPress={() => callPhones(r.phone!)} />
    ) : (
      <IconButton testID="map-answer-go" icon={Navigation} size={36} color={colors.accent} accessibilityLabel={t('map.goPlace', { name })} onPress={() => goTo(r, name, costing, anchor.here ? anchor : null)} />
    );
  return (
    <ListRow
      testID={testID}
      leading={<IconBadge icon={kindIcon(r.kind, 'poi')} color={kindColor(r.kind)} />}
      title={name}
      subtitle={lines.join('\n')}
      subtitleLines={5}
      onPress={() => openOnMap(r)}
      accessibilityHint={t('map.openHint')}
      trailingAction={action}
    />
  );
}

function kindsLabel(t: TFunction, kinds: string[]) {
  return kinds.map((k) => kindLabel(t, k)).join(', ');
}

// ---------------------------------------------------------------------------
// The card

export function MapAnswerCard({ card, messageId }: { card: MapCard; messageId?: string }) {
  const { t } = useTranslation('assistant');
  const kinds = (ks: string[]) => kindsLabel(t, ks);

  switch (card.type) {
    case 'places': {
      const first = card.results[0];
      const firstName = first.name || kindLabel(t, first.kind);
      const title = card.go
        ? t('map.goTitle', { kinds: kinds(card.kinds) })
        : card.anchor.here
          ? t('map.nearHere', { kinds: kinds(card.kinds) })
          : t('map.nearPlace', { kinds: kinds(card.kinds), place: card.anchor.name });
      return (
        <View style={styles.card} testID="map-answer">
          <Text variant="headline">{title}</Text>
          {card.go ? (
            <Button
              testID="map-answer-go-first"
              title={first.travel ? t('map.goFirstTime', { name: firstName, duration: formatDuration(first.travel.seconds) }) : t('map.goFirst', { name: firstName })}
              icon={Navigation}
              variant="accent"
              onPress={() => goTo(first, firstName, card.costing, card.anchor.here ? card.anchor : null)}
            />
          ) : null}
          {card.call && !card.results.some((r) => r.phone) ? <Footnote>{t('map.noPhones')}</Footnote> : null}
          <ListGroup>
            {card.results.map((r, i) => (
              <ResultRow key={`${r.osmId ?? i}`} r={r} anchor={card.anchor} call={card.call} costing={card.costing} testID="map-answer-row" />
            ))}
          </ListGroup>
          {card.go && !card.results.some((r) => r.travel) ? <Footnote>{t('map.straightOrder')}</Footnote> : null}
          {card.onDuty && card.kinds.includes('pharmacy') ? <Footnote>{t('map.onDutyNote')}</Footnote> : null}
          {card.open ? <Footnote>{t('map.hoursNote')}</Footnote> : null}
          <Footnote>{card.pointsAt ? t('map.pointsFrom', { date: formatRelativeDate(card.pointsAt) }) : t('map.pointsTiles')}</Footnote>
        </View>
      );
    }

    case 'route': {
      const toName = card.to.name || kindLabel(t, card.to.kind);
      return (
        <Card style={styles.card} testID="map-answer">
          <Text variant="overline" color="textSecondary">
            {t(`map.mode.${card.costing}`)}
          </Text>
          <Text variant="headline">{t('map.routeTitle', { from: card.from.name, to: toName })}</Text>
          {card.to.context ? <Footnote>{card.to.context}</Footnote> : null}
          {card.travel ? (
            <Text variant="title2" testID="map-answer-travel">
              {`${formatDuration(card.travel.seconds)} · ${formatDistance(card.travel.meters)}`}
            </Text>
          ) : (
            <>
              <Text variant="title2">{formatDistance(card.straight)}</Text>
              <Footnote>{t('map.straightOnly')}</Footnote>
            </>
          )}
          <View style={styles.buttons}>
            {card.from.here ? (
              <Button testID="map-answer-go-first" title={t('map.goThere')} icon={Navigation} variant="accent" onPress={() => goTo(card.to, toName, card.costing, card.from)} />
            ) : (
              <Footnote>{t('map.fromElsewhere')}</Footnote>
            )}
            <Button testID="map-answer-open" title={t('map.seeOnMap')} icon={MapPin} variant="secondary" onPress={() => openBoundsOnMap(card.from, card.to)} />
          </View>
        </Card>
      );
    }

    case 'place': {
      const name = card.place.name || kindLabel(t, card.place.kind);
      return (
        <View style={styles.card} testID="map-answer">
          <ListGroup>
            <ResultRow r={card.place} anchor={card.from ?? { name: '', here: false, lat: card.place.lat, lon: card.place.lon }} testID="map-answer-row" />
          </ListGroup>
          <View style={styles.buttons}>
            <Button testID="map-answer-open" title={t('map.seeOnMap')} icon={MapPin} variant="secondary" onPress={() => openOnMap(card.place)} />
            <Button title={t('map.goThere')} icon={Navigation} variant="secondary" onPress={() => goTo(card.place, name, undefined, card.from)} />
          </View>
        </View>
      );
    }

    case 'here': {
      const utm = toUtm(card.fix.lat, card.fix.lon);
      return (
        <Card style={styles.card} testID="map-answer">
          <Text variant="overline" color="textSecondary">
            {card.forCall ? t('map.forCallTitle') : t('map.hereTitle')}
          </Text>
          {card.forCall ? <Footnote>{t('map.forCallIntro')}</Footnote> : null}
          {card.locality ? (
            <Text variant="title3" testID="map-answer-locality">
              {card.locality}
            </Text>
          ) : null}
          {card.landmark ? <Text variant="callout">{t('map.landmark', { distance: formatDistance(card.landmark.distance ?? 0), name: card.landmark.name })}</Text> : null}
          <Text variant="callout" selectable tabular>
            {formatLatLon(card.fix.lat, card.fix.lon)}
          </Text>
          {utm ? (
            <Text variant="callout" selectable tabular>
              {`UTM ${formatUtm(utm)}`}
            </Text>
          ) : null}
          <Footnote>
            {[card.fix.accuracy ? t('map.accuracy', { distance: formatDistance(card.fix.accuracy, 1) }) : null, card.stale ? t('map.fixAge', { age: formatRelativeDate(card.fix.at) }) : null]
              .filter(Boolean)
              .join(' · ')}
          </Footnote>
          <View style={styles.buttons}>
            <Button testID="map-answer-emergency" title={t('maps:place.callNumber', { number: card.number })} icon={Phone} variant="danger" onPress={() => callPhones(card.number)} />
            <Button testID="map-answer-share" title={t('map.share')} icon={Share2} variant="secondary" onPress={() => shareLocation(card.fix)} />
          </View>
          {card.forCall ? <Footnote>{t('map.amlNote')}</Footnote> : null}
        </Card>
      );
    }

    case 'share':
      return (
        <Card style={styles.card} testID="map-answer">
          <Text variant="headline">{card.contact ? t('map.shareTo', { name: card.contact.name }) : t('map.shareTitle')}</Text>
          <Text variant="callout" tabular selectable>
            {formatLatLon(card.fix.lat, card.fix.lon)}
          </Text>
          {card.wanted && !card.contact ? <Footnote>{t('map.noContact', { name: card.wanted })}</Footnote> : null}
          <View style={styles.buttons}>
            <Button
              testID="map-answer-sms"
              title={card.contact ? t('map.smsTo', { name: card.contact.name }) : t('map.sms')}
              icon={MessageSquare}
              variant="accent"
              onPress={() => smsLocation(card.fix, card.contact?.phone)}
            />
            <Button testID="map-answer-share" title={t('map.share')} icon={Share2} variant="secondary" onPress={() => shareLocation(card.fix)} />
          </View>
          <Footnote>{t('map.smsNote')}</Footnote>
        </Card>
      );

    case 'emergency':
      return (
        <View style={styles.card} testID="map-answer">
          <Button testID="map-answer-emergency" title={t('maps:place.callNumber', { number: card.number })} icon={Phone} variant="danger" size="lg" onPress={() => callPhones(card.number)} />
        </View>
      );

    case 'choose':
      return (
        <View style={styles.card} testID="map-answer">
          <Text variant="headline">{t('map.chooseTitle', { query: card.query })}</Text>
          <View style={styles.chips}>
            {card.options.map((o, i) => (
              <Chip
                key={`${o.lat},${o.lon}`}
                testID="map-answer-option"
                icon={MapPin}
                label={o.context && o.context !== o.name ? `${o.name} · ${o.context}` : o.name}
                onPress={() => messageId && chooseMapOption(messageId, i)}
              />
            ))}
          </View>
        </View>
      );

    case 'missing': {
      const action =
        card.reason === 'noLocation' ? (
          <Button title={t('maps:location.openSettings')} icon={Crosshair} variant="secondary" size="sm" onPress={() => Linking.openSettings()} />
        ) : card.reason === 'noIndex' || card.reason === 'noPoints' ? (
          <Button testID="map-answer-maps" title={t('map.openMaps')} icon={MapPin} variant="secondary" size="sm" onPress={() => router.navigate('/maps/regions')} />
        ) : null;
      return (
        <View style={styles.card} testID="map-answer">
          <Text variant="callout">{t(`map.missing.${card.reason}`, { query: card.query ?? '', kinds: card.kinds ? kinds(card.kinds) : '' })}</Text>
          {action ? <View style={styles.buttons}>{action}</View> : null}
        </View>
      );
    }
  }
}

const styles = StyleSheet.create({
  card: { gap: space.sm },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, alignItems: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
