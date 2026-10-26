// The question "Wi-Fi only" asks when a download is started on mobile data: wait for Wi-Fi
// (the default) or use mobile data for these downloads. The setting itself never changes
// from here. The manager decides when to ask (once per batch: a country or a kit is one
// question); this only shows it.
import { Alert } from 'react-native';

import i18n from '@/i18n';

export function askAboutMobileData(titles: string[], answer: (useMobileData: boolean) => void) {
  let answered = false;
  const reply = (useMobileData: boolean) => {
    if (answered) return;
    answered = true;
    answer(useMobileData);
  };
  const body =
    titles.length === 1 ? i18n.t('downloads.wifi.bodyOne', { title: titles[0] }) : i18n.t('downloads.wifi.bodyMany', { count: titles.length });
  Alert.alert(
    i18n.t('downloads.wifi.title'),
    body,
    [
      { text: i18n.t('downloads.wifi.wait'), style: 'cancel', onPress: () => reply(false) },
      { text: i18n.t('downloads.wifi.useMobileData'), onPress: () => reply(true) },
    ],
    // Android: tapping outside the dialog means "wait".
    { cancelable: true, onDismiss: () => reply(false) },
  );
}
