# App Store listing 2.5.0

2.5.0 (52) is 2.4.3 (50) plus official alerts as real push notifications from our own alerts server
(`server/alerts`, docs/ALERTS_PLAN.md phase 2: AEMET, NWS, MeteoAlarm for most of Europe, USGS/EMSC, GDACS),
MeteoAlarm warnings in the app for most of Europe (through the server), and the alerts screen naming the national
service that issued a MeteoAlarm warning. The official points added for other countries since 2.4.3 reach people
through the country packs, not this build.

The first build with the alerts server changes three things beyond "What's new", all in `listing-next.md`:
the description's "TUYA Y DE NADIE MÁS" paragraph, **App Privacy** (Data Not Collected → Coarse Location, App
Functionality, not linked, no tracking: set by hand in App Store Connect, the API can't) and the App Review notes'
"Official alerts" paragraph. Everything else as 2.4.3. es-MX = es-ES, en-GB = en-US, as before.

## What's new in 2.5.0

**es:**

```
Nomad Pocket 2.5.0 trae los avisos oficiales al momento.

• Avisos al momento: con los avisos oficiales activados, te llega una notificación en cuanto se publica un aviso naranja o rojo, o un terremoto fuerte cerca, aunque no abras la app. Un pequeño servidor nuestro consulta las fuentes cada minuto y solo conoce tu cuadrícula de unos 10 km
• Europa: los avisos meteorológicos oficiales de la mayoría de países europeos (EUMETNET – MeteoAlarm), con el servicio meteorológico nacional que los emite
• Si el servidor no responde, la app sigue comprobando los avisos por su cuenta
```

**en:**

```
Nomad Pocket 2.5.0 brings official alerts the moment they're issued.

• Instant alerts: with official alerts on, you get a notification as soon as an orange or red warning, or a strong earthquake nearby, is published, even if you don't open the app. A small server of ours checks the sources every minute and only knows your grid square of about 10 km
• Europe: official weather warnings for most European countries (EUMETNET – MeteoAlarm), with the national weather service that issued them
• If the server doesn't answer, the app keeps checking for alerts by itself
```

## What went into App Store Connect (2026-11-12)

Version 2.5.0 created through the API (auto-release), with "What's new" above and these changes from `listing-next.md`,
which App Store Connect's limits forced:

- **Description** (es 4090 characters with the draft paragraph, the limit is 4000): the sentence "tu plan, tus
  contactos, tu ubicación y tus preguntas no salen de tu móvil" became "Tu plan, tus contactos y tus preguntas no salen
  de tu móvil." (and the same in English). It also stays true without the old "(with official alerts on in the US, the
  National Weather Service receives your approximate area)": location now leaves the phone with alerts on (the cell to
  our server, a rounded position to the NWS), and the paragraph's last sentence says so for our server.

  **es / es-MX:**

  ```
TUYA Y DE NADIE MÁS
Sin cuentas, sin anuncios, sin compras y sin rastreo. Gratis. Tu plan, tus contactos y tus preguntas no salen de tu móvil. Mapas, guías, biblioteca y asistente no dependen de ningún servidor, así que no hay nada que pueda caerse. Solo los avisos oficiales al momento, si los activas, usan un pequeño servidor nuestro que no sabe quién eres: únicamente conoce la cuadrícula de unos 10 km en la que estás.
  ```

  **en-US / en-GB:**

  ```
YOURS AND NOBODY ELSE'S
No accounts, no ads, no purchases, no tracking. Free. Your plan, your contacts and your questions never leave your phone. Maps, guides, library and assistant depend on no server, so there's nothing to go down. Only instant official alerts, if you turn them on, use a small server of ours that doesn't know who you are: all it knows is the grid square of about 10 km you're in.
  ```

- **App Review notes** (4599 characters with the draft paragraph, the limit is 4000): the "Official alerts" paragraph
  shortened (MeteoAlarm and its terms added), "It has no server of its own" → "its only server of its own is the optional
  official alerts server described below", notifications "local, and push from our alerts server", the CarPlay paragraph
  shortened and the "Map answers" paragraph dropped (in review since 2.4.0). Full text as sent:

  ```
Nomad Pocket is completely free: no in-app purchases, no subscriptions, no ads, no accounts and no paid content. It makes no money; its only server of its own is the optional official alerts server described below; it is an open source project (GPL-3.0, https://github.com/franlindebl/nomad-pocket). All content is free, openly licensed public data downloaded from its original public servers: Wikipedia and other archives from Kiwix and its mirrors, OpenStreetMap maps and routing packages built from OpenStreetMap and published on the project's GitHub Releases, and optional open AI models from Hugging Face.

How to review: no sign-in is needed. On first launch, pick a country (preselected from the device region) and the app proposes a kit sized for the free space; downloading it takes a few minutes on Wi-Fi (a small country such as Andorra downloads in seconds). After that, everything works in airplane mode: the map with routes and search, Emergency (nearby hospitals, pharmacies, water…), the emergency guide, the library reader, the AI assistant and Preparedness.

Background modes: location is used in the background only while the user is following turn-by-turn directions they started ("Start" on a route), so guidance continues with the screen locked; it is never stored or sent. Audio is used for the spoken turn-by-turn prompts during that guidance, which lower other audio while they play. To try it: download Andorra, open Maps, tap a place, choose "Take me there" and then "Start".

CarPlay (navigation app entitlement, Case-ID 23304795): offline map following the driver, destinations (offline search, saved places, "Emergency nearby"), trip preview and turn-by-turn guidance with voice prompts; routes are calculated on the device. To try it: download Andorra on the phone (Maps), connect to CarPlay (or the CarPlay Simulator), open Nomad Pocket, pick a destination and "Go".

Official alerts (off by default; Settings › Official alerts): warnings from AEMET (Spain), the US NWS, MeteoAlarm (most of Europe), GDACS and USGS/EMSC for the user's last known position, pushed at once by our own small alerts server (Firebase, EU). It keeps only the APNs token, the 0.1° grid square of the last position (never the position), country, language, time zone and thresholds; turning alerts off deletes it. MeteoAlarm warnings reach the app through that server and show the issuing national weather service, time of issue and a link to meteoalarm.org, as MeteoAlarm's terms ask. Background modes "processing" and "fetch" keep an on-device check as the fallback when the server can't be reached; no background location. Time Sensitive only for red and tsunami warnings; no Critical Alerts. To try it: turn on Official alerts and allow notifications and location; in Spain the list shows AEMET's warnings in force (often none, and it says so).

Permissions: location (while in use, and in the background only during navigation as above) shows the user on the offline map and sorts emergency points by distance. Microphone and speech recognition are used only when the user taps the dictate button in the assistant; recognition runs on the device (requiresOnDeviceRecognition) and nothing is stored or sent. Notifications: local reminders for expiry dates in the emergency bag checklist, and the optional official alerts above (local, and push from our alerts server). The app never accesses the photo library (the purpose string is there because a bundled library references the Photos framework).

The emergency guide is bundled with the app: 202 cards, each from a cited official source or labelled as our own wording. The AI assistant runs on the device (Apple Intelligence when available, otherwise a downloadable open model through llama.cpp); nothing is sent to any server. Medical content shows a "not medical advice" notice.
  ```
