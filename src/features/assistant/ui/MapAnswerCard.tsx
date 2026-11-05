// A map answer in the chat (docs/ASSISTANT_MAP_PLAN.md): places near somewhere, the nearest one by travel
// time, a route, where the person is, sharing it, the emergency number, "which one?" and "not found".
// Every action is the person's tap (call, share, navigate) and opens what the Maps tab already has.
import { router } from 'expo-router';
import type { TFunction } from 'i18next';
import { BookOpen, Check, Crosshair, Download, MapPin, MessageSquare, Navigation, Phone, Route as RouteIcon, Save, Settings, Share2, ShieldAlert, Sunset } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, StyleSheet, View } from 'react-native';

import { showToast } from '@/components/Toast';
import { Badge, Button, Card, Chip, IconBadge, IconButton, ListGroup, ListRow, Text } from '@/components/ui';
import { callPhones } from '@/features/maps/call';
import { compassSector, formatLatLon, formatUtm, toUtm, type LatLon } from '@/features/maps/geo';
import { addMarker } from '@/features/maps/markers';
import { TowardArrow } from '@/features/maps/TowardArrow';
import { startGuidance, useGuidance } from '@/features/maps/guidance';
import { distanceWithDirection, kindColor, kindIcon, kindLabel } from '@/features/maps/labels';
import type { Costing } from '@/features/maps/routing-core';
import { ringPairs } from '@/features/maps/along-core';
import { previewRoute } from '@/features/maps/route-preview';
import { shareLocation, smsLocation } from '@/features/maps/share-location';
import { useMapUi, type SelectedPlace } from '@/features/maps/store';
import { formatDistance, formatDuration, formatRelativeDate } from '@/lib/format';
import { space, useTheme } from '@/theme';

import { chooseMapOption } from '../chats';
import { clock, type MapAnchor, type MapCard, type MapResult } from '../map-answer';

/** Closer than this to the nearest town's centre, you're in it: the lost card shows no arrow to it. */
const TOWN_INSIDE_M = 1500;

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

