// Location for the whole app: expo-location on iOS. On Android the same calls come from
// location.android.ts (modules/nomad-location, the system's LocationManager), because expo-location
// needs Google Play services, a proprietary library that can't ship next to GPL libkiwix. Import
// location from here, never from expo-location (ESLint enforces it): Metro picks the .android file
// there, so expo-location's native module, which isn't linked on Android, is never loaded.
export {
  Accuracy,
  getCurrentPositionAsync,
  getForegroundPermissionsAsync,
  getLastKnownPositionAsync,
  requestForegroundPermissionsAsync,
  watchHeadingAsync,
  watchPositionAsync,
  type LocationHeadingObject,
  type LocationObject,
  type LocationSubscription,
} from 'expo-location';
