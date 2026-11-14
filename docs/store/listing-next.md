# Store texts for the next release (draft, 2026-11-13)

The first alerts-push texts of the previous draft went into App Store Connect with 2.5.0 (what was sent, and the
App Privacy change to Coarse Location: `listing-2.5.0.md`). This draft is the next one: the App Store description
with the corrections of the 2026-11-13 audit of the public texts against the app (`docs/PROGRESS.md`, same date),
already applied to the README and nomad-pocket.app. The owner reviews it before it goes into App Store Connect with
the next version; copy it into that version's `listing-<version>.md` then. Name, subtitle, promotional text,
keywords, screenshots and App Review notes stay as in 2.5.0. es-MX = es-ES, en-GB = en-US, as before.

## App Store description (whole text, replaces the current one)

Built from the live one (2.0.0 + the CarPlay line of 2.2.0 + the alerts and map lines of 2.4.0 + the privacy
paragraph of 2.5.0). What changes and why:

- Updates: courses too, not only maps and archives.
- Guide: "de fuentes oficiales" → "basadas en fuentes oficiales" (114 of the 202 cards are official texts, 88 our
  wording following official guidelines, as each card says).
- Emergency points: health centres and fuel stations named; "refugios" dropped (any OSM shelter, bus stops
  included); "por distancia y dirección" said less (the list is by distance); official health registers in 25+
  countries (2.4.3 and the packs since).
- The emergency number is the one of the country you're in (worked out offline from the position).
- Alerts: MeteoAlarm and the NWS, and "as soon as they're issued" (push since 2.5.0).
- Maps: routes across borders; the speed limit only by car, where OSM has it ("aviso con el límite de cada vía"
  claimed more); "casi todos los países" → 241 countries and territories.
- Library: Wikipedia in Spanish or English; "Más de 100 archivos" → 80 (the 104 catalog entries include 14
  courses and 10 Wikipedia sizes); PDF guides.
- AI: a downloaded model first, Apple Intelligence second (the app recommends the downloaded one).
- Credits: official health registers and weather services added to the data sources (AEMET's terms ask not to
  imply endorsement: "no está afiliada a ellos" covers them).
- Trimmed to fit 4000 characters: the updates and emergency-points lines, the intro's last sentence (es), "modo
  oscuro" (the whole app is dark; the paper page stays), "desde el primer segundo".

**es** (3978 characters):

```
¿Y si mañana se cae internet?

Un apagón, un ciberataque, una tormenta o un fallo informático masivo, y tu móvil se queda mudo: sin mapas, sin buscador, sin respuestas. Justo cuando más lo necesitas.

Nomad Pocket es tu kit de supervivencia offline: sigue funcionando cuando todo lo demás falla. Prepáralo hoy en un minuto, mientras tienes conexión. Mañana, sin red, tu móvil seguirá sabiendo dónde estás, cómo llegar, dónde está el hospital más cercano y qué hacer ante una herida. Solo necesita batería.

LISTO EN UN MINUTO
• Elige tu país y descarga tu kit: una propuesta a la medida de tu país y del espacio de tu teléfono
• Déjalo descargando con wifi; después, todo funciona sin conexión
• Inicio te dice lo preparado que estás y lo que te falta, para completarlo mientras aún hay red
• Te avisa de versiones nuevas de tus mapas, archivos y cursos, y los actualiza sin perder la copia antigua hasta que la nueva está lista

CUANDO LLEGA LA EMERGENCIA
• Guía de emergencias: más de 200 fichas paso a paso basadas en fuentes oficiales (reanimación, hemorragias, quemaduras, atragantamiento, incendios, inundaciones…), en la app desde el primer minuto
• Hospitales, centros de salud, farmacias, desfibriladores, policía, bomberos, agua potable y gasolineras cerca de ti, con un toque para que te guíe; en más de 25 países, con los registros sanitarios oficiales
• Llama al número de emergencias del país en el que estás y comparte tu posición exacta (coordenadas y UTM) por mensaje
• Avisos oficiales (opcional): te llegan al momento los avisos naranja y rojo de AEMET, MeteoAlarm o el NWS y los terremotos fuertes cerca de ti. No sustituyen a ES-Alert ni al 112
• Plan familiar: puntos de encuentro, contactos y datos médicos de cada uno, también en PDF
• Mochila de emergencia a la medida de tu hogar con avisos de caducidad

MAPAS QUE NO SE APAGAN
• Tu país entero en el móvil: cada calle, camino y edificio
• Rutas en coche, a pie y en bici sin conexión, también entre países, con indicaciones por voz que siguen guiándote con la pantalla bloqueada
• CarPlay: el mapa y la navegación giro a giro en la pantalla del coche, también sin cobertura
• En coche, el límite de velocidad de la vía y un aviso si lo superas
• Toca cualquier punto del mapa para saber qué es; busca calles, portales y lugares sin internet
• Mapas de 241 países y territorios, y un mapa del mundo incluido

TODO EL CONOCIMIENTO, SIN RED
• Wikipedia en español o inglés, entera o sus mejores artículos, según tu espacio
• 80 archivos: medicina y primeros auxilios, supervivencia, agua y alimentos, agricultura, reparaciones, guías en PDF… y miles más del catálogo de Kiwix
• Búsqueda de texto completo, marcadores y modo papel
• 14 cursos para aprender lo que haga falta

UNA IA QUE NO NECESITA INTERNET
• Pregúntale «¿cómo potabilizo agua?» en mitad de la nada: responde con tu biblioteca y te enseña las fuentes
• Pregúntale por el mapa: la farmacia más cercana, cómo llegar o dónde estás
• Funciona en tu teléfono, con un modelo abierto que descargas o con Apple Intelligence; las preguntas urgentes las responde con la guía incluso sin modelo
• Dicta tus preguntas; tu voz se procesa en el propio dispositivo

TUYA Y DE NADIE MÁS
Sin cuentas, sin anuncios, sin compras y sin rastreo. Gratis. Tu plan, tus contactos y tus preguntas no salen de tu móvil. Mapas, guías, biblioteca y asistente no dependen de ningún servidor, así que no hay nada que pueda caerse. Solo los avisos oficiales al momento, si los activas, usan un pequeño servidor nuestro que no sabe quién eres: únicamente conoce la cuadrícula de unos 10 km en la que estás.

Código abierto (GPL-3.0), inspirado en Project N.O.M.A.D. Datos de OpenStreetMap, Wikipedia, Kiwix, Protomaps, registros sanitarios oficiales y servicios meteorológicos; Nomad Pocket no está afiliada a ellos.

La IA puede equivocarse y la información médica no sustituye a un profesional. En una emergencia, llama siempre a los servicios de emergencia si puedes.
```

