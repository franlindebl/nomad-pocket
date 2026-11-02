# App Store listing — 2.0.0 (2026-11-03)

Texts for App Store Connect, version 2.0.0 (build 39). Starts from `listing-1.1.0.md` (approved 2026-10-27);
the owner agreed the changes on 2026-11-03 and asked for them to be sent without a further read (decisions in
`docs/PROGRESS.md`). Unchanged from 1.1.0: name, subtitle, promotional text and keywords (see that file).
Release: automatic once approved.

What changed against 1.1.0 and why:
- The emergency guide (202 bilingual cards from official sources, in the app from the first launch) replaces
  "first aid one tap from Home".
- Maps: voice prompts, guidance with the screen locked, speed limit warning, tap any point of the map.
- The assistant answers vital questions from the guide even with no model.
- Content updates (newer maps and archives, old copy kept until the new one is in).
- "Modo oscuro" → "modo papel": the whole app is dark now; the reader adds a paper page.
- "Más de 90 colecciones" → "más de 100 archivos" (the catalog has 101).

Screenshots (`docs/store/marketing/<lang>/<iphone|ipad>/`, new yellow frame): home, emergency, voice navigation,
emergency guide, assistant, family plan, library, kit (iPhone only). Captions in `scripts/store-screenshots.py`.

## Description

**es:**

```
¿Y si mañana se cae internet?

Un apagón, un ciberataque, una tormenta o un fallo informático masivo, y tu móvil se queda mudo: sin mapas, sin buscador, sin respuestas. Justo cuando más lo necesitas.

Nomad Pocket es tu kit de supervivencia offline: sigue funcionando cuando todo lo demás falla. Prepáralo hoy en un minuto, mientras tienes conexión. Mañana, sin red, tu móvil seguirá sabiendo dónde estás, cómo llegar a donde necesitas, dónde están el hospital o el agua potable más cercanos y qué hacer ante una herida. Solo necesita batería.

LISTO EN UN MINUTO
• Elige tu país y descarga tu kit: una propuesta a la medida de tu país y del espacio de tu teléfono
• Déjalo descargando con wifi; desde ese momento, todo funciona sin conexión
• Inicio te dice lo preparado que estás y lo que te falta, para completarlo mientras aún hay red
• Te avisa cuando hay versiones nuevas de tus mapas y archivos, y las actualiza sin quitarte la copia antigua hasta que la nueva está lista

CUANDO LLEGA LA EMERGENCIA
• Guía de emergencia: más de 200 fichas paso a paso de fuentes oficiales (reanimación, hemorragias, quemaduras, atragantamiento, incendios, inundaciones…), en la app desde el primer minuto, sin descargar nada
• Hospitales, farmacias, desfibriladores, policía, bomberos, agua potable y refugios a tu alrededor, por distancia y dirección, con un toque para que te guíe
• Llama al número de emergencias y comparte tu posición exacta (coordenadas y UTM) por mensaje
• Plan familiar: puntos de encuentro, contactos y datos médicos de cada uno, también en PDF para imprimir
• Mochila de emergencia a la medida de tu hogar (agua, comida, días) con avisos de caducidad

MAPAS QUE NO SE APAGAN
• Tu país entero en el móvil: cada calle, camino y edificio
• Rutas en coche, a pie y en bici sin conexión, con indicaciones por voz que siguen guiándote con la pantalla bloqueada
• Aviso de velocidad con el límite de cada vía
• Toca cualquier punto del mapa para saber qué es y su dirección; busca cualquier calle, número de portal o lugar sin internet
• Brújula, coordenadas y UTM, lugares guardados
• Casi todos los países del mundo, y un mapa del mundo incluido desde el primer segundo

TODO EL CONOCIMIENTO, SIN RED
• Wikipedia entera o los artículos esenciales, según tu espacio
• Más de 100 archivos: medicina y primeros auxilios, supervivencia, agua y alimentos, agricultura, reparaciones… y miles más del catálogo de Kiwix
• Búsqueda de texto completo, marcadores, y lectura en oscuro o en modo papel
• 14 cursos para aprender lo que haga falta

UNA IA QUE NO NECESITA INTERNET
• Pregúntale «¿cómo potabilizo agua?» en mitad de la nada: responde con tu biblioteca y te enseña las fuentes
• Funciona en tu teléfono, con Apple Intelligence o con un modelo abierto que descargas; las preguntas urgentes las responde con la guía de emergencia incluso sin modelo
• Dicta tus preguntas; tu voz se procesa en el propio dispositivo

TUYA Y DE NADIE MÁS
Sin cuentas, sin anuncios, sin compras y sin rastreo. Gratis. No recogemos ningún dato: tu plan, tus contactos, tu ubicación y tus preguntas no salen de tu móvil. Nomad Pocket no depende de ningún servidor propio, así que no hay nada que pueda caerse.

Código abierto (GPL-3.0), inspirado en Project N.O.M.A.D. Datos de OpenStreetMap, Wikipedia, Kiwix y Protomaps; Nomad Pocket no está afiliada a estos proyectos.

La IA puede equivocarse y la información médica no sustituye a un profesional. En una emergencia, llama siempre a los servicios de emergencia si puedes.
```

**en:**

