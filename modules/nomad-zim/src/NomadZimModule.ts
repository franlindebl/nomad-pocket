import { requireOptionalNativeModule } from 'expo';

import type { NomadZimNativeModule } from './NomadZim.types';

const native = requireOptionalNativeModule<NomadZimNativeModule>('NomadZim');

/** False in Expo Go / web, where the native module isn't compiled in. */
export function isNomadZimAvailable(): boolean {
  return native != null;
}

const missing = new Proxy({} as NomadZimNativeModule, {
  get() {
    throw new Error('nomad-zim native module is not available in this build');
  },
});

export default (native ?? missing) as NomadZimNativeModule;
