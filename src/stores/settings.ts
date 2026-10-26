// User preferences, persisted in SQLite's key-value store (sync reads at startup).
import Storage from 'expo-sqlite/kv-store';
import { Appearance } from 'react-native';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { deviceLanguage, setLanguage, type AppLanguage } from '@/i18n';

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
  setLanguage: (l: AppLanguage) => void;
  setContentLanguages: (l: AppLanguage[]) => void;
  setTheme: (t: ThemePreference) => void;
  setWifiOnly: (v: boolean) => void;
  setReaderTextScale: (v: number) => void;
  setOnboarded: (v: boolean) => void;
  setAiModelId: (id: string | null) => void;
  setCountry: (id: string | null) => void;
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
    }),
    {
      name: 'settings',
      storage: createJSONStorage(() => Storage),
      partialize: ({ language, contentLanguages, theme, wifiOnly, readerTextScale, onboarded, aiModelId, country }) => ({
        language,
        contentLanguages,
        theme,
        wifiOnly,
        readerTextScale,
        onboarded,
        aiModelId,
        country,
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        setLanguage(state.language);
        applyTheme(state.theme);
      },
    },
  ),
);