```
What if the internet goes down tomorrow?

A blackout, a cyberattack, a storm or a massive IT failure, and your phone goes silent: no maps, no search, no answers. Right when you need them most.

Nomad Pocket is your offline survival kit: it keeps working when everything else fails. Set it up today in a minute, while you're online. Tomorrow, with no network, your phone still knows where you are, how to get where you need to go, where the nearest hospital or drinking water is, and what to do about a wound. All it needs is battery.

READY IN A MINUTE
• Pick your country and download your kit: one proposal sized for your country and your phone's storage
• Leave it on Wi-Fi; from then on, everything works offline
• Home tells you how prepared you are and what's missing, so you can finish while the network is still up
• It tells you when your maps and archives have newer versions, and updates them keeping the old copy until the new one is ready

WHEN THE EMERGENCY COMES
• Emergency guide: 200+ step-by-step cards from official sources (CPR, bleeding, burns, choking, fires, floods…), in the app from the first minute, nothing to download
• Hospitals, pharmacies, defibrillators, police, fire stations, drinking water and shelters around you, by distance and direction, one tap to be guided there
• Call the emergency number and share your exact position (coordinates and UTM) by message
• Family plan: meeting points, contacts and everyone's medical details, also as a printable PDF
• Emergency bag sized to your household (water, food, days) with expiry reminders

MAPS THAT DON'T SWITCH OFF
• Your whole country on your phone: every street, path and building
• Offline routes by car, on foot and by bike, with spoken directions that keep guiding you with the screen locked
• Speed warning with each road's limit
• Tap any point of the map to see what it is and its address; search any street, house number or place with no internet
• Compass, coordinates and UTM, saved places
• Almost every country in the world, plus a world map built in from the first second

ALL THE KNOWLEDGE, NO NETWORK
• The whole of Wikipedia or the essential articles, to fit your storage
• 100+ archives: medicine and first aid, survival, water and food, farming, repairs… plus thousands more from the Kiwix catalog
• Full-text search, bookmarks, and reading in dark or on a paper page
• 14 courses to learn whatever you need

AN AI THAT DOESN'T NEED THE INTERNET
• Ask "how do I make water safe to drink?" in the middle of nowhere: it answers from your library and shows its sources
• Runs on your phone, with Apple Intelligence or an open model you download; urgent questions are answered from the emergency guide even with no model
• Dictate your questions; your voice is processed on the device itself

YOURS AND NOBODY ELSE'S
No accounts, no ads, no purchases, no tracking. Free. We collect no data: your plan, your contacts, your location and your questions never leave your phone. Nomad Pocket doesn't depend on any server of its own, so there's nothing to go down.

Open source (GPL-3.0), inspired by Project N.O.M.A.D. Data from OpenStreetMap, Wikipedia, Kiwix and Protomaps; Nomad Pocket is not affiliated with these projects.

The AI can make mistakes and medical information is no substitute for a professional. In an emergency, always call the emergency services if you can.
```

## What's new in 2.0.0

**es:**

```
Nomad Pocket 2.0 estrena diseño y llega con más ayuda para cuando no hay red.

• Nuevo diseño, oscuro y de alto contraste, pensado para leerse rápido en una emergencia
• Guía de emergencia: más de 200 fichas paso a paso de fuentes oficiales, disponibles desde el primer minuto
• Navegación con indicaciones por voz, que sigue guiándote con la pantalla bloqueada, y aviso de velocidad
• Toca cualquier punto del mapa para saber qué es y su dirección
• El asistente responde las preguntas urgentes con la guía, incluso sin modelo descargado
• Avisos y actualización de tus mapas y archivos cuando hay versiones nuevas
• Biblioteca renovada: búsqueda más clara y colecciones con todo su contenido a la vista
• Modo papel para leer
```

**en:**

```
Nomad Pocket 2.0 has a new look and more help for when there's no network.

• A new design, dark and high-contrast, made to be read fast in an emergency
• Emergency guide: 200+ step-by-step cards from official sources, available from the first minute
• Navigation with spoken directions that keeps guiding you with the screen locked, plus a speed warning
• Tap any point of the map to see what it is and its address
• The assistant answers urgent questions from the guide, even with no model downloaded
• Your maps and archives tell you when there's a newer version, and update
• A renewed Library: clearer search and collections with all their content in view
• A paper page for reading
```

## App Review notes

```
Nomad Pocket is completely free: no in-app purchases, no subscriptions, no ads, no accounts and no paid content. It has no server of its own and makes no money; it is an open source project (GPL-3.0, https://github.com/franlindebl/nomad-pocket). All content is free, openly licensed public data downloaded from its original public servers: Wikipedia and other archives from Kiwix and its mirrors, OpenStreetMap maps and routing packages built from OpenStreetMap and published on the project's GitHub Releases, and optional open AI models from Hugging Face.

How to review: no sign-in is needed. On first launch, pick a country (preselected from the device region) and the app proposes a kit sized for the free space; downloading it takes a few minutes on Wi-Fi (a small country such as Andorra downloads in seconds). After that, everything works in airplane mode: the map with routes and search, Emergency (nearby hospitals, pharmacies, water…), the emergency guide, the library reader, the AI assistant and Preparedness.

Background modes (new in this version): location is used in the background only while the user is following turn-by-turn directions they started ("Start" on a route), so guidance continues with the screen locked; it is never stored or sent. Audio is used for the spoken turn-by-turn prompts during that guidance, which lower other audio while they play. To try it: download Andorra, open Maps, tap a place, choose "Take me there" and then "Start".

Permissions: location (while in use, and in the background only during navigation as above) shows the user on the offline map and sorts emergency points by distance. Microphone and speech recognition are used only when the user taps the dictate button in the assistant; recognition runs on the device (requiresOnDeviceRecognition) and nothing is stored or sent. Notifications are local reminders for expiry dates in the emergency bag checklist. The app never accesses the photo library (the purpose string is there because a bundled library references the Photos framework).

The emergency guide is bundled with the app: 202 cards, each from a cited official source (Spanish and US government health, civil protection and emergency agencies) or labelled as our own wording. The AI assistant runs on the device (Apple Intelligence when available, otherwise a downloadable open model through llama.cpp); nothing is sent to any server. Medical content shows a "not medical advice" notice.
```
