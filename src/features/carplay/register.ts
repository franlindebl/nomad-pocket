// CarPlay wiring: the car's screen follows guidance from startup (carplay.ts; iOS only).
import { registerInit } from '@/features/bootstrap';

import { startCarPlay } from './carplay';

registerInit(() => {
  startCarPlay();
});
