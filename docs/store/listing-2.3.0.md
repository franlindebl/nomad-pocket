# App Store / Google Play listing 2.3.0 — DRAFT (owner to review)

Draft written with official alerts phase 1 (`docs/ALERTS_PLAN.md`), 2026-11-05. **Not reviewed by the owner yet:
nothing here goes to the stores until the owner does.** The version in `app.json` is still 2.2.0 (in review); bump it when
this ships. Name, subtitle, keywords and screenshots stay as in `listing-2.0.0.md` / `listing-2.2.0.md`. Rule for
every text: never "sistema de alertas de emergencia" / "emergency alert system"; always say the warnings are the
official services' own and that the authorities' cell broadcast (ES-Alert) and 112 are what count.

## Description: a new line in the "En una emergencia" / "In an emergency" section

- es: `• Avisos oficiales (opcional): los avisos naranja y rojo de AEMET para tu zona y los terremotos fuertes cercanos, para prepararte mientras hay conexión. No sustituyen a ES-Alert ni al 112`
- en: `• Official alerts (optional): orange and red weather warnings for your area and strong earthquakes nearby, so you can prepare while you're still online. They don't replace your authorities' alerts or 112/911`

## What's new in 2.3.0

**es:**

```
Nomad Pocket 2.3 te avisa de lo que publican los servicios oficiales donde estás.

• Avisos oficiales (opcional): te avisa cuando AEMET publica un aviso naranja o rojo para tu zona o hay un terremoto fuerte cerca, con el texto oficial y qué hacer en la app: el mapa de la zona, tu plan familiar, el kit y la guía
• Tu ubicación no sale del móvil: la app descarga los avisos y comprueba en el teléfono si te afectan
• En EE. UU., los avisos del Servicio Meteorológico Nacional; en otros países, las alertas naranja y rojas de GDACS
• Nomad Pocket no emite avisos: los de Protección Civil en el móvil (ES-Alert) y el 112 son los que valen
```

**en:**

```
Nomad Pocket 2.3 tells you what official services publish where you are.

• Official alerts (optional): get notified when a national weather service issues an orange or red warning for your area or there's a strong earthquake nearby, with the official text and what to do in the app: the area's map, your family plan, the kit and the guide
• Your location never leaves your phone: the app downloads the warnings and checks on the phone whether they affect you
• In the US, National Weather Service alerts; in other countries, GDACS orange and red alerts
• Nomad Pocket doesn't issue alerts: your authorities' alerts on your phone and 112/911 are what count
```

## App Review notes (App Store)

Add after the background modes paragraph:

```
Official alerts (new, off by default; Settings › Official alerts, or the last step of the first-run setup): the app downloads the public warning feeds of AEMET (Spain), the US National Weather Service, GDACS and the USGS/EMSC earthquake feeds, decides on the device which warnings cover the user's last known position, and shows local notifications (no push, no server of our own). Background modes "processing" and "fetch" are there for this: expo-background-task asks BGTaskScheduler to run the check now and then; the app never uses location in the background for it (it uses the last position seen while the app was open). Time Sensitive notifications (entitlement com.apple.developer.usernotifications.time-sensitive) are used only for red warnings and tsunami warnings; orange ones are "active". No Critical Alerts. To try it: turn on Official alerts, allow notifications and location; with a position in Spain the list shows AEMET's warnings in force there (often none: the list then says so).
```

## Google Play

- Data safety: unchanged (nothing collected by us; the NWS request in the US carries a position rounded to ~5 km,
  "approximate location, shared with a third party, not collected by the developer, optional": the owner to decide
  whether Play counts that as "shared"; the iPhone labels stay "Data Not Collected").
- What's new: the "es" / "en" texts above, trimmed to 500 characters.
