// Bundled content catalog (src/data/catalog.json). Modeled on NOMAD's
// collections/kiwix-categories.json: categories → cumulative tiers → resources,
// extended for multiple languages and courses.
import type { Hue } from '@/theme';

export type Localized = { es: string; en: string };
export type ContentLanguage = 'es' | 'en' | 'mul';

export type CatalogResource = {
  /** Stable id: the Kiwix book name without the date, e.g. "wikipedia_es_top_mini". */
  id: string;
  /** Kiwix OPDS `name`, used to resolve the newest version online. Usually equals id. */
  kiwixName?: string;
  title: Localized;
  description: Localized;
  language: ContentLanguage;
  /** Direct .zim URL of the pinned version (fallback when OPDS is unreachable). */
  url: string;
  sizeMB: number;
  /** YYYY-MM of the pinned file. */
  version: string;
  /** Category slug this resource belongs to (for icons/colors). */
  category: string;
  isCourse?: boolean;
  /** Course subject slug (see Catalog.courseSubjects), when isCourse. */
  subject?: string;
  /** Health content: show the medical disclaimer. */
  medical?: boolean;
};

export type CatalogTier = {
  slug: string;
  name: Localized;
  description: Localized;
  recommended?: boolean;
  /** Tier slug whose resources are included too (cumulative tiers, like NOMAD). */
  includesTier?: string;
  /** Resource ids; filtered at runtime by the user's content languages. */
  resources: string[];
};

export type CatalogCategory = {
  slug: string;
  hue: Hue;
  /** lucide-react-native icon name, e.g. "Stethoscope". */
  icon: string;
  name: Localized;
  description: Localized;
  tiers: CatalogTier[];
};

export type WikipediaOption = {
  /** "top-mini" | "top-nopic" | "all-mini" | "all-nopic" | "all-maxi" */
  id: string;
  resourceId: string;
  name: Localized;
  description: Localized;
};

export type CourseSubject = {
  slug: string;
  hue: Hue;
  icon: string;
  name: Localized;
};

export type Catalog = {
  version: string;
  resources: Record<string, CatalogResource>;
  categories: CatalogCategory[];
  /** Wikipedia size options per language, smallest first. */
  wikipedia: Record<'es' | 'en', WikipediaOption[]>;
  courseSubjects: CourseSubject[];
  /** Course resource ids, in display order. */
  courses: string[];
};
