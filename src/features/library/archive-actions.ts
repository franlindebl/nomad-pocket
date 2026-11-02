// The long-press menu of an archive on the phone, wherever a Library list shows it: share it with another
// phone or delete it (asking first).
import { Alert } from 'react-native';

import { removeItem, type InstalledItem } from '@/features/content/items';
import i18n from '@/i18n';
import { formatBytes } from '@/lib/format';

import { shareArchive } from './share';

export function showArchiveActions(item: InstalledItem) {
  const t = i18n.getFixedT(null, 'library');
  const tc = i18n.getFixedT(null, 'common');
  const confirmDelete = () =>
    Alert.alert(item.title, tc('settings:deleteConfirm', { title: item.title, size: formatBytes(item.sizeBytes) }), [
      { text: tc('actions.cancel'), style: 'cancel' },
      { text: tc('actions.delete'), style: 'destructive', onPress: () => removeItem(item.id) },
    ]);
  Alert.alert(item.title, formatBytes(item.sizeBytes), [
    { text: t('share'), onPress: () => shareArchive(item).catch((e) => Alert.alert(t('shareFailed'), String((e as Error)?.message ?? e))) },
    { text: tc('actions.delete'), style: 'destructive', onPress: confirmDelete },
    { text: tc('actions.cancel'), style: 'cancel' },
  ]);
}
