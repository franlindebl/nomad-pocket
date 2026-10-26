import { router, useLocalSearchParams } from 'expo-router';
import { AlertTriangle, Check, WifiOff } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Button, Card, Row, Text } from '@/components/ui';
import { NotEnoughStorageError } from '@/features/downloads/manager';
import { downloadCountry, useCatalogsState, useCountryOffer, useCountrySize } from '@/features/maps/countries';
import { formatBytes } from '@/lib/format';
import { freeBytes, hasRoomFor } from '@/lib/storage';
import { space, useTheme } from '@/theme';

/** One line of what the country download brings (or, with `missing`, what it can't yet). */
function Includes({ title, body, missing }: { title: string; body: string; missing?: boolean }) {
  const { colors } = useTheme();
  return (
    <Row gap={space.md} align="flex-start">
      {missing ? <AlertTriangle size={20} color={colors.warning} /> : <Check size={20} color={colors.success} />}
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="headline">{title}</Text>
        <Text variant="footnote" color="textSecondary">
          {body}
        </Text>
      </View>
    </Row>
  );
}

/**
 * One country, everything in it: the map at full detail, offline navigation where a
 * pack exists, emergency points and street names (docs/UX_SURVIVAL_PLAN.md).
 */
export default function CountryDownloadSheet() {
  const { t } = useTranslation('maps');
  const { colors } = useTheme();
  const { regionId, from } = useLocalSearchParams<{ regionId?: string; from?: string }>();
  const offer = useCountryOffer(regionId);
  const size = useCountrySize(offer);
  const catalogs = useCatalogsState();
  const [error, setError] = useState<string | null>(null);

  if (!offer) return null;
  const total = size.status === 'ready' ? size.bytes : null;
  // Room for the download plus its assembly copies and the rest of the queue (planCountry).
  const needed = size.status === 'ready' ? size.needed : null;
  const enough = needed === null || hasRoomFor(needed);
  const failed = size.status === 'offline' || size.status === 'error' ? size : null;
  const loading = size.status === 'loading';
  const zoom = offer.map?.maxZoom ?? offer.fallbackZoom;

  const start = () => {
    try {
      downloadCountry(offer, size.status === 'ready' ? size.estimate : undefined);
      // From the picker: back to the list of maps, where its progress shows.
      if (from === 'pick') router.dismissTo('/maps/regions');
      else router.back();
    } catch (e) {
      if (e instanceof NotEnoughStorageError) setError(t('common:storage.notEnough', { needed: formatBytes(e.needed), free: formatBytes(freeBytes()) }));
      else setError(String((e as Error)?.message ?? e));
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.bg, paddingBottom: space.xl }]}>
      <Text variant="title2" align="center" numberOfLines={2}>
        {offer.title}
      </Text>

      <Card style={{ gap: space.lg }}>
        <Includes title={t('country.map')} body={zoom >= 15 ? t('country.mapFull') : t('country.mapReduced')} />
        {/* Without the catalog, a missing pack only means "couldn't check". */}
        <Includes
          title={t('country.routing')}
          body={offer.pack ? t('country.routingBody') : catalogs === 'ready' ? t('country.routingMissing') : t('country.routingUnknown')}
          missing={!offer.pack && catalogs === 'ready'}
        />
        <Includes title={t('country.points')} body={t('country.pointsBody')} />
      </Card>

      <Card style={{ gap: space.xs }}>
        <Text variant="overline" color="textSecondary">
          {t('download.size')}
        </Text>
        {loading ? (
          <Row gap={space.sm} style={{ minHeight: 40 }}>
            <ActivityIndicator color={colors.textSecondary} />
            <Text variant="callout" color="textSecondary">
              {t('download.estimating')}
            </Text>
          </Row>
        ) : failed ? (
          <Row gap={space.sm} align="flex-start">
            {failed.status === 'offline' ? <WifiOff size={18} color={colors.warning} /> : <AlertTriangle size={18} color={colors.warning} />}
            <View style={{ flex: 1, gap: space.sm }}>
              <Text variant="callout" color="textSecondary">
                {failed.status === 'offline' ? t('download.offline') : t('download.estimateFailed', { error: failed.status === 'error' ? failed.message : '' })}
              </Text>
              <Button testID="country-retry-size" title={t('regions.retry')} variant="secondary" size="sm" style={{ alignSelf: 'flex-start' }} onPress={size.retry} />
            </View>
          </Row>
        ) : total !== null ? (
          <>
            <Text variant="title1" tabular testID="country-size">
              {formatBytes(total)}
            </Text>
            <Text variant="footnote" color="textSecondary" tabular>
              {t('download.free', { size: formatBytes(freeBytes()) })}
            </Text>
          </>
        ) : null}
      </Card>

      {!enough && needed !== null ? (
        <Text variant="footnote" color="danger">
          {t('download.notEnough', { needed: formatBytes(needed), free: formatBytes(freeBytes()) })}
        </Text>
      ) : null}
      {error ? (
        <Text variant="footnote" color="danger">
          {error}
        </Text>
      ) : null}

      <Button
        testID="country-download"
        title={total !== null ? t('download.action', { size: formatBytes(total) }) : t('common:actions.download')}
        disabled={loading || !!failed || total === null || !enough}
        onPress={start}
        size="lg"
        fullWidth
      />
      <Text variant="caption" color="textTertiary" align="center">
        {t('country.wifiHint')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { paddingHorizontal: space.gutter, paddingTop: space.xl, gap: space.lg },
});
