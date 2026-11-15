# Google Play — 2.5.0 (versionCode 33), 2026-11-15

The first Android update after 1.1.0 (26) went live in production. What changed in Play Console with it and why.
The owner asked for "publish 2.5.0 with everything it needs" on 2026-11-15; these texts went in that day.

## Data safety (saved 2026-11-15)

Collects or shares data: yes. Encrypted in transit: yes. No accounts, no outside sign-in. Nothing shared.

| Data type | Collected | Optional | Ephemeral | Purpose | Why |
|---|---|---|---|---|---|
| Personal info › Phone number | yes | yes | no | App functionality | The family plan's contacts leave the phone in the shared PDF and in Android Auto Backup; Play's scan rejected "no data" for 26 (see `play-listing.md`) |
| Location › Approximate location | yes | yes (only with official alerts on) | no | App functionality | The 0.1° cell kept by the alerts server until alerts go off, the token dies or 90 days pass (`listing-next.md`, `site/privacy.html`) |
| Device or other IDs | yes | yes | no | App functionality | The FCM registration token, so the server can deliver alerts |

## Store listing (es-ES and en-US)

- Full descriptions below (es 3806 characters, en 3774): the facts of `listing-next.md` without health (no first aid,
  medicine, medical details or defibrillators; the guide is "Guías de supervivencia" with 100+ cards: Android shows 103),
  no CarPlay or Apple Intelligence, 79 archives and 12 courses, and the privacy paragraph saying the plan only leaves the
  phone in the shared PDF or the backup (Data safety now declares the phone number).
- Screenshots: the 2.0 set (`docs/store/marketing/<lang>/android/01…08`), es and en each with their own. Icon and feature
  graphic: the 2.0 ones (`docs/store/play/`); en-US inherits the icon, has its own feature graphic.
- AI-generated assets: "No etiquetar recursos" (real captures with captions, no generated images).

## Foreground service declaration

Location: turn-by-turn navigation the person starts ("Iniciar"), kept going with the screen off (`NavigationService`,
type `location`). Video recorded on the emulator with this build (Andorra, a simulated drive, screen locked and woken,
the "Navegación en curso" notification in the shade). Recording it found a bug: the trip's location watch shared the
preview's id and was removed right after "Iniciar" (fixed before the upload, commit "Android: trip watch no longer
shares the preview watch's id").

## Release notes

<es-ES>
Nomad Pocket 2.5, la gran actualización para Android:
• Nuevo diseño, más claro y rápido de leer
• Avisos oficiales al momento (opcional): AEMET, MeteoAlarm, NWS y terremotos fuertes cerca de ti
• Navegación giro a giro por voz, también con la pantalla bloqueada, y límite de velocidad
• Guías de supervivencia en la app desde el primer minuto
• Pregunta al asistente por el mapa: lo más cercano, cómo llegar o dónde estás
• Más puntos de emergencia gracias a registros oficiales, y mejor búsqueda en el mapa
</es-ES>
<en-US>
Nomad Pocket 2.5, the big update for Android:
• New design, clearer and quicker to read
• Instant official alerts (optional): AEMET, MeteoAlarm, NWS and strong earthquakes near you
• Spoken turn-by-turn navigation, also with the screen locked, and speed limits
• Survival guides in the app from the first minute
• Ask the assistant about the map: the nearest place, how to get there or where you are
• More emergency points from official registers, and better map search
</en-US>

## Full description, es-ES

