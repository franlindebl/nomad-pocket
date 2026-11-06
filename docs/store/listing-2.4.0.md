# App Store listing 2.4.0

2.4.0 (46) is the first store release since 2.2.0: it carries 2.3.0/2.3.1 (official alerts, TestFlight only, its draft
in `listing-2.3.0.md`) plus the assistant's map answers and this week's polish. Name, subtitle, promotional text,
keywords and screenshots stay as in `listing-2.0.0.md` / `listing-2.2.0.md`. Changes: "What's new", two description
lines (short: the description is near its 4000-character limit), one sentence in the privacy paragraph, and the App Review notes. es-MX = es-ES, en-GB = en-US, as before.

Rule for the alert texts (owner, 2026-11-05): never "sistema de alertas de emergencia" / "emergency alert system";
the warnings are the official services' own; point to ES-Alert / the authorities' alerts and 112.

## Description

"En una emergencia" / "When the emergency comes", after the emergency bag line:

- es: `• Avisos oficiales (opcional): los avisos naranja y rojo de AEMET y los terremotos fuertes cerca de ti. No sustituyen a ES-Alert ni al 112`
- en: `• Official alerts (optional): orange and red weather warnings and strong earthquakes near you. They don't replace your authorities' alerts or 112/911`

"Una IA que no necesita internet" / "An AI that doesn't need the internet", after the first line:

- es: `• Pregúntale por el mapa: la farmacia más cercana, cómo llegar o dónde estás`
- en: `• Ask it about the map: the nearest pharmacy, how to get somewhere or where you are`

Privacy paragraph: the NWS gets a rounded position in the US when alerts are on, so "never leave your phone" needs
the exception:

- es: `…tu ubicación y tus preguntas no salen de tu móvil.` → `…tu ubicación y tus preguntas no salen de tu móvil (con los avisos oficiales en EE. UU., el Servicio Meteorológico Nacional recibe tu zona aproximada).`
- en: `…your location and your questions never leave your phone.` → `…your location and your questions never leave your phone (with official alerts on in the US, the National Weather Service receives your approximate area).`

## What's new in 2.4.0

**es:**

```
Nomad Pocket 2.4 te avisa de lo que publican los servicios oficiales y responde preguntas sobre el mapa.

• Avisos oficiales (opcional): te avisa cuando AEMET publica un aviso naranja o rojo para tu zona o hay un terremoto fuerte cerca, con el texto oficial y qué hacer en la app: el mapa de la zona, tu plan familiar, el kit y la guía
• En EE. UU., los avisos del Servicio Meteorológico Nacional; en otros países, las alertas naranja y rojas de GDACS
• El asistente entiende el mapa: «¿dónde está la farmacia más cercana?», «llévame al hospital», «¿dónde estoy?», «¿llego antes de que anochezca?». Responde con tarjetas de tu mapa sin conexión
• Biblioteca más cómoda: títulos completos en las listas y un botón para limpiar las lecturas recientes
• Un mapa actualizado se ve al momento, sin reiniciar la app
• Nomad Pocket no emite avisos: en una emergencia, sigue siempre las alertas de Protección Civil en el móvil (ES-Alert) y llama al 112
```

**en:**

```
Nomad Pocket 2.4 tells you what official services publish and answers questions about the map.

• Official alerts (optional): get notified when a national weather service issues an orange or red warning for your area or there's a strong earthquake nearby, with the official text and what to do in the app: the area's map, your family plan, the kit and the guide
• In the US, National Weather Service alerts; in other countries, GDACS orange and red alerts
• The assistant understands the map: "where's the nearest pharmacy?", "take me to the hospital", "where am I?", "can I get there before dark?". It answers with cards from your offline map
• A friendlier library: full titles in the lists and a button to clear recent reading
• An updated map shows up right away, without restarting the app
• Nomad Pocket doesn't issue alerts: in an emergency, always follow your authorities' alerts on your phone and call 112/911
```

## App Review notes

The 2.2.0 notes (the field takes 4000 characters, hence the short paragraphs) with:

- "CarPlay (new in this version, navigation app entitlement…" → "CarPlay (navigation app entitlement…".
- Notifications sentence: "Notifications are local: reminders for expiry dates in the emergency bag checklist, and the
  optional official alerts below."
- The emergency guide sentence without its "(Spanish and US government … agencies)" aside.
- After the CarPlay paragraph:

```
Official alerts (new, off by default; Settings › Official alerts): the app downloads the public warning feeds of AEMET (Spain), the US NWS, GDACS and USGS/EMSC, checks on the device which warnings cover the user's last known position and shows local notifications (no push, no server of our own). Background modes "processing" and "fetch" are for this: expo-background-task runs the check now and then; no background location is used for it. Time Sensitive notifications only for red and tsunami warnings; no Critical Alerts. To try it: turn on Official alerts and allow notifications and location; in Spain the list shows AEMET's warnings in force (often none, and it says so).

Map answers (new): the assistant answers "nearest pharmacy", "take me to the hospital" or "where am I" from the downloaded map as cards, never written by the AI model. To try it: download Andorra (Maps), then ask the assistant "nearest pharmacy".
```
