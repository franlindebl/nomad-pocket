// Display helpers shared by the search sheet, the emergency list and the place
// card: kind labels, icons and colours, distances with a compass direction.
import type { TFunction } from 'i18next';
import {
  Ambulance,
  Banknote,
  BedDouble,
  Beer,
  Binoculars,
  Building,
  Bus,
  Castle,
  Church,
  Coffee,
  Cross,
  Droplet,
  Droplets,
  Flag,
  Flame,
  Fuel,
  GraduationCap,
  Hammer,
  HeartPulse,
  Hospital,
  House,
  Landmark,
  Library,
  Mail,
  MapPin,
  Mountain,
  Pill,
  Plane,
  Route,
  Shield,
  ShieldHalf,
  Ship,
  ShoppingBag,
  ShoppingCart,
  SquareParking,
  Tent,
  TrainFront,
  Trees,
  Users,
  Utensils,
  Waves,
  type LucideIcon,
} from 'lucide-react-native';

import { formatDistance } from '@/lib/format';
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

/** The basemap's everyday kinds (a tapped restaurant, a bus stop); the rest get a pin. */
const POI_ICONS: Record<string, LucideIcon> = {
  restaurant: Utensils,
  fast_food: Utensils,
  cafe: Coffee,
  bar: Beer,
  pub: Beer,
  biergarten: Beer,
  bus_stop: Bus,
  bus_station: Bus,
  station: TrainFront,
  ferry_terminal: Ship,
  aerodrome: Plane,
  hotel: BedDouble,
  hostel: BedDouble,
  guest_house: BedDouble,
  motel: BedDouble,
  camp_site: Tent,
  alpine_hut: House,
  parking: SquareParking,
  post_office: Mail,
  bank: Banknote,
  atm: Banknote,
  school: GraduationCap,
  university: GraduationCap,
  college: GraduationCap,
  kindergarten: GraduationCap,
  library: Library,
  park: Trees,
  garden: Trees,
  forest: Trees,
  nature_reserve: Trees,
  national_park: Trees,
  peak: Mountain,
  volcano: Mountain,
  viewpoint: Binoculars,
  beach: Waves,
  place_of_worship: Church,
  castle: Castle,
  museum: Landmark,
  convenience: ShoppingBag,
  bakery: ShoppingBag,
  clothes: ShoppingBag,
  mall: ShoppingBag,
  department_store: ShoppingBag,
};

export function isEmergencyKind(kind: string | null | undefined): kind is EmergencyKind {
  return !!kind && kind in EMERGENCY_KINDS;
}

export function kindIcon(kind: string | null | undefined, layer?: string): LucideIcon {
  if (isEmergencyKind(kind)) return KIND_ICONS[kind];
  if (kind === 'address' || kind === 'address_approx') return House;
  if (layer === 'road') return Route;
  if (layer === 'place') return Building;
  return (kind && POI_ICONS[kind]) || MapPin;
}

export function kindColor(kind: string | null | undefined): string {
  return isEmergencyKind(kind) ? CATEGORY_COLORS[EMERGENCY_KINDS[kind]] : hues.maps;
}

/** maps:kind.<kind>, or a generic "Place" for the hundreds of POI kinds without a label. */
export function kindLabel(t: TFunction, kind: string | null | undefined): string {
  return (kind && t(`maps:kind.${kind}`, { defaultValue: '' })) || t('maps:kind.place');
}

/** "1,2 km NE": distance plus the compass direction from `from`. */
export function distanceWithDirection(t: TFunction, from: LatLon, to: LatLon, meters: number): string {
  return `${formatDistance(meters)} ${t(`maps:dir.${compassSector(bearingDegrees(from, to))}`)}`;
}
