// Content updates at startup: the weekly check of the installed archives against Kiwix's
// catalog, a while after launch and when the app comes back to the foreground (it skips
// itself when the last check is recent). Countries need nothing here: maps/register.ts
// refreshes their catalogs at launch.
import { AppState } from 'react-native';

import { registerInit } from '@/features/bootstrap';

import { checkZimEditions } from './zim-check';

const check = () => void checkZimEditions().catch((e) => console.warn('[updates] check failed', e));

registerInit(() => {
  setTimeout(check, 10_000);
  AppState.addEventListener('change', (state) => {
    if (state === 'active') check();
  });
});