**en** (3961 characters):

```
What if the internet goes down tomorrow?

A blackout, a cyberattack, a storm or a massive IT failure, and your phone goes silent: no maps, no search, no answers. Right when you need them most.

Nomad Pocket is your offline survival kit: it keeps working when everything else fails. Set it up today in a minute, while you're online. Tomorrow, with no network, your phone still knows where you are, how to get where you need to go, where the nearest hospital or drinking water is, and what to do about a wound. All it needs is battery.

READY IN A MINUTE
• Pick your country and download your kit: one proposal sized for your country and your phone's storage
• Leave it on Wi-Fi; from then on, everything works offline
• Home tells you how prepared you are and what's missing, so you can finish while the network is still up
• It tells you when your maps, archives and courses have newer versions, and updates them keeping the old copy until the new one is ready

WHEN THE EMERGENCY COMES
• Emergency guide: 200+ step-by-step cards based on official sources (CPR, bleeding, burns, choking, fires, floods…), in the app from the first minute
• Hospitals, health centres, pharmacies, defibrillators, police, fire stations, drinking water and fuel near you, one tap to be guided there; in 25+ countries, with official health registers
• Call the emergency number of the country you're in and share your exact position (coordinates and UTM) by message
• Official alerts (optional): orange and red warnings from AEMET, MeteoAlarm or the NWS and strong earthquakes near you, as soon as they're issued. They don't replace your authorities' alerts or 112/911
• Family plan: meeting points, contacts and everyone's medical details, also as a PDF
• Emergency bag sized to your household with expiry reminders

MAPS THAT DON'T SWITCH OFF
• Your whole country on your phone: every street, path and building
• Offline routes by car, on foot and by bike, across borders too, with spoken directions that keep guiding you with the screen locked
• CarPlay: the map and turn-by-turn navigation on your car's screen, even with no coverage
• By car, the road's speed limit and a warning when you go over it
• Tap any point of the map to see what it is and its address; search streets, house numbers and places with no internet
• Maps for 241 countries and territories, plus a world map built in from the first second

ALL THE KNOWLEDGE, NO NETWORK
• Wikipedia in English or Spanish, whole or its best articles, to fit your storage
• 80 archives: medicine and first aid, survival, water and food, farming, repairs, PDF guides… plus thousands more from the Kiwix catalog
• Full-text search, bookmarks, and reading in dark or on a paper page
• 14 courses to learn whatever you need

AN AI THAT DOESN'T NEED THE INTERNET
• Ask "how do I make water safe to drink?" in the middle of nowhere: it answers from your library and shows its sources
• Ask it about the map: the nearest pharmacy, how to get somewhere or where you are
• Runs on your phone, with an open model you download or Apple Intelligence; urgent questions are answered from the guide even with no model
• Dictate your questions; your voice is processed on the device itself

YOURS AND NOBODY ELSE'S
No accounts, no ads, no purchases, no tracking. Free. Your plan, your contacts and your questions never leave your phone. Maps, guides, library and assistant depend on no server, so there's nothing to go down. Only instant official alerts, if you turn them on, use a small server of ours that doesn't know who you are: all it knows is the grid square of about 10 km you're in.

Open source (GPL-3.0), inspired by Project N.O.M.A.D. Data from OpenStreetMap, Wikipedia, Kiwix, Protomaps, official health registers and weather services; Nomad Pocket is not affiliated with them.

The AI can make mistakes and medical information is no substitute for a professional. In an emergency, always call the emergency services if you can.
```

## Google Play description

When the Android build with alerts goes to Google Play, carry the same facts into `play-listing.md`'s
description where it says them, without health (no medicine, first aid or medical details; the guide keeps its
other cards and Home's "Survival guides" opens it), and with the Android numbers: 79 archives, 12 courses, 103
guide cards.

## Google Play Data safety

- **Does your app collect or share any of the required user data types?** Yes.
- **Location › Approximate location**: collected, not shared; optional (only with official alerts on); purpose
  **App functionality**; not processed ephemerally (the server keeps the cell until alerts are off, the token dies
  or 90 days without a refresh).
- **App info and performance / Device or other IDs › Device or other IDs**: collected (the FCM registration
  token, so the server can deliver the alert), not shared; optional; App functionality.
- Encrypted in transit: yes (HTTPS). Deletion: turning alerts off deletes it; no account, so no deletion URL.
- Everything else as in `play-listing.md` (on-device only).
