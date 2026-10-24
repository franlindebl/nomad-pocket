import { router } from 'expo-router';
import { Crop, Globe, Map as MapIcon, Plus, Trash2 } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Alert } from 'react-native';

import { Badge, IconBadge, IconButton, ListGroup, ListRow, Screen, SectionHeader, Text } from '@/components/ui';
import { removeItem } from '@/features/content/items';
import { useActiveDownloads } from '@/features/downloads/manager';
import { mapItemId, WORLD_ID, WORLD_MAX_ZOOM } from '@/features/maps/extraction';
import { useMapUi } from '@/features/maps/store';
import { useMapItems, type MapItem } from '@/features/maps/useMapSources';
import { formatBytes } from '@/lib/format';
import { space, useTheme } from '@/theme';

function buildDate(d: string | undefined, lang: string) {
  if (!d || d.length !== 8) return '';
  const date = new Date(Number(d.slice(0, 4)), Number(d.slice(4, 6)) - 1, Number(d.slice(6, 8)));
  return date.toLocaleDateString(lang, { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function RegionsSheet() {
  const { t, i18n } = useTranslation('maps');
  const { colors } = useTheme();
  const { world, regions } = useMapItems();
  const jobs = useActiveDownloads().filter((d) => d.kind === 'map' && d.external && d.status !== 'done');
  const viewport = useMapUi((s) => s.viewport);
  const worldJob = jobs.find((j) => j.id === `job-${mapItemId(WORLD_ID)}`);

  const confirmDelete = (item: MapItem) =>
    Alert.alert(t('regions.deleteTitle', { name: item.title }), t('regions.deleteBody', { size: formatBytes(item.sizeBytes) }), [
      { text: t('common:actions.cancel'), style: 'cancel' },
      { text: t('common:actions.delete'), style: 'destructive', onPress: () => removeItem(item.id) },
    ]);

  const show = (item: MapItem) => {
    if (item.meta.bbox) useMapUi.getState().focus({ bounds: item.meta.bbox });
    router.back();
  };

  return (
    <Screen contentStyle={{ paddingTop: space.lg }}>
      <ListGroup>
        <ListRow
          leading={<IconBadge icon={Globe} hue="maps" />}
          title={t('regions.world')}
          subtitle={
            world
              ? t('regions.detail', { zoom: world.meta.maxZoom, size: formatBytes(world.sizeBytes), date: buildDate(world.meta.buildDate, i18n.language) })
              : t('regions.worldBody', { zoom: WORLD_MAX_ZOOM })
          }
          trailing={
            world ? (
              <Badge label={t('common:status.installed')} tone="success" />
            ) : worldJob ? (
              <Badge label={t('regions.downloading')} tone="accent" />
            ) : (
              <Badge label={t('common:actions.download')} tone="neutral" />
            )
          }
          onPress={world || worldJob ? undefined : () => router.push({ pathname: '/maps/download', params: { key: WORLD_ID } })}
        />
        <ListRow
          leading={<IconBadge icon={Crop} hue="maps" />}
          title={t('regions.visibleArea')}
          subtitle={t('regions.visibleAreaBody')}
          chevron
          onPress={viewport ? () => router.push({ pathname: '/maps/download', params: { bbox: viewport.bounds.join(',') } }) : undefined}
        />
        <ListRow
          leading={<IconBadge icon={Plus} hue="maps" />}
          title={t('regions.addRegion')}
          subtitle={t('regions.addRegionBody')}
          chevron
          onPress={() => router.push('/maps/pick')}
        />
      </ListGroup>

      <SectionHeader title={t('regions.installed')} />
      {regions.length || jobs.some((j) => j !== worldJob) ? (
        <ListGroup>
          {jobs
            .filter((j) => j !== worldJob)
            .map((j) => (
              <ListRow
                key={j.id}
                leading={<IconBadge icon={MapIcon} hue="maps" />}
                title={j.title}
                subtitle={j.totalBytes ? `${formatBytes(j.bytesWritten)} / ${formatBytes(j.totalBytes)}` : t('regions.downloading')}
                onPress={() => router.push('/downloads')}
                chevron
              />
            ))}
          {regions.map((item) => (
            <ListRow
              key={item.id}
              leading={<IconBadge icon={MapIcon} hue="maps" />}
              title={item.title}
              subtitle={t('regions.detail', { zoom: item.meta.maxZoom, size: formatBytes(item.sizeBytes), date: buildDate(item.meta.buildDate, i18n.language) })}
              onPress={() => show(item)}
              trailingAction={<IconButton testID="region-delete" icon={Trash2} size={36} variant="plain" color={colors.danger} accessibilityLabel={t('common:actions.delete')} onPress={() => confirmDelete(item)} />}
            />
          ))}
        </ListGroup>
      ) : (
        <Text variant="callout" color="textSecondary" style={{ paddingHorizontal: space.xs }}>
          {t('regions.none')}
        </Text>
      )}
    </Screen>
  );
}
