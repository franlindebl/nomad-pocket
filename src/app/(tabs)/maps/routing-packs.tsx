import { Download, RefreshCw, Route as RouteIcon, Trash2 } from 'lucide-react-native';
import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from 'react-native';

import { Badge, Button, Card, IconBadge, IconButton, ListGroup, ListRow, Screen, SectionHeader, Text } from '@/components/ui';
import { removeItem, useItems } from '@/features/content/items';
import { NotEnoughStorageError } from '@/features/downloads/manager';
import { useGuidance } from '@/features/maps/guidance';
import { routePackId, type RoutePackItem } from '@/features/maps/routing';
import { packsCovering, type ManifestPack } from '@/features/maps/routing-core';
import { downloadPack, packTitle, refreshRoutingCatalog, usePackState, useRoutingCatalog } from '@/features/maps/routing-packs';
import { useMapUi } from '@/features/maps/store';
import { formatBytes } from '@/lib/format';
import { freeBytes } from '@/lib/storage';
import { space, useTheme } from '@/theme';

function dataDate(d: string, lang: string) {
  if (d.length !== 8) return d;
  return new Date(Number(d.slice(0, 4)), Number(d.slice(4, 6)) - 1, Number(d.slice(6, 8))).toLocaleDateString(lang, {
    month: 'short',
    year: 'numeric',
  });
}

function PackRow({ pack, installed }: { pack: ManifestPack; installed: boolean }) {
  const { t, i18n } = useTranslation('maps');
  const { progress, failed } = usePackState(pack);
  const manifest = useRoutingCatalog((s) => s.manifest);

  const start = () => {
    if (!manifest) return;
    try {
      downloadPack(manifest, pack);
    } catch (e) {
      if (e instanceof NotEnoughStorageError)
        Alert.alert(t('packs.title'), t('common:storage.notEnough', { needed: formatBytes(e.needed), free: formatBytes(freeBytes()) }));
      else throw e;
    }
  };

  return (
    <ListRow
      testID="pack-row"
      leading={<IconBadge icon={RouteIcon} hue="maps" />}
      title={packTitle(pack)}
      subtitle={t('packs.detail', { size: formatBytes(pack.size), date: dataDate(pack.buildDate, i18n.language) })}
      trailing={
        installed ? (
          <Badge label={t('common:status.installed')} tone="success" />
        ) : progress !== null ? (
          <Badge label={`${Math.round(progress * 100)} %`} tone="accent" />
        ) : failed ? (
          <Badge label={t('packs.failed')} tone="danger" />
        ) : undefined
      }
      trailingAction={
        installed || progress !== null ? undefined : (
          <IconButton
            testID={failed ? 'pack-retry' : 'pack-download'}
            icon={failed ? RefreshCw : Download}
            size={36}
            variant="plain"
            accessibilityLabel={failed ? t('packs.retry') : t('common:actions.download')}
            onPress={start}
          />
        )
      }
    />
  );
}

/** Offline routing packs: installed ones, the ones covering where you are or are going, and the rest. */
export default function RoutingPacksSheet() {
  const { t, i18n } = useTranslation('maps');
  const { colors } = useTheme();
  const manifest = useRoutingCatalog((s) => s.manifest);
  const status = useRoutingCatalog((s) => s.status);
  const installed = useItems('route') as RoutePackItem[];
  const target = useGuidance((s) => s.target);
  const position = useGuidance((s) => s.position);
  const viewport = useMapUi((s) => s.viewport);

  useEffect(() => {
    refreshRoutingCatalog();
  }, []);

  const near = target ?? position ?? (viewport ? { lat: viewport.center[1], lon: viewport.center[0] } : null);
  // Rounded, so GPS updates don't re-sort the list every couple of seconds.
  const nearLat = near ? Math.round(near.lat * 100) / 100 : null;
  const nearLon = near ? Math.round(near.lon * 100) / 100 : null;
  const installedIds = useMemo(() => new Set(installed.map((i) => i.id)), [installed]);
  const { nearby, others } = useMemo(() => {
    const packs = manifest?.packs ?? [];
    const close = nearLat !== null && nearLon !== null ? packsCovering(packs, { lat: nearLat, lon: nearLon }) : [];
    const ids = new Set(close.map((p) => p.id));
    const rest = packs.filter((p) => !ids.has(p.id)).sort((a, b) => packTitle(a).localeCompare(packTitle(b), i18n.language));
    return { nearby: close, others: rest };
  }, [manifest, nearLat, nearLon, i18n.language]);

  const confirmDelete = (item: RoutePackItem) =>
    Alert.alert(t('packs.deleteTitle', { name: item.title }), t('regions.deleteBody', { size: formatBytes(item.sizeBytes) }), [
      { text: t('common:actions.cancel'), style: 'cancel' },
      { text: t('common:actions.delete'), style: 'destructive', onPress: () => removeItem(item.id) },
    ]);

  return (
    <Screen contentStyle={{ paddingTop: space.lg }}>
      <Text variant="callout" color="textSecondary" style={{ paddingHorizontal: space.xs }}>
        {t('packs.intro')}
      </Text>
      {installed.length ? (
        <>
          <SectionHeader title={t('regions.installed')} />
          <ListGroup>
            {installed.map((item) => (
              <ListRow
                key={item.id}
                testID="pack-installed"
                leading={<IconBadge icon={RouteIcon} hue="maps" />}
                title={item.title}
                subtitle={t('packs.detail', { size: formatBytes(item.sizeBytes), date: dataDate(item.meta.buildDate, i18n.language) })}
                trailingAction={
                  <IconButton
                    testID="pack-delete"
                    icon={Trash2}
                    size={36}
                    variant="plain"
                    color={colors.danger}
                    accessibilityLabel={t('common:actions.delete')}
                    onPress={() => confirmDelete(item)}
                  />
                }
              />
            ))}
          </ListGroup>
        </>
      ) : null}
      {!manifest ? (
        <Card style={{ marginTop: space.lg, gap: space.md }}>
          <Text variant="callout" color="textSecondary">
            {status === 'loading' ? t('packs.loading') : t('packs.offline')}
          </Text>
          {status !== 'loading' ? (
            <Button testID="packs-retry" title={t('packs.retry')} icon={RefreshCw} variant="secondary" size="sm" onPress={refreshRoutingCatalog} />
          ) : null}
        </Card>
      ) : (
        <>
          {nearby.length ? (
            <>
              <SectionHeader title={t('packs.nearby')} />
              <ListGroup>
                {nearby.map((p) => (
                  <PackRow key={p.id} pack={p} installed={installedIds.has(routePackId(p.id))} />
                ))}
              </ListGroup>
            </>
          ) : null}
          {others.length ? (
            <>
              <SectionHeader title={t('packs.all')} />
              <ListGroup>
                {others.map((p) => (
                  <PackRow key={p.id} pack={p} installed={installedIds.has(routePackId(p.id))} />
                ))}
              </ListGroup>
            </>
          ) : null}
        </>
      )}
    </Screen>
  );
}
