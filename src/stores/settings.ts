// User preferences, persisted in SQLite's key-value store (sync reads at startup).
import { Appearance } from 'react-native';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { deviceLanguage, setLanguage, type AppLanguage } from '@/i18n';
import { kvStorage } from '@/lib/kv';

export type ThemePreference = 'system' | 'light' | 'dark';

type SettingsState = {
  language: AppLanguage;
  /** Languages to show in the content catalog. */
  contentLanguages: AppLanguage[];
  theme: ThemePreference;
  wifiOnly: boolean;
  readerTextScale: number;
  onboarded: boolean;
  /** Selected local AI model id (catalog id), or 'system' for the OS model. */
  aiModelId: string | null;
  /** The user's country (regions.json id), chosen in onboarding: its map, emergency number. */
  country: string | null;
  /** Emergency points drawn on the map (the Puntos sheet), and the categories hidden from it. */
  mapPoints: boolean;
  hiddenPointCategories: string[];
  /** Navigation keeps the map north up (the arrow turns) instead of turning it the way the user goes. */
  navNorthUp: boolean;
  /** Navigation speaks its prompts (the speaker button in the navigation view). */
  navVoice: boolean;
  setLanguage: (l: AppLanguage) => void;
  setContentLanguages: (l: AppLanguage[]) => void;
  setTheme: (t: ThemePreference) => void;
  setWifiOnly: (v: boolean) => void;
  setReaderTextScale: (v: number) => void;
  setOnboarded: (v: boolean) => void;
  setAiModelId: (id: string | null) => void;
  setCountry: (id: string | null) => void;
  setMapPoints: (v: boolean) => void;
  setPointCategoryHidden: (category: string, hidden: boolean) => void;
  setNavNorthUp: (v: boolean) => void;
  setNavVoice: (v: boolean) => void;
};

function applyTheme(theme: ThemePreference) {
  Appearance.setColorScheme(theme === 'system' ? 'unspecified' : theme);
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      language: deviceLanguage(),
      contentLanguages: deviceLanguage() === 'es' ? ['es', 'en'] : ['en'],
      theme: 'system',
      wifiOnly: true,
      readerTextScale: 1,
      onboarded: false,
      aiModelId: null,
      country: null,
      mapPoints: true,
      hiddenPointCategories: [],
      navNorthUp: false,
      navVoice: true,
      setLanguage: (language) => {
        setLanguage(language);
        set({ language });
      },
      setContentLanguages: (contentLanguages) => set({ contentLanguages }),
      setTheme: (theme) => {
        applyTheme(theme);
        set({ theme });
      },
      setWifiOnly: (wifiOnly) => set({ wifiOnly }),
      setReaderTextScale: (readerTextScale) => set({ readerTextScale }),
      setOnboarded: (onboarded) => set({ onboarded }),
      setAiModelId: (aiModelId) => set({ aiModelId }),
      setCountry: (country) => set({ country }),
      setMapPoints: (mapPoints) => set({ mapPoints }),
      setPointCategoryHidden: (category, hidden) =>
        set((st) => ({
          hiddenPointCategories: hidden
            ? [...new Set([...st.hiddenPointCategories, category])]
            : st.hiddenPointCategories.filter((c) => c !== category),
        })),
      setNavNorthUp: (navNorthUp) => set({ navNorthUp }),
      setNavVoice: (navVoice) => set({ navVoice }),
    }),
    {
      name: 'settings',
      storage: kvStorage(),
      partialize: ({
        language,
        contentLanguages,
        theme,
        wifiOnly,
        readerTextScale,
        onboarded,
        aiModelId,
        country,
        mapPoints,
        hiddenPointCategories,
        navNorthUp,
        navVoice,
      }) => ({
        language,
        contentLanguages,
        theme,
        wifiOnly,
        readerTextScale,
        onboarded,
        aiModelId,
        country,
        mapPoints,
        hiddenPointCategories,
        navNorthUp,
        navVoice,
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        setLanguage(state.language);
        applyTheme(state.theme);
      },
    },
  ),
);
