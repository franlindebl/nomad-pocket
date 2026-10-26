// Placing a call from the app (emergency places, the family plan, the 112/911 buttons).
// openURL('tel:…') rejects where the device can't call (an iPad with no iPhone to relay
// through, a Wi-Fi-only Android tablet, calling restricted), and a bare call did
// nothing on screen: say so, with the number to dial from another phone.
import { Alert, Linking, Platform } from 'react-native';

import i18n from '@/i18n';

import { parsePhones, telUrl, type PhoneNumber } from './phone';

export function callNumber(phone: PhoneNumber): void {
  Linking.openURL(telUrl(phone)).catch(() =>
    Alert.alert(i18n.t('maps:call.failedTitle'), i18n.t('maps:call.failedBody', { number: phone.label })),
  );
}

/** Calls whatever a phone field holds; with several numbers, asks which one. */
export function callPhones(raw: string): void {
  // Android alerts take three buttons: two numbers and Cancel.
  const phones = parsePhones(raw, Platform.OS === 'android' ? 2 : 5);
  if (!phones.length) {
    Alert.alert(i18n.t('maps:call.failedTitle'), i18n.t('maps:call.invalid', { number: raw }));
  } else if (phones.length === 1) {
    callNumber(phones[0]);
  } else {
    Alert.alert(i18n.t('maps:call.chooseTitle'), undefined, [
      ...phones.map((p) => ({ text: p.label, onPress: () => callNumber(p) })),
      { text: i18n.t('common:actions.cancel'), style: 'cancel' as const },
    ]);
  }
}
