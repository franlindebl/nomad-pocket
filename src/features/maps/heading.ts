// Compass heading of the screen's top, for the guidance arrow, the heading beam and
// the on-foot navigation camera. expo-location measures along the device's portrait
// top (it never sets CLLocationManager.headingOrientation on iOS nor remaps the axes
// on Android), so in landscape (an iPad, a car mount) everything pointed 90° off.
// expo-screen-orientation says how the interface is turned. Its change event rides on
// the window size on Android, which a 180° flip (landscape to landscape) doesn't
// change, so there the orientation is also re-read every couple of seconds.
// Android tablets whose natural orientation is landscape report rotation 0 as
// LANDSCAPE_RIGHT and stay 90° off: rare, and expo-screen-orientation hides the raw value.
import * as Location from 'expo-location';
import * as ScreenOrientation from 'expo-screen-orientation';
import { Platform } from 'react-native';

import { screenHeading, type InterfaceOrientation } from './geo';

export type ScreenHeading = {
  /** Degrees clockwise from true north (magnetic when true north is unavailable). */
  deg: number;
  /** expo-location's calibration level: 3 best … 0 unreliable. */
  accuracy: number;
};

const ORIENTATION_POLL_MS = 2000;

const ORIENTATIONS: Record<ScreenOrientation.Orientation, InterfaceOrientation> = {
  [ScreenOrientation.Orientation.UNKNOWN]: 'unknown',
  [ScreenOrientation.Orientation.PORTRAIT_UP]: 'portraitUp',
  [ScreenOrientation.Orientation.PORTRAIT_DOWN]: 'portraitDown',
  [ScreenOrientation.Orientation.LANDSCAPE_LEFT]: 'landscapeLeft',
  [ScreenOrientation.Orientation.LANDSCAPE_RIGHT]: 'landscapeRight',
};

/** Like Location.watchHeadingAsync, turned to the screen; rejects without a compass. */
export async function watchScreenHeading(onHeading: (h: ScreenHeading) => void): Promise<{ remove: () => void }> {
  let orientation: InterfaceOrientation = 'unknown';
  const read = () =>
    ScreenOrientation.getOrientationAsync()
      .then((o) => {
        orientation = ORIENTATIONS[o] ?? 'unknown';
      })
      .catch(() => {});
  await read();
  const change = ScreenOrientation.addOrientationChangeListener((e) => {
    orientation = ORIENTATIONS[e.orientationInfo.orientation] ?? 'unknown';
  });
  const poll = Platform.OS === 'android' ? setInterval(read, ORIENTATION_POLL_MS) : null;
  const release = () => {
    if (poll) clearInterval(poll);
    change.remove();
  };
  try {
    const sub = await Location.watchHeadingAsync((h) => {
      const deg = h.trueHeading >= 0 ? h.trueHeading : h.magHeading;
      if (deg >= 0) onHeading({ deg: screenHeading(deg, orientation), accuracy: h.accuracy });
    });
    return {
      remove: () => {
        release();
        sub.remove();
      },
    };
  } catch (e) {
    release();
    throw e;
  }
}
