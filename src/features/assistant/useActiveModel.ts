import { useTranslation } from 'react-i18next';

import { useItems } from '@/features/content/items';
import { useSettings } from '@/stores/settings';

import { getModel, SYSTEM_MODEL_ID } from './models';
import { useSystemModel } from './system';

export type ActiveModel = {
  id: string | null;
  /** Display name, null when nothing usable is selected. */
  name: string | null;
  ready: boolean;
  systemAvailable: boolean;
};

/** The model the chat will use, resolved against what's installed/available. */
export function useActiveModel(): ActiveModel {
  const { t } = useTranslation('assistant');
  const id = useSettings((s) => s.aiModelId);
  const installed = useItems('model');
  const system = useSystemModel((s) => s.info);
  const systemAvailable = system?.status === 'available';

  if (id === SYSTEM_MODEL_ID) {
    const provider = system?.provider ? t(`models.systemProvider.${system.provider}`) : t('models.system');
    return { id, name: provider, ready: systemAvailable, systemAvailable };
  }
  const item = installed.find((i) => i.id === id);
  if (!item) return { id: null, name: null, ready: false, systemAvailable };
  return { id, name: getModel(item.catalogId ?? item.id)?.name ?? item.title, ready: true, systemAvailable };
}