```
¿Y si mañana se cae internet?

Un apagón, un ciberataque, una tormenta o un fallo informático masivo, y tu móvil se queda mudo: sin mapas, sin buscador, sin respuestas. Justo cuando más lo necesitas.

Nomad Pocket es tu kit de supervivencia offline: sigue funcionando cuando todo lo demás falla. Prepáralo hoy en un minuto, mientras tienes conexión. Mañana, sin red, tu móvil seguirá sabiendo dónde estás, cómo llegar, dónde están el hospital o el agua potable más cercanos y cómo potabilizarla. Solo necesita batería.

LISTO EN UN MINUTO
• Elige tu país y descarga tu kit: una propuesta a la medida de tu país y del espacio de tu teléfono
• Déjalo descargando con wifi; después, todo funciona sin conexión
• Inicio te dice lo preparado que estás y lo que te falta, para completarlo mientras aún hay red
• Te avisa de versiones nuevas de tus mapas, archivos y cursos, y los actualiza sin perder la copia antigua hasta que la nueva está lista

CUANDO LLEGA LA EMERGENCIA
• Guías de supervivencia: más de 100 fichas paso a paso basadas en fuentes oficiales (apagones, incendios, inundaciones, terremotos, agua y comida…), en la app desde el primer minuto
• Hospitales, farmacias, policía, bomberos, agua potable y gasolineras cerca de ti, con un toque para que te guíe; en más de 25 países, completados con registros oficiales
• Llama al número de emergencias del país en el que estás y comparte tu posición exacta (coordenadas y UTM) por mensaje
• Avisos oficiales (opcional): te llegan al momento los avisos naranja y rojo de AEMET, MeteoAlarm o el NWS y los terremotos fuertes cerca de ti. No sustituyen a ES-Alert ni al 112
• Plan familiar: puntos de encuentro, contactos y números importantes, también en PDF para imprimir
• Mochila de emergencia a la medida de tu hogar con avisos de caducidad

MAPAS QUE NO SE APAGAN
• Tu país entero en el móvil: cada calle, camino y edificio
• Rutas en coche, a pie y en bici sin conexión, también entre países, con indicaciones por voz que siguen guiándote con la pantalla bloqueada
• En coche, el límite de velocidad de la vía y un aviso si lo superas
• Toca cualquier punto del mapa para saber qué es; busca calles, portales y lugares sin internet
• Mapas de 241 países y territorios, y un mapa del mundo incluido

TODO EL CONOCIMIENTO, SIN RED
• Wikipedia en español o inglés, entera o sus mejores artículos, según tu espacio
• 79 archivos: supervivencia, agua y alimentos, agricultura, reparaciones, informática, guías en PDF… y miles más del catálogo de Kiwix
• Búsqueda de texto completo, marcadores y modo papel
• 12 cursos para aprender lo que haga falta

UNA IA QUE NO NECESITA INTERNET
• Pregúntale «¿cómo potabilizo agua?» en mitad de la nada: responde con tu biblioteca y te enseña las fuentes
• Pregúntale por el mapa: la gasolinera más cercana, cómo llegar o dónde estás
• Funciona en tu teléfono, con un modelo abierto que descargas una vez
• Dicta tus preguntas; tu voz se procesa en el propio dispositivo
• ¿Una respuesta inapropiada? Repórtala desde la propia respuesta

TUYA Y DE NADIE MÁS
Sin cuentas, sin anuncios, sin compras y sin rastreo. Gratis. Tu plan y tus preguntas se quedan en tu móvil: solo salen si compartes el PDF del plan o en tu copia de seguridad. Mapas, guías, biblioteca y asistente no dependen de ningún servidor, así que no hay nada que pueda caerse. Solo los avisos oficiales al momento, si los activas, usan un pequeño servidor nuestro que no sabe quién eres: únicamente conoce la cuadrícula de unos 10 km en la que estás.

Código abierto (GPL-3.0), inspirado en Project N.O.M.A.D. Datos de OpenStreetMap, Wikipedia, Kiwix, Protomaps, registros oficiales y servicios meteorológicos; Nomad Pocket no está afiliada a ellos.

La IA puede equivocarse. En una emergencia, llama siempre a los servicios de emergencia si puedes.
```

## Full description, en-US

```
What if the internet goes down tomorrow?

A blackout, a cyberattack, a storm or a massive IT failure, and your phone goes silent: no maps, no search, no answers. Right when you need them most.

Nomad Pocket is your offline survival kit: it keeps working when everything else fails. Set it up today in a minute, while you're online. Tomorrow, with no network, your phone still knows where you are, how to get where you need to go, where the nearest hospital or drinking water is, and how to make it safe. All it needs is battery.

READY IN A MINUTE
• Pick your country and download your kit: one proposal sized for your country and your phone's storage
• Leave it on Wi-Fi; from then on, everything works offline
• Home tells you how prepared you are and what's missing, so you can finish while the network is still up
• It tells you when your maps, archives and courses have newer versions, and updates them keeping the old copy until the new one is ready

WHEN THE EMERGENCY COMES
• Survival guides: 100+ step-by-step cards based on official sources (blackouts, fires, floods, earthquakes, water and food…), in the app from the first minute
• Hospitals, pharmacies, police, fire stations, drinking water and fuel near you, one tap to be guided there; in 25+ countries, completed with official registers
• Call the emergency number of the country you're in and share your exact position (coordinates and UTM) by message
• Official alerts (optional): orange and red warnings from AEMET, MeteoAlarm or the NWS and strong earthquakes near you, as soon as they're issued. They don't replace your authorities' alerts or 112/911
• Family plan: meeting points, contacts and important numbers, also as a printable PDF
• Emergency bag sized to your household with expiry reminders

MAPS THAT DON'T SWITCH OFF
• Your whole country on your phone: every street, path and building
• Offline routes by car, on foot and by bike, across borders too, with spoken directions that keep guiding you with the screen locked
• By car, the road's speed limit and a warning when you go over it
• Tap any point of the map to see what it is and its address; search streets, house numbers and places with no internet
• Maps for 241 countries and territories, plus a world map built in

ALL THE KNOWLEDGE, NO NETWORK
• Wikipedia in English or Spanish, whole or its best articles, to fit your storage
• 79 archives: survival, water and food, farming, repairs, computing, PDF guides… plus thousands more from the Kiwix catalog
• Full-text search, bookmarks, and reading in dark or on a paper page
• 12 courses to learn whatever you need

AN AI THAT DOESN'T NEED THE INTERNET
• Ask "how do I make water safe to drink?" in the middle of nowhere: it answers from your library and shows its sources
• Ask it about the map: the nearest fuel station, how to get somewhere or where you are
• Runs on your phone, with an open model you download once
• Dictate your questions; your voice is processed on the device itself
• An inappropriate answer? Report it from the answer itself

YOURS AND NOBODY ELSE'S
No accounts, no ads, no purchases, no tracking. Free. Your plan and your questions stay on your phone: they only leave it if you share the plan's PDF, or in your backup. Maps, guides, library and assistant depend on no server, so there's nothing to go down. Only instant official alerts, if you turn them on, use a small server of ours that doesn't know who you are: all it knows is the grid square of about 10 km you're in.

Open source (GPL-3.0), inspired by Project N.O.M.A.D. Data from OpenStreetMap, Wikipedia, Kiwix, Protomaps, official registers and weather services; Nomad Pocket is not affiliated with them.

The AI can make mistakes. In an emergency, always call the emergency services if you can.
```