/** A trip that doesn't start here, drawn on the Maps tab (route-preview.ts; navigation only ever starts from here). */
function previewOnMap(from: MapAnchor, to: MapResult, toName: string, costing: Costing) {
  useMapUi.getState().select(null);
  void previewRoute({ name: from.name, lat: from.lat, lon: from.lon }, { name: toName, lat: to.lat, lon: to.lon }, costing);
  // A hidden tab's map ignores camera moves: both ends framed once it's on screen (the route frames itself when it lands).
  openBoundsOnMap(from, to);
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
    r.openNow === 'open' ? t('map.openNow') : r.openNow === 'closed' ? t('map.closedNow') : null,
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
            <Button
              testID="map-answer-open"
              title={card.from.here ? t('map.seeOnMap') : t('map.seeRoute')}
              icon={MapPin}
              variant={card.from.here ? 'secondary' : 'accent'}
              onPress={() => (card.from.here ? openBoundsOnMap(card.from, card.to) : previewOnMap(card.from, card.to, toName, card.costing))}
            />
          </View>
        </Card>
      );
    }

    case 'place': {
      const name = card.place.name || kindLabel(t, card.place.kind);
      const utm = toUtm(card.place.lat, card.place.lon);
      return (
        <View style={styles.card} testID="map-answer">
          <ListGroup>
            <ResultRow r={card.place} anchor={card.from ?? { name: '', here: false, lat: card.place.lat, lon: card.place.lon }} testID="map-answer-row" />
          </ListGroup>
          <Text variant="callout" selectable tabular testID="map-answer-coords">
            {`${formatLatLon(card.place.lat, card.place.lon)}${utm ? `\nUTM ${formatUtm(utm)}` : ''}`}
          </Text>
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
          {card.lost ? (
            <>
              {/* The guide's advice comes first (lost-at-nightfall): stay put, call; the town is a fact, not a destination. */}
              <Text variant="headline" testID="map-answer-lost">
                {t('map.lostAdvice', { number: card.number })}
              </Text>
              <Button
                title={t('map.lostGuide')}
                icon={BookOpen}
                variant="secondary"
                size="sm"
                onPress={() => router.push({ pathname: '/guide/[id]', params: { id: 'lost-at-nightfall' } })}
              />
            </>
          ) : null}
          <Text variant="overline" color="textSecondary">
            {card.forCall ? t('map.forCallTitle', { number: card.number }) : t('map.hereTitle')}
          </Text>
          {card.forCall && !card.lost ? <Footnote>{t('map.forCallIntro')}</Footnote> : null}
          {/* Lost out of any town, the nearest town's name isn't "where you are": the arrow line below says how far. */}
          {card.locality && !(card.lost?.town && (card.lost.town.distance ?? 0) > TOWN_INSIDE_M) ? (
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
          {/* In the town (within ~1.5 km of its centre) the locality line says it all; out of it, which way it is. */}
          {card.lost?.town && (card.lost.town.distance ?? 0) > TOWN_INSIDE_M ? (
            <TowardArrow
              testID="map-answer-town"
              bearing={card.lost.town.bearing}
              label={t('map.nearestTown', {
                name: card.lost.town.name,
                distance: formatDistance(card.lost.town.distance ?? 0),
                dir: t(`maps:dir.${compassSector(card.lost.town.bearing)}`),
              })}
            />
          ) : null}
          {card.lost ? <SunLines sun={card.lost.sun} /> : null}
          {card.forCall ? <Footnote>{t('map.amlNote', { number: card.number })}</Footnote> : null}
        </Card>
      );
    }

    case 'save':
      return <SaveCard name={card.name} fix={card.fix} />;

    case 'meeting':
      return (
        <View style={styles.card} testID="map-answer">
          <Text variant="headline">{t('map.meetingTitle')}</Text>
          <ListGroup>
            {card.points.map((p) => {
              const located = p.lat != null && p.lon != null;
              const at: MapResult = { name: p.place, kind: 'marker', lat: p.lat ?? 0, lon: p.lon ?? 0, context: p.details || null, distance: p.distance };
              return (
                <ListRow
                  key={p.slot}
                  testID="map-answer-row"
                  leading={<IconBadge icon={MapPin} hue="survival" />}
                  title={p.place || t(`prepare:meeting.${p.slot}`)}
                  subtitle={[t(`prepare:meeting.${p.slot}`), p.details, p.distance != null ? formatDistance(p.distance) : null].filter(Boolean).join('\n')}
                  subtitleLines={4}
                  onPress={located ? () => openOnMap(at) : () => router.push({ pathname: '/prepare/meeting', params: { slot: p.slot } })}
                  trailingAction={
                    located ? (
                      <IconButton testID="map-answer-go" icon={Navigation} size={36} accessibilityLabel={t('map.goPlace', { name: p.place })} onPress={() => goTo(at, p.place, 'pedestrian', card.from)} />
                    ) : undefined
                  }
                />
              );
            })}
          </ListGroup>
          {card.points.some((p) => p.lat == null) ? <Footnote>{t('map.meetingNoPin')}</Footnote> : null}
        </View>
      );

    case 'sun': {
      const late = card.arrival && card.sun.dusk ? card.arrival > card.sun.dusk : false;
      const tight = card.arrival && card.sun.sunset && !late ? card.arrival > card.sun.sunset : false;
      return (
        <Card style={styles.card} testID="map-answer">
          {card.to ? <Text variant="headline">{card.to.name}</Text> : null}
          {card.to && card.arrival ? (
            <Text variant="title3" testID="map-answer-arrival">
              {t('map.arrival', { name: card.to.name, time: clock(card.arrival) })}
            </Text>
          ) : null}
          {card.to && card.arrival ? (
            <Badge
              label={late ? t('map.afterDark') : tight ? t('map.afterSunset') : t('map.beforeDark')}
              tone={late ? 'danger' : tight ? 'warning' : 'success'}
              icon={Sunset}
            />
          ) : null}
          {card.to && !card.travel ? <Footnote>{t('map.noRouteForArrival', { distance: formatDistance(card.to.distance ?? 0) })}</Footnote> : null}
          <SunLines sun={card.sun} />
          {!card.anchor.here ? <Footnote>{t('map.sunAtMapCentre')}</Footnote> : null}
          {card.to && card.travel ? (
            <View style={styles.buttons}>
              <Button title={t('map.goThere')} icon={Navigation} variant="secondary" onPress={() => goTo(card.to!, card.to!.name, card.travel?.costing, card.anchor)} />
            </View>
          ) : null}
        </Card>
      );
    }

    case 'along':
      return (
        <View style={styles.card} testID="map-answer">
          <Text variant="headline">{t('map.alongTitle', { kinds: kinds(card.kinds), to: card.to })}</Text>
          {card.range ? (
            <Text variant="callout" testID="map-answer-range">
              {card.range.lastId
                ? t('map.rangeLast', {
                    km: card.range.km,
                    name: card.results.find((r) => r.osmId === card.range!.lastId)?.name || kindLabel(t, card.kinds[0]),
                    distance: formatDistance(card.results.find((r) => r.osmId === card.range!.lastId)?.alongM ?? 0),
                  })
                : t('map.rangeNone', { km: card.range.km })}
            </Text>
          ) : null}
          {card.results.length ? (
            <ListGroup>
              {card.results.map((r, i) => (
                <ListRow
                  key={`${r.osmId ?? i}`}
                  testID="map-answer-row"
                  leading={<IconBadge icon={kindIcon(r.kind, 'poi')} color={kindColor(r.kind)} />}
                  title={r.name || kindLabel(t, r.kind)}
                  subtitle={[
                    t('map.alongAt', { distance: formatDistance(r.alongM) }),
                    t('map.alongOff', { distance: formatDistance(r.offM) }),
                    card.range && r.alongM > card.range.km * 1000 ? t('map.beyondRange') : null,
                    r.context,
                    r.hours ? t('maps:place.hours', { hours: r.hours }) : null,
                  ]
                    .filter(Boolean)
                    .join('\n')}
                  subtitleLines={5}
                  onPress={() => openOnMap(r)}
                />
              ))}
            </ListGroup>
          ) : (
            <Text variant="callout">{t('map.alongNone', { kinds: kinds(card.kinds) })}</Text>
          )}
          <Footnote>{t('map.alongTotal', { distance: formatDistance(card.routeM) })}</Footnote>
        </View>
      );

    case 'routeAlerts':
      return (
        <Card style={styles.card} testID="map-answer">
          {!card.enabled ? (
            <Text variant="callout">{t('map.alertsOff')}</Text>
          ) : card.crossing.length ? (
            <>
              <Text variant="headline">{t('map.routeAlertsTitle', { to: card.to })}</Text>
              {card.crossing.map((a) => (
                <ListRow
                  key={a.key}
                  testID="map-answer-row"
                  leading={<IconBadge icon={ShieldAlert} hue="survival" />}
                  title={a.title}
                  subtitle={`${t('map.alongAt', { distance: formatDistance(a.atM) })}\n${a.subtitle}`}
                  subtitleLines={3}
                  onPress={() => router.push({ pathname: '/alerts/[id]', params: { id: a.key } })}
                  chevron
                />
              ))}
              <View style={styles.buttons}>
                <Button
                  testID="map-answer-avoid"
                  title={t('map.avoidRoute')}
                  icon={RouteIcon}
                  variant="accent"
                  onPress={() => {
                    useMapUi.getState().select(null);
                    void previewRoute(
                      { name: card.from.name, lat: card.from.lat, lon: card.from.lon },
                      { name: card.to, lat: card.dest.lat, lon: card.dest.lon },
                      card.costing,
                      card.crossing.flatMap((x) => x.rings.map(ringPairs)),
                    );
                    openBoundsOnMap(card.from, card.dest);
                  }}
                />
              </View>
              <Footnote>{t('map.avoidNote')}</Footnote>
            </>
          ) : (
            <Text variant="callout" testID="map-answer-no-alerts">
              {t('map.routeAlertsNone', { to: card.to })}
            </Text>
          )}
          {card.enabled && card.undrawn ? <Footnote>{t('map.routeAlertsUndrawn', { count: card.undrawn })}</Footnote> : null}
        </Card>
      );

    case 'evacuate':
      return (
        <Card style={styles.card} testID="map-answer">
          {!card.enabled ? (
            <Text variant="callout">{t('map.alertsOff')}</Text>
          ) : !card.alerts.length ? (
            <Text variant="callout" testID="map-answer-no-alerts">
              {t('map.evacuateNone')}
            </Text>
          ) : (
            <>
              {/* The official instruction first: the authorities may say to stay inside, or where to go. */}
              {card.alerts.map((a) => (
                <View key={a.key} style={{ gap: space.xs }}>
                  <Text variant="headline">{a.title}</Text>
                  {a.instruction ? <Text variant="callout">{a.instruction}</Text> : null}
                </View>
              ))}
              <Footnote>{t('map.evacuateNote')}</Footnote>
              {card.results.length ? (
                <ListGroup>
                  {card.results.map((r, i) => (
                    <ResultRow key={`${r.osmId ?? i}`} r={r} anchor={{ name: '', here: true, lat: r.lat, lon: r.lon }} costing={card.costing} testID="map-answer-row" />
                  ))}
                </ListGroup>
              ) : (
                <Text variant="callout">{t('map.evacuateNoPlace')}</Text>
              )}
            </>
          )}
        </Card>
      );

    case 'trip':
      return (
        <Card style={styles.card} testID="map-answer">
          <Text variant="headline">{t('map.tripTitle', { name: card.region.name })}</Text>
          <Text variant="callout" testID="map-answer-trip-map">
            {card.downloading ? t('map.tripDownloading') : card.map ? (card.routing ? t('map.tripMapYes') : t('map.tripMapNoRoutes')) : t('map.tripMapNo')}
          </Text>
          {card.number ? <Text variant="callout">{t('map.tripNumber', { number: card.number })}</Text> : null}
          {card.home && card.map ? (
            card.embassies.length ? (
              <ListGroup>
                {card.embassies.map((r, i) => (
                  <ResultRow key={`${r.osmId ?? i}`} r={r} anchor={{ name: '', here: false, lat: r.lat, lon: r.lon }} testID="map-answer-row" />
                ))}
              </ListGroup>
            ) : (
              <Footnote>{t('map.tripNoEmbassy', { home: card.home })}</Footnote>
            )
          ) : null}
          {!card.map && !card.downloading ? (
            <View style={styles.buttons}>
              <Button
                testID="map-answer-download"
                title={t('map.tripDownload', { name: card.region.name })}
                icon={Download}
                variant="accent"
                onPress={() => router.push({ pathname: '/maps/download', params: { regionId: card.region.id } })}
              />
            </View>
          ) : null}
          <Footnote>{t('map.tripNote')}</Footnote>
        </Card>
      );

    case 'alerts':
      return (
        <View style={styles.card} testID="map-answer">
          {!card.enabled ? (
            <>
              <Text variant="callout">{t('map.alertsOff')}</Text>
              <View style={styles.buttons}>
                <Button title={t('map.alertsTurnOn')} icon={Settings} variant="secondary" size="sm" onPress={() => router.push('/settings/alerts')} />
              </View>
            </>
          ) : card.items.length ? (
            <>
              <Text variant="headline">{card.place ? t('map.alertsIn', { place: card.place }) : t('map.alertsTitle')}</Text>
              <ListGroup>
                {card.items.map((a) => (
                  <ListRow
                    key={a.key}
                    testID="map-answer-row"
                    leading={<IconBadge icon={ShieldAlert} hue="survival" />}
                    title={a.title}
                    subtitle={a.subtitle}
                    onPress={() => router.push({ pathname: '/alerts/[id]', params: { id: a.key } })}
                    chevron
                  />
                ))}
              </ListGroup>
            </>
          ) : (
            <Text variant="callout" testID="map-answer-no-alerts">
              {card.quakes ? t('map.noQuakes') : t('map.noAlerts')}
            </Text>
          )}
          {card.enabled ? <Footnote>{card.checkedAt ? t('map.alertsChecked', { date: formatRelativeDate(card.checkedAt) }) : t('map.alertsNeverChecked')}</Footnote> : null}
        </View>
      );

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

    case 'chips':
      return (
        <View style={styles.chips} testID="map-answer-chips">
          {card.places.map((p) => (
            <Chip key={`${p.lat},${p.lon}`} testID="map-answer-chip" icon={MapPin} label={t('map.chip', { name: p.name })} onPress={() => openOnMap(p)} />
          ))}
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
        ) : card.reason === 'noMeeting' ? (
          <Button title={t('map.setMeeting')} icon={MapPin} variant="secondary" size="sm" onPress={() => router.push('/prepare/plan')} />
        ) : card.reason === 'noIndex' || card.reason === 'noPoints' ? (
          <Button testID="map-answer-maps" title={t('map.openMaps')} icon={MapPin} variant="secondary" size="sm" onPress={() => router.navigate('/maps/regions')} />
        ) : null;
      return (
        <View style={styles.card} testID="map-answer">
          <Text variant="callout">
            {t(`map.missing.${card.reason}`, { query: card.query ?? '', kinds: card.kinds ? kinds(card.kinds) : '', names: (card.names ?? []).join(', ') })}
          </Text>
          {card.reason === 'noSaved' && card.names?.length ? <Footnote>{t('map.savedList', { names: card.names.join(', ') })}</Footnote> : null}
          {action ? <View style={styles.buttons}>{action}</View> : null}
        </View>
      );
    }
  }
}

