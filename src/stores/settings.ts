// User preferences, persisted in SQLite's key-value store (sync reads at startup). The app is dark
// only (2026-11-02): an old stored `theme` key is ignored.
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { deviceLanguage, setLanguage, type AppLanguage } from '@/i18n';
import { kvStorage } from '@/lib/kv';
import type { UnitsPreference } from '@/lib/units';

type SettingsState = {
  language: AppLanguage;
  /** Languages to show in the content catalog. */
  contentLanguages: AppLanguage[];
  wifiOnly: boolean;
  readerTextScale: number;
  /** The reader shows pages on warm paper (dark text on cream) instead of the app's dark mode. */
  readerPaper: boolean;
  onboarded: boolean;
  /** Selected local AI model id (catalog id), or 'system' for the OS model. */
  aiModelId: string | null;
  /** The user's country (regions.json id), chosen in onboarding: its map, emergency number. */
  country: string | null;
  /** Units for distances, speeds and water: 'auto' follows the country above (lib/units.ts). */
  units: UnitsPreference;
  /** Emergency points drawn on the map (the Puntos sheet), and the categories hidden from it. */
  mapPoints: boolean;
  hiddenPointCategories: string[];
  /** Navigation keeps the map north up (the arrow turns) instead of turning it the way the user goes. */
  navNorthUp: boolean;
  /** Navigation speaks its prompts (the speaker button in the navigation view). */
  navVoice: boolean;
  setLanguage: (l: AppLanguage) => void;
  setContentLanguages: (l: AppLanguage[]) => void;
  setWifiOnly: (v: boolean) => void;
  setReaderTextScale: (v: number) => void;
  setReaderPaper: (v: boolean) => void;
  setOnboarded: (v: boolean) => void;
  setAiModelId: (id: string | null) => void;
  setCountry: (id: string | null) => void;
  setUnits: (units: UnitsPreference) => void;
  setMapPoints: (v: boolean) => void;
  setPointCategoryHidden: (category: string, hidden: boolean) => void;
  setNavNorthUp: (v: boolean) => void;
  setNavVoice: (v: boolean) => void;
};

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      language: deviceLanguage(),
      contentLanguages: deviceLanguage() === 'es' ? ['es', 'en'] : ['en'],
      wifiOnly: true,
      readerTextScale: 1,
      readerPaper: false,
      onboarded: false,
      aiModelId: null,
      country: null,
      units: 'auto',
      mapPoints: true,
      hiddenPointCategories: [],
      navNorthUp: false,
      navVoice: true,
      setLanguage: (language) => {
        setLanguage(language);
        set({ language });
      },
      setContentLanguages: (contentLanguages) => set({ contentLanguages }),
      setWifiOnly: (wifiOnly) => set({ wifiOnly }),
      setReaderTextScale: (readerTextScale) => set({ readerTextScale }),
      setReaderPaper: (readerPaper) => set({ readerPaper }),
      setOnboarded: (onboarded) => set({ onboarded }),
      setAiModelId: (aiModelId) => set({ aiModelId }),
      setCountry: (country) => set({ country }),
      setUnits: (units) => set({ units }),
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
        wifiOnly,
        readerTextScale,
        readerPaper,
        onboarded,
        aiModelId,
        country,
        units,
        mapPoints,
        hiddenPointCategories,
        navNorthUp,
        navVoice,
      }) => ({
        language,
        contentLanguages,
        wifiOnly,
        readerTextScale,
        readerPaper,
        onboarded,
        aiModelId,
        country,
        units,
        mapPoints,
        hiddenPointCategories,
        navNorthUp,
        navVoice,
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        setLanguage(state.language);
      },
    },
  ),
);
