// Dictation in the chat composer with the OS's own speech recognizer (expo-speech-recognition),
// always on the device: the audio never leaves the phone and no model of ours is involved.
// iOS: SFSpeechRecognizer with requiresOnDeviceRecognition, offered only for a locale that has
// it (otherwise iOS would quietly use Apple's servers: nomad-llm's supportsOnDeviceDictation).
// Android 13+: the on-device recognizer, whose language pack may need a one-off download.
import { getLocales } from 'expo-localization';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, AppState, Linking, Platform } from 'react-native';

import i18n from '@/i18n';

import { supportsOnDeviceDictation } from '../../../modules/nomad-llm';
import { dictationLocale } from './dictation-core';

// createOnDeviceSpeechRecognizer exists since Android 12, but the library only uses it from 13:
// below, it would fall back to Google's recognizer, which may send the audio to Google.
const ANDROID_ON_DEVICE_API = 33;

function deviceLocales() {
  return getLocales().map((l) => l.languageTag);
}

function canDictate(locale: string): boolean {
  try {
    if (Platform.OS === 'ios') return supportsOnDeviceDictation(locale);
    if (Platform.OS === 'android')
      return Number(Platform.Version) >= ANDROID_ON_DEVICE_API && ExpoSpeechRecognitionModule.supportsOnDeviceRecognition();
  } catch (e) {
    console.warn('[dictation] availability check failed', e);
  }
  return false;
}

function permissionAlert() {
  Alert.alert(i18n.t('assistant:dictation.deniedTitle'), i18n.t('assistant:dictation.deniedBody'), [
    { text: i18n.t('common:actions.cancel'), style: 'cancel' },
    { text: i18n.t('assistant:dictation.openSettings'), onPress: () => Linking.openSettings() },
  ]);
}

/** Android: the language pack isn't on the phone. The download is the system's, once, with a connection. */
function offerLanguageDownload(locale: string) {
  Alert.alert(i18n.t('assistant:dictation.packTitle'), i18n.t('assistant:dictation.packBody'), [
    { text: i18n.t('common:actions.cancel'), style: 'cancel' },
    {
      text: i18n.t('assistant:dictation.packDownload'),
      onPress: () => {
        ExpoSpeechRecognitionModule.androidTriggerOfflineModelDownload({ locale })
          .then((r) => {
            if (r.status !== 'opened_dialog')
              Alert.alert(i18n.t('assistant:dictation.packStarted'), i18n.t('assistant:dictation.packStartedBody'));
          })
          .catch(() => Alert.alert(i18n.t('assistant:dictation.packTitle'), i18n.t('assistant:dictation.packFailed')));
      },
    },
  ]);
}

export type Dictation = {
  /** False where the phone can't recognise this language on the device: no microphone then. */
  available: boolean;
  listening: boolean;
  /** Microphone level while listening, 0–1. */
  level: number;
  start: () => Promise<void>;
  /** Stops listening and keeps what was recognised so far. */
  stop: () => void;
  /** Stops listening and drops anything still on its way. */
  cancel: () => void;
};

/**
 * `onText` gets everything said since `start()` (it grows as the person speaks). Listening ends
 * on its own after a pause, with `stop()`, or when the app goes to the background.
 */
export function useDictation(onText: (spoken: string) => void): Dictation {
  const lang = i18n.language === 'es' ? 'es' : 'en';
  const locale = useMemo(() => dictationLocale(lang, deviceLocales()), [lang]);
  const isAvailable = useMemo(() => canDictate(locale), [locale]);

  const [listening, setListening] = useState(false);
  const [level, setLevel] = useState(0);
  // Results that arrive after cancel() (the recognizer is asynchronous) are dropped.
  const active = useRef(false);
  // The locale actually asked for (Android may pick another of the same language).
  const asked = useRef(locale);
  const onTextRef = useRef(onText);
  useEffect(() => {
    onTextRef.current = onText;
  });

  useSpeechRecognitionEvent('result', (e) => {
    if (active.current) onTextRef.current(e.results[0]?.transcript ?? '');
  });
  useSpeechRecognitionEvent('volumechange', (e) => {
    if (active.current) setLevel(Math.max(0, Math.min(1, e.value / 10)));
  });
  useSpeechRecognitionEvent('end', () => {
    active.current = false;
    setListening(false);
    setLevel(0);
  });
  useSpeechRecognitionEvent('error', (e) => {
    if (e.error === 'not-allowed') permissionAlert();
    else if (e.error === 'language-not-supported' && Platform.OS === 'android') offerLanguageDownload(asked.current);
    // Silence, an interruption (a call) or our own cancel: nothing to tell.
    else if (!['aborted', 'no-speech', 'speech-timeout', 'interrupted'].includes(e.error)) console.warn('[dictation]', e.error, e.message);
  });

  const cancel = useCallback(() => {
    if (!active.current) return;
    active.current = false;
    ExpoSpeechRecognitionModule.abort();
  }, []);

  const stop = useCallback(() => {
    if (active.current) ExpoSpeechRecognitionModule.stop();
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') cancel();
    });
    return () => {
      sub.remove();
      cancel();
    };
  }, [cancel]);

  const start = useCallback(async () => {
    if (active.current || !isAvailable) return;
    // On-device recognition needs only the microphone (no speech recognition permission on iOS).
    let perm = await ExpoSpeechRecognitionModule.getMicrophonePermissionsAsync();
    if (!perm.granted && perm.canAskAgain) perm = await ExpoSpeechRecognitionModule.requestMicrophonePermissionsAsync();
    if (!perm.granted) {
      if (!perm.canAskAgain) permissionAlert();
      return;
    }
    let target = locale;
    if (Platform.OS === 'android') {
      // An empty installed list means "unknown" (often on Android 13): try, and offer the download on error.
      const { locales, installedLocales } = await ExpoSpeechRecognitionModule.getSupportedLocales({}).catch(() => ({
        locales: [] as string[],
        installedLocales: [] as string[],
      }));
      target = dictationLocale(lang, deviceLocales(), locales);
      if (installedLocales.length && !installedLocales.some((l) => l.toLowerCase() === target.toLowerCase())) {
        offerLanguageDownload(target);
        return;
      }
    }
    asked.current = target;
    active.current = true;
    setListening(true);
    ExpoSpeechRecognitionModule.start({
      lang: target,
      interimResults: true,
      // Ends by itself after a pause: one question at a time.
      continuous: false,
      requiresOnDeviceRecognition: true,
      addsPunctuation: true,
      iosTaskHint: 'dictation',
      volumeChangeEventOptions: { enabled: true, intervalMillis: 120 },
    });
  }, [isAvailable, lang, locale]);

  return { available: isAvailable, listening, level, start, stop, cancel };
}