/** Today's light: sunset and the end of civil twilight (or "the sun doesn't set" in a polar summer). */
function SunLines({ sun }: { sun: { sunset: number | null; dusk: number | null; sunrise: number | null } }) {
  const { t } = useTranslation('assistant');
  return (
    <View testID="map-answer-sun">
      <Text variant="callout">{sun.sunset ? t('map.sunset', { time: clock(sun.sunset) }) : t('map.noSunset')}</Text>
      {sun.dusk ? <Footnote>{t('map.dusk', { time: clock(sun.dusk) })}</Footnote> : null}
    </View>
  );
}

/** "Guarda dónde estoy como el coche": a pin made only on the person's tap. */
function SaveCard({ name, fix }: { name: string; fix: { lat: number; lon: number } }) {
  const { t } = useTranslation('assistant');
  const [saved, setSaved] = useState(false);
  const save = () => {
    addMarker({ name, lat: fix.lat, lon: fix.lon });
    setSaved(true);
    showToast(t('map.saved', { name }));
  };
  return (
    <Card style={styles.card} testID="map-answer">
      <Text variant="headline">{t('map.saveTitle', { name })}</Text>
      <Text variant="callout" tabular selectable>
        {formatLatLon(fix.lat, fix.lon)}
      </Text>
      <View style={styles.buttons}>
        <Button testID="map-answer-save" title={saved ? t('map.savedButton') : t('map.save')} icon={saved ? Check : Save} variant="accent" disabled={saved} onPress={save} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.sm },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, alignItems: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
