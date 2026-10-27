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
import { bestModel, GGUF_MODELS, getModel, modelRank, SYSTEM_MODEL_ID, type GgufModel } from './models';
import { HAS_SYSTEM_MODEL, useSystemModel, watchSystemModel } from './system';

export class OfflineError extends Error {
  constructor() {
    super('OFFLINE');
  }
}

/**
 * Queue a GGUF model download (checks connectivity). On mobile data with "Wi-Fi only" on,
 * the download manager queues it until Wi-Fi and asks whether to use mobile data instead.
 */
export async function downloadModel(model: GgufModel) {
  const net = await Network.getNetworkStateAsync();
  if (net.isConnected === false || net.isInternetReachable === false) throw new OfflineError();
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
  // A new model becomes the active one when it beats the current choice (or there is none
  // usable); a less capable one waits for the user to pick it in the models screen.
  const { aiModelId, setAiModelId } = useSettings.getState();
  if (aiModelId === modelId) return;
  if (!usable(aiModelId) || modelRank(modelId) > modelRank(aiModelId)) setAiModelId(modelId);
}

function systemAvailable() {
  return HAS_SYSTEM_MODEL && useSystemModel.getState().info?.status === 'available';
}

function usable(id: string | null) {
  if (id === SYSTEM_MODEL_ID) return systemAvailable();
  return !!id && !!getItem(id);
}

/** The most capable model left on the device (minus `removing`), for when the selected one is gone. */
function fallbackModel(removing?: string): string | null {
  const ids = listItems('model')
    .map((i) => i.id)
    .filter((id) => id !== removing);
  return bestModel(systemAvailable() ? [...ids, SYSTEM_MODEL_ID] : ids);
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
  if (settings.aiModelId === item.id) settings.setAiModelId(fallbackModel(item.id));
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
  // Replace a selected model whose file is gone, and the system model where there is none
  // (Android builds before 1.1 offered Gemini Nano). The system status isn't known yet here.
  const { aiModelId, setAiModelId } = useSettings.getState();
  if (aiModelId === SYSTEM_MODEL_ID ? !HAS_SYSTEM_MODEL : aiModelId && !getItem(aiModelId)) setAiModelId(fallbackModel());
});
