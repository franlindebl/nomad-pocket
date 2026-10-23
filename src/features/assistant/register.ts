// Assistant feature registration: GGUF model downloads, model removal and init.
import * as Network from 'expo-network';

import { registerInit } from '@/features/bootstrap';
import { getItem, onItemRemoved, upsertItem } from '@/features/content/items';
import { enqueueDownload, registerCompletionHandler } from '@/features/downloads/manager';
import { useSettings } from '@/stores/settings';

import { refreshSessions } from './chats';
import { installEngineLifecycle, releaseIfModel } from './engine';
import { getModel, SYSTEM_MODEL_ID, type GgufModel } from './models';
import { watchSystemModel } from './system';

export class OfflineError extends Error {
  constructor() {
    super('OFFLINE');
  }
}

export class WifiRequiredError extends Error {
  constructor() {
    super('WIFI_REQUIRED');
  }
}

/** Queue a GGUF model download (checks connectivity and the Wi-Fi-only setting). */
export async function downloadModel(model: GgufModel) {
  const net = await Network.getNetworkStateAsync();
  if (net.isConnected === false || net.isInternetReachable === false) throw new OfflineError();
  if (useSettings.getState().wifiOnly && net.type === Network.NetworkStateType.CELLULAR) throw new WifiRequiredError();
  return enqueueDownload({
    id: model.id,
    kind: 'model',
    title: model.name,
    url: model.url,
    filename: model.filename,
    expectedBytes: model.sizeBytes,
    meta: { modelId: model.id },
  });
}

registerCompletionHandler('model', async (file, record) => {
  const modelId = typeof record.meta.modelId === 'string' ? record.meta.modelId : record.id;
  const def = getModel(modelId);
  upsertItem({
    id: modelId,
    kind: 'model',
    title: def?.name ?? record.title,
    description: def ? `${def.params} · ${def.quant}` : null,
    language: 'mul',
    category: 'ai',
    isCourse: false,
    fileUri: file.uri,
    sizeBytes: Number(file.size ?? record.totalBytes),
    version: def?.quant ?? null,
    sourceUrl: record.url,
    catalogId: modelId,
    meta: { family: def?.family, params: def?.params, license: def?.license },
  });
  // First model on the device becomes the active one.
  const settings = useSettings.getState();
  if (!settings.aiModelId || (settings.aiModelId !== SYSTEM_MODEL_ID && !getItem(settings.aiModelId))) {
    settings.setAiModelId(modelId);
  }
});

onItemRemoved('model', async (item) => {
  await releaseIfModel(item.id);
  const settings = useSettings.getState();
  if (settings.aiModelId === item.id) settings.setAiModelId(null);
});

registerInit(() => {
  installEngineLifecycle();
  watchSystemModel();
  refreshSessions();
  // Forget a selected model whose file is gone.
  const { aiModelId, setAiModelId } = useSettings.getState();
  if (aiModelId && aiModelId !== SYSTEM_MODEL_ID && !getItem(aiModelId)) setAiModelId(null);
});
