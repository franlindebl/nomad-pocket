// Register every namespace here, for both languages.
import enAssistant from './locales/en/assistant.json';
import enCommon from './locales/en/common.json';
import enCourses from './locales/en/courses.json';
import enHome from './locales/en/home.json';
import enLibrary from './locales/en/library.json';
import enMaps from './locales/en/maps.json';
import enPrepare from './locales/en/prepare.json';
import enReader from './locales/en/reader.json';
import enSettings from './locales/en/settings.json';
import enUpdates from './locales/en/updates.json';
import esAssistant from './locales/es/assistant.json';
import esCommon from './locales/es/common.json';
import esCourses from './locales/es/courses.json';
import esHome from './locales/es/home.json';
import esLibrary from './locales/es/library.json';
import esMaps from './locales/es/maps.json';
import esPrepare from './locales/es/prepare.json';
import esReader from './locales/es/reader.json';
import esSettings from './locales/es/settings.json';
import esUpdates from './locales/es/updates.json';

export const resources = {
  es: {
    common: esCommon,
    home: esHome,
    library: esLibrary,
    maps: esMaps,
    courses: esCourses,
    assistant: esAssistant,
    settings: esSettings,
    reader: esReader,
    prepare: esPrepare,
    updates: esUpdates,
  },
  en: {
    common: enCommon,
    home: enHome,
    library: enLibrary,
    maps: enMaps,
    courses: enCourses,
    assistant: enAssistant,
    settings: enSettings,
    reader: enReader,
    prepare: enPrepare,
    updates: enUpdates,
  },
} as const;

export type Namespace = keyof (typeof resources)['es'];
