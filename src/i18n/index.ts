// i18n setup. Strings are split into one namespace per feature
// (src/i18n/locales/<lang>/<namespace>.json) so features can evolve independently.
import { getLocales } from 'expo-localization';
import i18n, { changeLanguage, use as addPlugin } from 'i18next';
import { initReactI18next } from 'react-i18next';

import { resources, type Namespace } from './resources';

export const SUPPORTED_LANGUAGES = ['es', 'en'] as const;
export type AppLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export function deviceLanguage(): AppLanguage {
  const code = getLocales()[0]?.languageCode ?? 'en';
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(code) ? (code as AppLanguage) : 'en';
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
