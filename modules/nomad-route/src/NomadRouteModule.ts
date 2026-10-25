import { requireOptionalNativeModule } from 'expo';

import type { NomadRouteNativeModule } from './NomadRoute.types';

const native = requireOptionalNativeModule<NomadRouteNativeModule>('NomadRoute');

/** False in Expo Go / web, where the native module isn't compiled in. */
export function isNomadRouteAvailable(): boolean {
  return native != null;
}

const missing = new Proxy({} as NomadRouteNativeModule, {
  get() {
    throw new Error('nomad-route native module is not available in this build');
  },
});

export default (native ?? missing) as NomadRouteNativeModule;
