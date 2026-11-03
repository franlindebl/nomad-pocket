// i18n setup. Strings are split into one namespace per feature
// (src/i18n/locales/<lang>/<namespace>.json) so features can evolve independently.
import { getLocales } from 'expo-localization';
import i18n, { changeLanguage, use as addPlugin } from 'i18next';
import { initReactI18next } from 'react-i18next';

import { resources, type Namespace } from './resources';

export const SUPPORTED_LANGUAGES = ['es', 'en'] as const;
export type AppLanguage = (typeof SUPPORTED_LANGUAGES)[number];

/** Spain's other official languages: whoever has their phone in one of them reads Spanish. */
const READS_SPANISH = new Set(['ca', 'gl', 'eu', 'oc', 'ast']);

/**
 * The app language from the device's preferred languages, in order: the first the app has, a Spanish co-official
 * one counting as Spanish (Catalan first, then English: Spanish), else English.
 */
export function deviceLanguage(): AppLanguage {
  for (const { languageCode } of getLocales()) {
    if (!languageCode) continue;
    if ((SUPPORTED_LANGUAGES as readonly string[]).includes(languageCode)) return languageCode as AppLanguage;
    if (READS_SPANISH.has(languageCode)) return 'es';
  }
  return 'en';
}

const namespaces = Object.keys(resources.es) as Namespace[];

addPlugin(initReactI18next).init({
  resources,
  lng: deviceLanguage(),
  fallbackLng: 'en',
  ns: namespaces,
  defaultNS: 'common',
  interpolation: { escapeValue: false },
  returnNull: false,
});

export function setLanguage(lang: AppLanguage) {
  changeLanguage(lang);
}

export default i18n;
