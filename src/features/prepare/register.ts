// Preparedness feature wiring: the notification handler for kit expiry reminders.
import { registerInit } from '@/features/bootstrap';

import { initReminders } from './reminders';

registerInit(initReminders);
