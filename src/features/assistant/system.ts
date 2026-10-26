// Cached status of the OS language model, refreshed on demand and on foreground.
import { AppState, Platform } from 'react-native';
import { create } from 'zustand';

import { getSystemModelStatus, type SystemModelInfo } from '../../../modules/nomad-llm';

/** Only iOS has one (Apple Foundation Models); on Android the status is always 'unsupported'. */
export const HAS_SYSTEM_MODEL = Platform.OS === 'ios';

type State = {
  info: SystemModelInfo | null;
  refresh: () => Promise<SystemModelInfo>;
};

export const useSystemModel = create<State>((set) => ({
  info: null,
  refresh: async () => {
    const info = await getSystemModelStatus();
    set({ info });
    return info;
  },
}));

let hooked = false;

export function watchSystemModel() {
  useSystemModel.getState().refresh().catch(() => {});
  if (hooked || !HAS_SYSTEM_MODEL) return;
  hooked = true;
  // The user may enable Apple Intelligence in Settings and come back.
  AppState.addEventListener('change', (s) => {
    if (s === 'active') useSystemModel.getState().refresh().catch(() => {});
  });
}
