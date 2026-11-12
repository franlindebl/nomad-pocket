# App Store listing 2.5.0 (draft, to be approved by the owner)

2.5.0 (51) is 2.4.3 (50) plus official alerts as real push notifications from our own alerts server
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
