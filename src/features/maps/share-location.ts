// The "this is where I am" message: coordinates, UTM, accuracy, time and an OpenStreetMap link, sent
// through the share sheet or prefilled in an SMS (SMS often gets through with weak coverage and no data).
// Used by the Emergencias sheet and the assistant's map answers. Sending is always the person's tap.
import { Linking, Platform, Share } from 'react-native';

import i18n from '@/i18n';
import { formatDistance } from '@/lib/format';

import { formatLatLon, formatUtm, toUtm } from './geo';

export type Fix = { lat: number; lon: number; accuracy: number | null; at: number };

export function locationMessage(fix: Fix): string {
  const utm = toUtm(fix.lat, fix.lon);
  const time = new Intl.DateTimeFormat(i18n.language, { hour: '2-digit', minute: '2-digit' }).format(fix.at);
  const lat = fix.lat.toFixed(5);
  const lon = fix.lon.toFixed(5);
  return i18n.t('maps:emergency.shareMessage', {
    coords: formatLatLon(fix.lat, fix.lon),
    utm: utm ? formatUtm(utm) : '—',
    accuracy: formatDistance(fix.accuracy ?? 0, 1),
    time,
    url: `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=17/${lat}/${lon}`,
  });
}

export function shareLocation(fix: Fix) {
  Share.share({ message: locationMessage(fix) }).catch(() => {});
}

/** Opens the SMS app with the message (and the number, when given). The body's separator differs: iOS `&`, Android `?`. */
export function smsLocation(fix: Fix, phone?: string | null) {
  const to = (phone ?? '').replace(/[^\d+]/g, '');
  const body = encodeURIComponent(locationMessage(fix));
  const url = Platform.OS === 'ios' ? `sms:${to}&body=${body}` : `sms:${to}?body=${body}`;
  Linking.openURL(url).catch(() => shareLocation(fix));
}
