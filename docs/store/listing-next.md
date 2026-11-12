# Store texts for the first build with alerts push (draft, 2026-11-12)

The first iOS and Android builds that register with the alerts server (`server/alerts`, docs/ALERTS_PLAN.md phase 2)
make some earlier store texts untrue: "No recogemos ningún dato" and "Nomad Pocket no depende de ningún servidor
propio" (description since 2.0.0), "no push, no server of our own" (review notes since 2.3.0), and the privacy
answers "Data Not Collected" (App Store) / "No data collected" (Play). This file has the replacements. The owner
reviews them before they go into App Store Connect / Play Console with that release; copy them into that version's
`listing-<version>.md` then. `site/privacy.html` and the landing were updated on 2026-11-12.

## Description: the "TUYA Y DE NADIE MÁS" paragraph

**es** (replaces the paragraph from 2.0.0):

```
TUYA Y DE NADIE MÁS
Sin cuentas, sin anuncios, sin compras y sin rastreo. Gratis. Tu plan, tus contactos, tu ubicación y tus preguntas no salen de tu móvil. Mapas, guías, biblioteca y asistente no dependen de ningún servidor, así que no hay nada que pueda caerse. Solo los avisos oficiales al momento, si los activas, usan un pequeño servidor nuestro que no sabe quién eres: únicamente conoce la cuadrícula de unos 10 km en la que estás.
```

**en:**

```
YOURS AND NOBODY ELSE'S
No accounts, no ads, no purchases, no tracking. Free. Your plan, your contacts, your location and your questions never leave your phone. Maps, guides, library and assistant depend on no server, so there's nothing to go down. Only instant official alerts, if you turn them on, use a small server of ours that doesn't know who you are: all it knows is the grid square of about 10 km you're in.
```

## App Store privacy ("App Privacy" in App Store Connect)

From "Data Not Collected" to one type:
- **Location › Coarse Location**: collected; used for **App Functionality** only; **not linked** to the user's
  identity; **not used for tracking**. (The 0.1° cell; the push token is a delivery address, not a
  "Device ID" in Apple's sense, and nothing else is kept.)

## App Review notes (replace the "Official alerts" paragraph of 2.4.0)

```
Official alerts (off by default; Settings › Official alerts): the app reads the public warning feeds of AEMET (Spain), the US NWS, GDACS and USGS/EMSC, and checks on the device which warnings cover the user's last known position. With alerts on, the app also registers with our own small alerts server (Firebase, EU) so new warnings arrive at once as push notifications: it sends the APNs token, the 0.1° grid square of the last position (never the position), country, language, time zone and the chosen thresholds; turning alerts off deletes it. The server also reads EUMETNET's MeteoAlarm (most of Europe) and gives the app the MeteoAlarm warnings for its grid square, shown with the issuing national weather service, the time of issue, a link to meteoalarm.org and MeteoAlarm's delay notice, as its terms ask. Background modes "processing" and "fetch" remain for the on-device check, the fallback when the server can't be reached; no background location is used. Time Sensitive notifications only for red and tsunami warnings; no Critical Alerts. To try it: turn on Official alerts and allow notifications and location; in Spain the list shows AEMET's warnings in force (often none, and it says so).
```

## Google Play Data safety

- **Does your app collect or share any of the required user data types?** Yes.
- **Location › Approximate location**: collected, not shared; optional (only with official alerts on); purpose
  **App functionality**; not processed ephemerally (the server keeps the cell until alerts are off, the token dies
  or 90 days without a refresh).
- **App info and performance / Device or other IDs › Device or other IDs**: collected (the FCM registration
  token, so the server can deliver the alert), not shared; optional; App functionality.
- Encrypted in transit: yes (HTTPS). Deletion: turning alerts off deletes it; no account, so no deletion URL.
- Everything else as in `play-listing.md` (on-device only).
