// Whether this build offers health features: medical and first-aid archives, the first-aid shortcut,
// health answers from the assistant and the plan's health card. Off on Android: Google Play only lets
// organization accounts distribute medical apps ("Medical Reference and Education", "Emergency and
// First Aid"), and Play support confirmed on 2026-10-29 that the app may ship from a personal account
// without them (docs/RELEASE.md, Android). Emergency numbers and the map's hospitals and pharmacies
// stay: Play counts them as general utility.
//
// Fixed at build time on purpose: Play forbids turning on features after review that the app's
// declarations don't list. Turning this on for Android needs an organization account, the Health apps
// declaration updated and a new release.
import { Platform } from 'react-native';

export const HEALTH_FEATURES = Platform.OS !== 'android';
