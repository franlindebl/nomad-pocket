// Explicit icon map: importing the whole lucide set would bloat the bundle.
import {
  Atom,
  BookOpen,
  Calculator,
  Code,
  CodeXml,
  Cpu,
  FlaskConical,
  Globe,
  GraduationCap,
  HeartPulse,
  Landmark,
  Languages,
  Library,
  Map,
  Music,
  Palette,
  Sigma,
  Sprout,
  Stethoscope,
  Tent,
  Wrench,
  type LucideIcon,
} from 'lucide-react-native';

import type { Hue } from '@/theme';

const ICONS: Record<string, LucideIcon> = {
  Atom,
  BookOpen,
  Calculator,
  Code,
  CodeXml,
  Cpu,
  FlaskConical,
  Globe,
  GraduationCap,
  HeartPulse,
  Landmark,
  Languages,
  Library,
  Map,
  Music,
  Palette,
  Sigma,
  Sprout,
  Stethoscope,
  Tent,
  Wrench,
};

export function iconByName(name: string | undefined): LucideIcon {
  return (name && ICONS[name]) || BookOpen;
}

const CATEGORY_ICON: Record<string, LucideIcon> = {
  medicine: Stethoscope,
  survival: Tent,
  education: GraduationCap,
  reference: Library,
  diy: Wrench,
  agriculture: Sprout,
  computing: Cpu,
  courses: GraduationCap,
  wikipedia: Globe,
};

const CATEGORY_HUE: Record<string, Hue> = {
  medicine: 'medicine',
  survival: 'survival',
  education: 'education',
  reference: 'reference',
  diy: 'diy',
  agriculture: 'agriculture',
  computing: 'computing',
  courses: 'courses',
  wikipedia: 'reference',
};

export function categoryIcon(slug: string | null | undefined): LucideIcon {
  return (slug && CATEGORY_ICON[slug]) || BookOpen;
}

export function categoryHue(slug: string | null | undefined): Hue {
  return (slug && CATEGORY_HUE[slug]) || 'neutral';
}
