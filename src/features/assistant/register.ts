// Assistant feature registration: GGUF model downloads, model removal and init.
import { File } from 'expo-file-system';
import * as Network from 'expo-network';

import { registerInit } from '@/features/bootstrap';
import { getItem, listItems, onItemRemoved, upsertItem } from '@/features/content/items';
import { enqueueDownload, registerCompletionHandler } from '@/features/downloads/manager';
import { contentDir } from '@/lib/storage';
import { useSettings } from '@/stores/settings';

import { cancelAnswer, refreshSessions } from './chats';
import { installEngineLifecycle, releaseIfModel } from './engine';
import { GGUF_MODELS, getModel, SYSTEM_MODEL_ID, type GgufModel } from './models';
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

function registerModelFile(modelId: string, fileUri: string, sizeBytes: number, fallbackTitle: string, sourceUrl: string | null) {
  const def = getModel(modelId);
  upsertItem({
    id: modelId,
    kind: 'model',
    title: def?.name ?? fallbackTitle,
    description: def ? `${def.params} · ${def.quant}` : null,
    language: 'mul',
    category: 'ai',
    isCourse: false,
    fileUri,
    sizeBytes,
    version: def?.quant ?? null,
    sourceUrl,
    catalogId: modelId,
    meta: { family: def?.family, params: def?.params, license: def?.license },
  });
  // First model on the device becomes the active one.
  const settings = useSettings.getState();
  if (!settings.aiModelId || (settings.aiModelId !== SYSTEM_MODEL_ID && !getItem(settings.aiModelId))) {
    settings.setAiModelId(modelId);
  }
}

registerCompletionHandler('model', async (file, record) => {
  const modelId = typeof record.meta.modelId === 'string' ? record.meta.modelId : record.id;
  registerModelFile(modelId, file.uri, Number(file.size ?? record.totalBytes), record.title, record.url);
});

/**
 * Catalog models copied into content/models by hand (Files / Finder, or the E2E
 * runner) but not registered: complete files only, matched by exact name and size.
 */
function registerLooseModels() {
  const dir = contentDir('model');
  if (!dir.exists) return;
  const known = new Set(listItems('model').map((i) => i.id));
  for (const entry of dir.list()) {
    if (!(entry instanceof File)) continue;
    const def = GGUF_MODELS.find((m) => m.filename === entry.name);
    if (!def || known.has(def.id) || Number(entry.size) !== def.sizeBytes) continue;
    registerModelFile(def.id, entry.uri, def.sizeBytes, def.name, def.url);
  }
}

onItemRemoved('model', async (item) => {
  await releaseIfModel(item.id);
  const settings = useSettings.getState();
  if (settings.aiModelId === item.id) settings.setAiModelId(null);
});

registerInit(() => {
  installEngineLifecycle(cancelAnswer);
  watchSystemModel();
  refreshSessions();
  try {
    registerLooseModels();
  } catch (e) {
    console.warn('[assistant] model scan failed', e);
  }
  // Forget a selected model whose file is gone.
  const { aiModelId, setAiModelId } = useSettings.getState();
  if (aiModelId && aiModelId !== SYSTEM_MODEL_ID && !getItem(aiModelId)) setAiModelId(null);
});
