// After a download, the smaller editions of the same book it holds take room for nothing (each ZIM is
// self-contained: "Completa (sin imágenes)" has every article of "Artículos populares"). Offer to delete
// them, saying which archive holds them (owner's decision, 2026-11-02). Never automatic, and only once the
// bigger one is in: until then the smaller one is all the person has.
import { Alert, AppState } from 'react-native';

import { getResource, loc } from '@/features/catalog';
import { heldBy } from '@/features/catalog/editions-core';
import { listItems, removeItem, type InstalledItem } from '@/features/content/items';
import i18n from '@/i18n';
import { formatBytes } from '@/lib/format';

const titleOf = (item: InstalledItem) => {
  const r = getResource(item.catalogId ?? item.id);
  return r ? loc(r.title) : item.title;
};

export function offerRedundantCleanup(item: InstalledItem) {
  if (!item.catalogId) return;
  const others = listItems('zim').filter((i) => i.id !== item.id && i.catalogId);
  const held = new Set(heldBy(item.catalogId, others.map((i) => i.catalogId as string)));
  const redundant = others.filter((i) => held.has(i.catalogId as string));
  if (!redundant.length) return;

  const show = () => {
    const t = i18n.getFixedT(null, 'library');
    const count = redundant.length;
    const size = formatBytes(redundant.reduce((s, i) => s + i.sizeBytes, 0));
    Alert.alert(
      t('redundant.title', { count, name: titleOf(redundant[0]) }),
      t('redundant.body', { count, holder: titleOf(item), size, names: redundant.map((i) => `• ${titleOf(i)}`).join('\n') }),
      [
        { text: t('redundant.keep'), style: 'cancel' },
        {
          text: t('common:actions.delete'),
          style: 'destructive',
          onPress: () => {
            for (const i of redundant) removeItem(i.id).catch((e) => console.warn('[zim] cannot delete', i.id, e));
          },
        },
      ],
    );
  };
  // Big downloads often finish with the app in the background, where an alert would be lost (Android
  // drops it without an activity): ask when the person comes back.
  if (AppState.currentState === 'active') {
    show();
    return;
  }
  const sub = AppState.addEventListener('change', (state) => {
    if (state !== 'active') return;
    sub.remove();
    show();
  });
}
