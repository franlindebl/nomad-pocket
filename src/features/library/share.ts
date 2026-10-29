// Sends an installed archive to another phone through the share sheet (AirDrop, Nearby Share, Files…):
// the other phone adds it with Library › Import ZIM file. The file itself is shared, no copy
// (expo-sharing's FileProvider covers the app's files on Android): archives run to many GB.
import * as Sharing from 'expo-sharing';

import type { InstalledItem } from '@/features/content/items';
import i18n from '@/i18n';
import { resolveContentUri } from '@/lib/storage';

export async function shareArchive(item: InstalledItem) {
  if (!item.fileUri || !(await Sharing.isAvailableAsync())) throw new Error(i18n.t('library:shareUnavailable'));
  await Sharing.shareAsync(resolveContentUri(item.fileUri), {
    mimeType: 'application/octet-stream',
    UTI: 'public.data',
    dialogTitle: item.title,
  });
}
