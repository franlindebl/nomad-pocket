// Curated downloadable GGUF models for the local assistant (llama.rn).
// URLs are pinned to a Hugging Face commit so the size below stays exact
// (HEAD-checked 2026-10-24: x-linked-size == content-length == sizeBytes).
// No `@/` imports: unit tests load this file directly.

export type GgufModel = {
  id: string;
  name: string;
  family: 'qwen' | 'gemma';
  /** Parameter count label, e.g. "0.8B". */
  params: string;
  quant: string;
  url: string;
  filename: string;
  sizeBytes: number;
  /** Device RAM below which the model is not offered as a fit. */
  minRamGB: number;
  /** Context window used at load time (tokens). */
  contextTokens: number;
  license: string;
  licenseUrl: string;
  /** Strengths blurb key in the `assistant` namespace (`models.blurb.<id>`). */
  blurbKey: string;
};

export const SYSTEM_MODEL_ID = 'system';

export const GGUF_MODELS: GgufModel[] = [
  {
    id: 'qwen3.5-0.8b-q4km',
    name: 'Qwen3.5 0.8B',
    family: 'qwen',
    params: '0.8B',
    quant: 'Q4_K_M',
    url: 'https://huggingface.co/unsloth/Qwen3.5-0.8B-GGUF/resolve/6ab461498e2023f6e3c1baea90a8f0fe38ab64d0/Qwen3.5-0.8B-Q4_K_M.gguf',
    filename: 'Qwen3.5-0.8B-Q4_K_M.gguf',
    sizeBytes: 532_517_120,
    minRamGB: 3,
    contextTokens: 4096,
    license: 'Apache-2.0',
    licenseUrl: 'https://huggingface.co/Qwen/Qwen3.5-0.8B',
    blurbKey: 'tiny',
  },
  {
    id: 'qwen3.5-2b-q4km',
    name: 'Qwen3.5 2B',
    family: 'qwen',
    params: '2B',
    quant: 'Q4_K_M',
    url: 'https://huggingface.co/unsloth/Qwen3.5-2B-GGUF/resolve/f6d5376be1edb4d416d56da11e5397a961aca8ae/Qwen3.5-2B-Q4_K_M.gguf',
    filename: 'Qwen3.5-2B-Q4_K_M.gguf',
    sizeBytes: 1_280_835_840,
    minRamGB: 4,
    contextTokens: 4096,
    license: 'Apache-2.0',
    licenseUrl: 'https://huggingface.co/Qwen/Qwen3.5-2B',
    blurbKey: 'balanced',
  },
  {
    id: 'qwen3.5-4b-q4km',
    name: 'Qwen3.5 4B',
    family: 'qwen',
    params: '4B',
    quant: 'Q4_K_M',
    url: 'https://huggingface.co/unsloth/Qwen3.5-4B-GGUF/resolve/e87f176479d0855a907a41277aca2f8ee7a09523/Qwen3.5-4B-Q4_K_M.gguf',
    filename: 'Qwen3.5-4B-Q4_K_M.gguf',
    sizeBytes: 2_740_937_888,
    minRamGB: 7,
    contextTokens: 6144,
    license: 'Apache-2.0',
    licenseUrl: 'https://huggingface.co/Qwen/Qwen3.5-4B',
    blurbKey: 'smart',
  },
  {
    id: 'gemma-4-e2b-q4km',
    name: 'Gemma 4 E2B',
    family: 'gemma',
    params: 'E2B',
    quant: 'Q4_K_M',
    url: 'https://huggingface.co/unsloth/gemma-4-E2B-it-GGUF/resolve/0314792d7f1f7e229411f620751375812bb9faf2/gemma-4-E2B-it-Q4_K_M.gguf',
    filename: 'gemma-4-E2B-it-Q4_K_M.gguf',
    sizeBytes: 3_106_738_272,
    minRamGB: 8,
    contextTokens: 6144,
    license: 'Apache-2.0',
    licenseUrl: 'https://huggingface.co/google/gemma-4-E2B-it',
    blurbKey: 'multilingual',
  },
];

export function getModel(id: string | null | undefined): GgufModel | undefined {
  return GGUF_MODELS.find((m) => m.id === id);
}

/** Installed-memory reading (bytes, as reported by the OS) → GB, rounded up a bit. */
export function ramGB(totalMemoryBytes: number | null | undefined): number | null {
  if (!totalMemoryBytes || totalMemoryBytes <= 0) return null;
  // Phones report slightly less than the marketed size (e.g. 7.5 GB for 8 GB).
  return Math.round((totalMemoryBytes / 1024 ** 3) * 2) / 2;
}

export type Fit = 'good' | 'tight' | 'tooBig';

/** How well a model fits a device's RAM. Unknown RAM is treated as "good". */
export function modelFit(model: GgufModel, ram: number | null): Fit {
  if (ram == null) return 'good';
  if (ram + 0.5 < model.minRamGB) return 'tooBig';
  if (ram < model.minRamGB + 0.5) return 'tight';
  return 'good';
}

/** Best model for the device: the largest that fits comfortably, preferring Qwen. */
export function recommendModel(ram: number | null): GgufModel {
  if (ram == null) return GGUF_MODELS[1];
  const fits = GGUF_MODELS.filter((m) => m.family === 'qwen' && modelFit(m, ram) === 'good');
  return fits[fits.length - 1] ?? GGUF_MODELS[0];
}
