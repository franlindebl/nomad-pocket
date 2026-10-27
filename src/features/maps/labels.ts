// Display helpers shared by the search sheet, the emergency list and the place
// card: kind labels, icons and colours, distances with a compass direction.
import type { TFunction } from 'i18next';
import {
  Ambulance,
  Building,
  Cross,
  Droplet,
  Droplets,
  Flag,
  Flame,
  Fuel,
  Hammer,
  HeartPulse,
  Hospital,
  House,
  Landmark,
  MapPin,
  Pill,
  Route,
  Shield,
  ShieldHalf,
  ShoppingCart,
  Tent,
  Users,
  type LucideIcon,
} from 'lucide-react-native';

import { hues } from '@/theme';

import { EMERGENCY_KINDS, type EmergencyCategory, type EmergencyKind } from './emergency-core';
import { bearingDegrees, compassSector, type LatLon } from './geo';

export const CATEGORY_COLORS: Record<EmergencyCategory, string> = {
  health: hues.medicine,
  // Not blue: next to water's blue (and the user's blue dot) the two were one colour on the map.
  security: hues.computing,
  water: hues.reference,
  supplies: hues.agriculture,
  official: hues.neutral,
};

export const CATEGORY_ICONS: Record<EmergencyCategory, LucideIcon> = {
  health: HeartPulse,
  security: Shield,
  water: Droplet,
  supplies: ShoppingCart,
  official: Landmark,
};

const KIND_ICONS: Record<EmergencyKind, LucideIcon> = {
  hospital: Hospital,
  clinic: Cross,
  pharmacy: Pill,
  defibrillator: HeartPulse,
  ambulance_station: Ambulance,
  police: Shield,
  fire_station: Flame,
  military: ShieldHalf,
  drinking_water: Droplet,
  spring: Droplets,
  shelter: Tent,
  assembly_point: Users,
  fuel: Fuel,
  supermarket: ShoppingCart,
  hardware: Hammer,
  townhall: Landmark,
  embassy: Flag,
};

export function isEmergencyKind(kind: string | null | undefined): kind is EmergencyKind {
  return !!kind && kind in EMERGENCY_KINDS;
}

export function kindIcon(kind: string | null | undefined, layer?: string): LucideIcon {
  if (isEmergencyKind(kind)) return KIND_ICONS[kind];
  if (kind === 'address' || kind === 'address_approx') return House;
  if (layer === 'road') return Route;
  if (layer === 'place') return Building;
  return MapPin;
}

export function kindColor(kind: string | null | undefined): string {
  return isEmergencyKind(kind) ? CATEGORY_COLORS[EMERGENCY_KINDS[kind]] : hues.maps;
}

/** maps:kind.<kind>, or a generic "Place" for the hundreds of POI kinds without a label. */
export function kindLabel(t: TFunction, kind: string | null | undefined): string {
  return (kind && t(`maps:kind.${kind}`, { defaultValue: '' })) || t('maps:kind.place');
}

/** "850 m" / "1,2 km" / "35 km". */
export function formatDistance(meters: number, language: string): string {
  if (meters < 1000) return `${Math.max(10, Math.round(meters / 10) * 10)} m`;
  const km = meters / 1000;
  return `${new Intl.NumberFormat(language, { maximumFractionDigits: km < 10 ? 1 : 0 }).format(km)} km`;
}

/** "1,2 km NE": distance plus the compass direction from `from`. */
export function distanceWithDirection(t: TFunction, language: string, from: LatLon, to: LatLon, meters: number): string {
  return `${formatDistance(meters, language)} ${t(`maps:dir.${compassSector(bearingDegrees(from, to))}`)}`;
}
