// An archive on the phone, as the Library's collections list it: opens in the reader; a long press shares
// it with another phone or deletes it. Says when a newer edition is out.
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Alert, StyleSheet } from 'react-native';

import { IconBadge, ListRow } from '@/components/ui';
import { categoryHue, iconByName } from '@/features/catalog/icons';
import { removeItem, type InstalledItem } from '@/features/content/items';
import { useUpdates } from '@/features/updates/updates';
import { formatBytes } from '@/lib/format';
import { radius, useTheme } from '@/theme';

import { shareArchive } from '../share';

export function ArchiveRow({ item }: { item: InstalledItem }) {
  const { t } = useTranslation('library');
  const { t: tc } = useTranslation();
  const { colors } = useTheme();
  const outdated = useUpdates().some((u) => u.kind === 'zim' && !u.inFlight && u.itemId === item.id);
  const illustration = typeof item.meta.illustration === 'string' ? item.meta.illustration : null;

  const confirmDelete = () =>
    Alert.alert(item.title, tc('settings:deleteConfirm', { title: item.title, size: formatBytes(item.sizeBytes) }), [
      { text: tc('actions.cancel'), style: 'cancel' },
      { text: tc('actions.delete'), style: 'destructive', onPress: () => removeItem(item.id) },
    ]);
  const actions = () =>
    Alert.alert(item.title, formatBytes(item.sizeBytes), [
      { text: t('share'), onPress: () => shareArchive(item).catch((e) => Alert.alert(t('shareFailed'), String((e as Error)?.message ?? e))) },
      { text: tc('actions.delete'), style: 'destructive', onPress: confirmDelete },
      { text: tc('actions.cancel'), style: 'cancel' },
    ]);

  return (
    <ListRow
      title={item.title}
      subtitle={[outdated ? tc('updates:available') : null, item.description, formatBytes(item.sizeBytes)].filter(Boolean).join(' · ')}
      leading={
        illustration ? (
          <Image source={{ uri: illustration }} style={[styles.illustration, { backgroundColor: colors.surfaceAlt }]} />
        ) : (
          <IconBadge icon={iconByName(undefined)} hue={categoryHue(item.category)} size={40} />
        )
      }
      chevron
      onPress={() => router.push({ pathname: '/reader/[itemId]', params: { itemId: item.id } })}
      onLongPress={actions}
    />
  );
}

const styles = StyleSheet.create({
  illustration: { width: 40, height: 40, borderRadius: radius.md },
});
