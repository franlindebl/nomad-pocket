// The one notification handler of the app. expo-notifications keeps a single handler (the last set wins), and two
// features notify: the kit's expiry reminders (quiet) and official alerts (with sound). Each notification says
// which it is in `data.kind`; features register how theirs are shown here instead of setting a handler.
import { setNotificationHandler, type NotificationBehavior } from 'expo-notifications';

const QUIET: NotificationBehavior = { shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false };

const behaviours = new Map<string, NotificationBehavior>();
let installed = false;

/** How a notification of `kind` shows while the app is open (default: banner, no sound). Idempotent. */
export function setNotificationBehaviour(kind: string, behaviour: NotificationBehavior = QUIET) {
  behaviours.set(kind, behaviour);
  if (installed) return;
  installed = true;
  setNotificationHandler({
    handleNotification: async (n) => {
      const kind = n.request.content.data?.kind;
      return (typeof kind === 'string' && behaviours.get(kind)) || QUIET;
    },
  });
}
