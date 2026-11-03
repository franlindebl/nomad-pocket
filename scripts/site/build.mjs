#!/usr/bin/env node
// Builds the landing page in both languages from one template: site/index.html (es, the root) and
// site/en/index.html, plus site/sitemap.xml. The copy lives here, side by side, so the two pages never
// drift apart. Phone screens come from site/img/screens/<lang>/<key>.webp (scripts/site/images.py);
// a missing screen is replaced by an icon plate, so rerun this after new captures.
// Run from the repo root: node scripts/site/build.mjs [--check]   (--check fails if the output is stale)

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SITE = join(ROOT, 'site');
const ORIGIN = 'https://nomad-pocket.app';
const APP_STORE = 'https://apps.apple.com/app/nomad-pocket-kit-offline/id6826502392';
const APP_ID = '6826502392';
const GITHUB = 'https://github.com/franlindebl/nomad-pocket';
const EMAIL = 'fran.linde.blazquez@gmail.com';
// Flip to the store URL once the Play listing is public: the "coming soon" chip becomes Google's badge.
const GOOGLE_PLAY = null; // 'https://play.google.com/store/apps/details?id=com.fjlinde.nomadpocket'

// Lucide icons (lucide.dev, ISC licence), the same set the app uses.
const ICONS = {
  zapOff:
    '<path d="M10.513 4.856 13.12 2.17a.5.5 0 0 1 .86.46l-1.377 4.317"/><path d="M15.656 10H20a1 1 0 0 1 .78 1.63l-1.72 1.773"/><path d="M16.273 16.273 10.88 21.83a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14H4a1 1 0 0 1-.78-1.63l4.507-4.643"/><path d="m2 2 20 20"/>',
  wifiOff:
    '<path d="M12 20h.01"/><path d="M8.5 16.429a5 5 0 0 1 7 0"/><path d="M5 12.859a10 10 0 0 1 5.17-2.69"/><path d="M19 12.859a10 10 0 0 0-2.007-1.523"/><path d="M2 8.82a15 15 0 0 1 4.177-2.643"/><path d="M22 8.82a15 15 0 0 0-11.288-3.764"/><path d="m2 2 20 20"/>',
  shieldAlert:
    '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
  shieldCheck:
    '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
  storm: '<path d="M6 16.326A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 .5 8.973"/><path d="m13 12-3 5h4l-3 5"/>',
  mountain: '<path d="m8 3 4 8 5-5 5 15H2L8 3z"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
  map: '<path d="M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z"/><path d="M15 5.764v15"/><path d="M9 3.236v15"/>',
  siren:
    '<path d="M7 18v-6a5 5 0 1 1 10 0v6"/><path d="M5 21a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-1a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2z"/><path d="M21 12h1"/><path d="M18.5 4.5 18 5"/><path d="M2 12h1"/><path d="M12 2v1"/><path d="m4.929 4.929.707.707"/><path d="M12 12v6"/>',
  heartPulse:
    '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/><path d="M3.22 12H9.5l.5-1 2 4.5 2-7 1.5 3.5h5.27"/>',
  message: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M13 8H7"/><path d="M17 12H7"/>',
  book: '<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>',
  backpack:
    '<path d="M4 10a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><path d="M8 10h8"/><path d="M8 18h8"/><path d="M8 22v-6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  power: '<path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.77.04"/>',
  smartphone: '<rect width="14" height="20" x="5" y="2" rx="2" ry="2"/><path d="M12 18h.01"/>',
  github:
    '<path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"/><path d="M9 18c-4.51 2-5-2-7-2"/>',
  mail: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
  navigation: '<polygon points="3 11 22 2 13 21 11 13 3 11"/>',
};
const icon = (name, extra = '') =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${extra}>${ICONS[name]}</svg>`;

// Category hues of the app (src/theme/tokens.ts › hues).
const HUE = { maps: '#4FD1A5', medicine: '#FF6B6B', survival: '#FFD60A', ai: '#F2F2EF', reference: '#5DB4FF', education: '#8AA4FF' };

const COPY = {
  es: {
    path: '/',
    title: 'Nomad Pocket: la app de emergencia que funciona en un apagón y sin internet',
    description:
      'Navegador GPS, guías de supervivencia, hospitales cercanos, Wikipedia, cursos e IA en tu móvil, aunque haya un apagón o se caiga internet. Gratis y de código abierto.',
    ogLocale: 'es_ES',
    ogAlt: 'Nomad Pocket: navegador GPS y guías de supervivencia en tu móvil, aunque haya un apagón.',
    skip: 'Saltar al contenido',
    nav: [['#escenarios', 'Por qué'], ['#funciones', 'Funciones'], ['#como-funciona', 'Cómo funciona'], ['#privacidad', 'Privacidad'], ['#preguntas', 'Preguntas']],
    ids: { scenarios: 'escenarios', features: 'funciones', how: 'como-funciona', privacy: 'privacidad', faq: 'preguntas', download: 'descargar', support: 'soporte' },
    langSwitch: { href: 'en/', label: 'EN', title: 'Read in English', hreflang: 'en' },
    langHint: { test: '!es', text: 'This page is also in English.', link: 'Read in English →' },
    download: 'Descargar',
    appStoreAlt: 'Descargar en el App Store',
    soon: { small: 'Próximamente', strong: 'Android · Google Play' },
    googlePlayAlt: 'Disponible en Google Play',
    hero: {
      status: ['Sin conexión', 'todo funciona'],
      h1: 'Navegador GPS y guías de supervivencia en tu móvil, <em>aunque haya un apagón.</em>',
      lead: '<strong>Lo preparas hoy con conexión y mañana funciona sin internet, sin cobertura y sin luz.</strong> Con hospitales cercanos, Wikipedia, cursos y una IA que vive en tu teléfono. Gratis y de código abierto.',
      facts: ['100 % gratis', 'Código abierto', 'Sin cuentas', 'Sin anuncios'],
      tag1: 'Sin red · todo funciona',
      tag2: 'Ruta sin internet',
      alts: { home: 'Inicio de Nomad Pocket: llamar a emergencias y estado de preparación', navigation: 'Navegación guiada por voz sin conexión' },
    },
    ticker: ['Apagón', 'Caída de internet', 'Ciberataque', 'Tormenta', 'Inundación', 'Sin cobertura', 'Sin roaming', 'Fallo informático masivo'],
    story: {
      over: ['01', 'Por qué'],
      stamp: '28·04·2025',
      stampSmall: '12:33 · Península Ibérica',
      h2: '¿Y si mañana <em>se cae internet?</em>',
      paras: [
        'Aquel lunes, España y Portugal se quedaron sin luz durante horas. Sin electricidad, las antenas de telefonía aguantaron lo que les duraron las baterías, y <strong>muchos móviles se quedaron sin datos ni cobertura</strong>: sin mapas, sin buscador, sin forma de consultar qué hacer.',
        'Un apagón, un ciberataque, una tormenta o un fallo informático masivo bastan para dejar el móvil mudo justo cuando más falta hace. <strong>Nomad Pocket guarda lo esencial en el propio teléfono</strong>, para que siga funcionando cuando todo lo demás falla.',
      ],
    },
    scenarios: [
      ['zapOff', 'Apagón', 'Sin luz, las antenas aguantan poco. Tus mapas, tus guías y tu plan siguen en el móvil.'],
      ['wifiOff', 'Caída de internet', 'Falla tu operador o un gran servicio en la nube. Nada de lo que llevas depende de ellos.'],
      ['shieldAlert', 'Ciberataque', 'Si atacan las redes o los servicios que usas, lo tuyo sigue en tu teléfono, intacto.'],
      ['storm', 'Tormenta o inundación', 'Cuando el temporal tumba la red, sabes dónde está el refugio, el agua o el hospital.'],
      ['mountain', 'Sin cobertura', 'Montaña, mar, una carretera perdida: rutas y respuestas sin una sola barra de señal.'],
      ['globe', 'De viaje', 'En otro país, sin roaming ni tarjeta local, con su mapa y sus números de emergencia.'],
    ],
    sim: {
      label: 'Red',
      on: 'Conectado',
      off: 'Sin conexión',
      cut: 'Cortar la conexión',
      restore: 'Volver a conectar',
      normal: 'Un móvil cualquiera',
      ours: 'Con Nomad Pocket',
      rows: ['Mapas y rutas', 'El hospital más cercano', 'Qué hacer ante una emergencia', 'Wikipedia', 'Asistente de IA'],
      works: 'Funciona',
      down: 'Sin conexión',
      foot: 'Tus mapas, guías y respuestas están en el móvil, no en un servidor: si la red cae, no dependen de ella.',
    },
    featuresHead: {
      over: ['02', 'Qué llevas en el bolsillo'],
      h2: 'Un kit de supervivencia <em>que cabe en tu móvil</em>',
      intro: 'Todo lo que buscarías en internet en una emergencia, descargado de antemano y listo para usar sin red.',
      numbers: [['200+', 'fichas de emergencia'], ['100+', 'archivos de conocimiento'], ['14', 'cursos'], ['0 €', 'sin compras ni anuncios']],
    },
    features: [
      {
        screen: 'navigation', icon: 'map', hue: HUE.maps, over: 'Mapas y navegación',
        h3: 'Mapas que no se apagan',
        p: 'Tu país entero en el móvil: cada calle, camino y edificio. Calcula rutas en coche, a pie o en bici sin red, con indicaciones por voz que siguen guiándote con la pantalla bloqueada.',
        checks: ['Busca cualquier calle o número de portal sin internet', 'Aviso del límite de velocidad de cada vía', 'Brújula, coordenadas y UTM, lugares guardados', 'Casi todos los países del mundo, y un mapa mundial incluido'],
        alt: 'Navegación por voz sin conexión en Madrid',
      },
      {
        screen: 'emergency', icon: 'siren', hue: HUE.medicine, over: 'Emergencias',
        h3: 'Lo que necesitas, a tu alrededor',
        p: 'Hospitales, farmacias, desfibriladores, policía, bomberos, agua potable y refugios, ordenados por distancia y dirección. Un toque y te lleva hasta allí.',
        checks: ['Llama al número de emergencias de tu país', 'Comparte tu posición exacta por mensaje (coordenadas y UTM)', 'El GPS no necesita datos: sabes dónde estás aunque no haya cobertura'],
        alt: 'Hospitales y servicios de emergencia cercanos, sin conexión',
      },
      {
        screen: 'firstaid', icon: 'heartPulse', hue: HUE.survival, over: 'Guía de emergencia',
        h3: 'Qué hacer, paso a paso',
        p: 'Más de 200 fichas basadas en fuentes oficiales: reanimación, hemorragias, quemaduras, atragantamiento, incendios, inundaciones… En la app desde el primer minuto, sin descargar nada.',
        checks: ['Textos breves, pensados para leerse con prisa', 'Cada ficha cita su fuente', 'Búsqueda instantánea dentro de la guía'],
        note: 'Primeros auxilios e información médica: en iPhone y iPad.',
        alt: 'Guía de emergencias con fichas de primeros auxilios',
      },
      {
        screen: 'assistant', icon: 'message', hue: HUE.ai, over: 'Asistente sin conexión',
        h3: 'Una IA que no necesita internet',
        p: 'Pregúntale «¿cómo potabilizo agua?» en mitad de la nada: responde con tu biblioteca y te enseña las fuentes. Funciona en tu teléfono, con Apple Intelligence o con un modelo abierto que descargas.',
        checks: ['Las preguntas urgentes las responde con la guía, incluso sin modelo', 'Dicta tus preguntas: la voz se procesa en el dispositivo', 'Ni tus preguntas ni sus respuestas salen del móvil'],
        alt: 'Asistente de IA respondiendo sin conexión con fuentes',
      },
      {
        screen: 'library', icon: 'book', hue: HUE.reference, over: 'Biblioteca',
        h3: 'Todo el conocimiento, sin red',
        p: 'Wikipedia entera o sus artículos esenciales, según tu espacio. Más de 100 archivos de supervivencia, agua y alimentos, agricultura, reparaciones y más, y miles del catálogo de Kiwix.',
        checks: ['Búsqueda de texto completo en todos tus libros', '14 cursos para aprender lo que haga falta', 'Lectura en oscuro o en modo papel'],
        alt: 'Biblioteca offline con Wikipedia y guías',
      },
      {
        screen: 'plan', icon: 'backpack', hue: HUE.education, over: 'Plan y mochila',
        h3: 'Tu familia sabe qué hacer',
        p: 'Puntos de encuentro, contactos y datos de cada uno, también en PDF para imprimir. Y una mochila de emergencia a la medida de tu hogar, con avisos de caducidad.',
        checks: ['Agua, comida y medicación calculadas para tu casa y los días que elijas', 'Recordatorios locales antes de que algo caduque', 'Tu plan no sale del móvil salvo que tú lo compartas'],
        alt: 'Plan familiar con puntos de encuentro y contactos',
      },
    ],
    how: {
      over: ['03', 'Cómo funciona'],
      h2: 'Listo <em>en un minuto</em>',
      intro: 'Prepáralo hoy, mientras tienes conexión. Mañana no hará falta.',
      steps: [
        ['Elige tu país', 'La app te propone un kit a la medida de tu país y del espacio de tu teléfono: mapa y rutas, guías, Wikipedia y asistente.'],
        ['Descárgalo con wifi', 'Déjalo descargando. Inicio te dice lo preparado que estás y lo que falta, para completarlo mientras aún hay red.'],
        ['Úsalo sin conexión', 'En modo avión, en un apagón o en mitad del monte. Y cuando haya versiones nuevas de tus mapas, te avisa.'],
      ],
    },
    privacy: {
      over: ['04', 'Tuya y de nadie más'],
      h2: 'Nada que rastrear. <em>Nada que pueda caerse.</em>',
      ownH: 'Privada por diseño',
      ownP: 'No recogemos ningún dato: tu plan, tus contactos, tu ubicación y tus preguntas no salen de tu móvil. Y como Nomad Pocket no depende de ningún servidor propio, no hay nada que pueda caerse.',
      zeros: [['0', 'cuentas'], ['0', 'anuncios'], ['0', 'rastreadores'], ['0', 'servidores propios']],
      policy: 'Leer la política de privacidad',
      ossH: 'Código abierto, de verdad',
      ossP: 'Nomad Pocket es software libre (GPL‑3.0) inspirado en Project N.O.M.A.D. Puedes leer cada línea, proponer cambios o compilarla tú. Se apoya en datos abiertos:',
      credits: ['OpenStreetMap', 'Wikipedia', 'Kiwix', 'Protomaps', 'Valhalla'],
      github: 'Ver el código en GitHub',
      disclaimer: 'Nomad Pocket es un proyecto independiente: no está afiliada a Crosstalk Solutions (Project N.O.M.A.D.) ni a estos proyectos, ni cuenta con su respaldo.',
    },
    faqHead: { over: ['05', 'Preguntas'], h2: 'Preguntas <em>frecuentes</em>' },
    faq: [
      ['¿De verdad funciona sin internet?', 'Sí. Solo necesitas conexión para descargar el contenido (mejor con wifi) y para buscar actualizaciones. Después, mapas, rutas, búsqueda de calles, puntos de emergencia, guía, biblioteca y asistente funcionan en modo avión.'],
      ['¿El GPS funciona sin datos?', 'Sí. El GPS recibe la señal de los satélites, no de internet, así que el mapa te sitúa aunque no haya cobertura. La primera posición puede tardar algo más que con datos.'],
      ['¿Cuánto espacio ocupa?', 'Tú eliges. El asistente de bienvenida propone un kit para tu país y tu espacio libre (mapa y navegación, guías esenciales, Wikipedia y asistente) y puedes desactivar cada pieza. Un país ocupa desde unas decenas de MB hasta varios GB.'],
      ['¿Funciona en mi país?', 'Hay mapas, rutas y puntos de emergencia de casi todos los países del mundo, y un mapa mundial viene incluido desde el primer segundo. La app está en español e inglés, y la biblioteca tiene contenido en muchos idiomas.'],
      ['¿Es gratis? ¿Dónde está el truco?', 'No hay truco: es gratis, sin anuncios, sin compras y sin suscripciones. Es un proyecto de código abierto sin servidor propio, así que no hay nada que cobrar ni datos que vender.'],
      ['¿Qué dispositivos son compatibles?', 'iPhone y iPad con iOS 16.4 o posterior. Android 8.0 o posterior, muy pronto en Google Play. El asistente usa Apple Intelligence donde está disponible; si no, descargas un modelo desde la app (desde unos 500 MB; los más grandes necesitan más memoria).'],
      ['¿Y en Android?', 'Está en revisión en Google Play y llegará pronto, con mapas, rutas, emergencias, biblioteca, plan y asistente. Los primeros auxilios y la información médica solo están en iPhone y iPad.'],
      ['¿Recogéis mis datos?', 'No. No hay cuentas, ni analítica, ni publicidad, ni rastreo. Lo que haces en la app se queda en tu dispositivo. Los detalles, en la <a href="{privacy}">política de privacidad</a>.'],
      ['¿Sustituye a los servicios de emergencia?', 'No. Te ayuda cuando no hay red, pero la IA puede equivocarse y la información médica no sustituye a un profesional. Si puedes, llama siempre al número de emergencias.'],
    ],
    cta: { h2: 'Prepárate hoy. <br>Mañana puede ser tarde.', p: 'Gratis, de código abierto y listo en un minuto. Funciona cuando todo lo demás falla.' },
    support: { h2: '¿Dudas, errores o ideas?', p: 'Escríbenos o abre una incidencia: respondemos a todo.', mail: 'Escribir un correo', issues: 'Incidencias en GitHub' },
    footer: {
      tagline: 'El conocimiento que nunca se desconecta',
      credits: `App gratuita y de código abierto creada por <a href="https://github.com/franlindebl">Fran Linde Blázquez</a> · Código fuente: <a href="${GITHUB}">github.com/franlindebl/nomad-pocket</a>`,
      links: [['{privacy}', 'Privacidad'], [GITHUB, 'GitHub'], ['#soporte', 'Soporte'], ['en/', 'English']],
      legal: [
        '© 2026 Fran Linde Blázquez y colaboradores · Software libre bajo licencia GPL‑3.0 o posterior.',
        'La IA puede equivocarse y la información médica no sustituye a un profesional. En una emergencia, llama siempre a los servicios de emergencia si puedes.',
        'Apple, el logotipo de Apple, iPhone y iPad son marcas comerciales de Apple Inc., registradas en EE. UU. y otros países. App Store es una marca de servicio de Apple Inc. Google Play es una marca de Google LLC.',
      ],
    },
    privacyHref: 'privacy.html',
  },

  en: {
    path: '/en/',
    title: 'Nomad Pocket: the emergency app that works in a blackout, offline',
    description:
      'GPS navigation, survival guides, nearby hospitals, Wikipedia, courses and AI on your phone, even in a blackout or an internet outage. Free and open source.',
    ogLocale: 'en_US',
    ogAlt: 'Nomad Pocket: GPS navigation and survival guides on your phone, even in a blackout.',
    skip: 'Skip to content',
    nav: [['#scenarios', 'Why'], ['#features', 'Features'], ['#how-it-works', 'How it works'], ['#privacy', 'Privacy'], ['#faq', 'FAQ']],
    ids: { scenarios: 'scenarios', features: 'features', how: 'how-it-works', privacy: 'privacy', faq: 'faq', download: 'download', support: 'support' },
    langSwitch: { href: '../', label: 'ES', title: 'Leer en español', hreflang: 'es' },
    langHint: { test: 'es', text: 'Esta página también está en español.', link: 'Leer en español →' },
    download: 'Download',
    appStoreAlt: 'Download on the App Store',
    soon: { small: 'Coming soon', strong: 'Android · Google Play' },
    googlePlayAlt: 'Get it on Google Play',
    hero: {
      status: ['Offline', 'everything works'],
      h1: 'GPS navigation and survival guides on your phone, <em>even in a blackout.</em>',
      lead: '<strong>Set it up today while you’re online; tomorrow it works with no internet, no signal and no power.</strong> With nearby hospitals, Wikipedia, courses and an AI that lives on your phone. Free and open source.',
      facts: ['100% free', 'Open source', 'No accounts', 'No ads'],
      tag1: 'No network · all works',
      tag2: 'Route with no internet',
      alts: { home: 'Nomad Pocket home: call emergency services and preparedness status', navigation: 'Offline voice-guided navigation' },
    },
    ticker: ['Blackout', 'Internet outage', 'Cyberattack', 'Storm', 'Flood', 'No signal', 'No roaming', 'Massive IT failure'],
    story: {
      over: ['01', 'Why'],
      stamp: '28·04·2025',
      stampSmall: '12:33 · Spain and Portugal',
      h2: 'What if the internet <em>goes down tomorrow?</em>',
      paras: [
        'That Monday, Spain and Portugal lost power for hours. Without electricity, cell towers lasted as long as their batteries did, and <strong>many phones were left with no data and no signal</strong>: no maps, no search, no way to look up what to do.',
        'A blackout, a cyberattack, a storm or a massive IT failure is enough to silence your phone right when you need it most. <strong>Nomad Pocket keeps the essentials on the phone itself</strong>, so it keeps working when everything else fails.',
      ],
    },
    scenarios: [
      ['zapOff', 'Blackout', 'Without power, cell towers don’t last long. Your maps, guides and plan stay on your phone.'],
      ['wifiOff', 'Internet outage', 'Your carrier or a big cloud service fails. Nothing you carry depends on them.'],
      ['shieldAlert', 'Cyberattack', 'If the networks or services you use are attacked, what’s yours stays on your phone, intact.'],
      ['storm', 'Storm or flood', 'When the weather takes the network down, you know where the shelter, water or hospital is.'],
      ['mountain', 'No signal', 'Mountains, sea, a remote road: routes and answers without a single bar of signal.'],
      ['globe', 'Travelling', 'Abroad with no roaming or local SIM, with the local map and emergency numbers.'],
    ],
    sim: {
      label: 'Network',
      on: 'Connected',
      off: 'Offline',
      cut: 'Cut the connection',
      restore: 'Reconnect',
      normal: 'Any other phone',
      ours: 'With Nomad Pocket',
      rows: ['Maps and routes', 'The nearest hospital', 'What to do in an emergency', 'Wikipedia', 'AI assistant'],
      works: 'Works',
      down: 'Offline',
      foot: 'Your maps, guides and answers live on your phone, not on a server: if the network goes down, they don’t depend on it.',
    },
    featuresHead: {
      over: ['02', 'What’s in your pocket'],
      h2: 'A survival kit <em>that fits on your phone</em>',
      intro: 'Everything you’d look up online in an emergency, downloaded in advance and ready to use with no network.',
      numbers: [['200+', 'emergency cards'], ['100+', 'knowledge archives'], ['14', 'courses'], ['$0', 'no purchases, no ads']],
    },
    features: [
      {
        screen: 'navigation', icon: 'map', hue: HUE.maps, over: 'Maps and navigation',
        h3: 'Maps that don’t switch off',
        p: 'Your whole country on your phone: every street, path and building. Get routes by car, on foot or by bike with no network, with spoken directions that keep guiding you with the screen locked.',
        checks: ['Search any street or house number with no internet', 'Speed warning with each road’s limit', 'Compass, coordinates and UTM, saved places', 'Almost every country in the world, plus a built-in world map'],
        alt: 'Offline voice navigation',
      },
      {
        screen: 'emergency', icon: 'siren', hue: HUE.medicine, over: 'Emergency',
        h3: 'What you need, all around you',
        p: 'Hospitals, pharmacies, defibrillators, police, fire stations, drinking water and shelters, sorted by distance and direction. One tap and it takes you there.',
        checks: ['Call your country’s emergency number', 'Share your exact position by message (coordinates and UTM)', 'GPS needs no data: you know where you are even with no signal'],
        alt: 'Nearby hospitals and emergency services, offline',
      },
      {
        screen: 'firstaid', icon: 'heartPulse', hue: HUE.survival, over: 'Emergency guide',
        h3: 'What to do, step by step',
        p: '200+ cards based on official sources: CPR, bleeding, burns, choking, fires, floods… In the app from the first minute, nothing to download.',
        checks: ['Short texts, written to be read in a hurry', 'Every card cites its source', 'Instant search inside the guide'],
        note: 'First aid and medical information: on iPhone and iPad.',
        alt: 'Emergency guide with first-aid cards',
      },
      {
        screen: 'assistant', icon: 'message', hue: HUE.ai, over: 'Offline assistant',
        h3: 'An AI that doesn’t need the internet',
        p: 'Ask “how do I make water safe to drink?” in the middle of nowhere: it answers from your library and shows its sources. It runs on your phone, with Apple Intelligence or an open model you download.',
        checks: ['Urgent questions are answered from the guide, even with no model', 'Dictate your questions: your voice is processed on the device', 'Neither your questions nor its answers leave your phone'],
        alt: 'AI assistant answering offline with sources',
      },
      {
        screen: 'library', icon: 'book', hue: HUE.reference, over: 'Library',
        h3: 'All the knowledge, no network',
        p: 'The whole of Wikipedia or its essential articles, to fit your storage. 100+ archives on survival, water and food, farming, repairs and more, plus thousands from the Kiwix catalog.',
        checks: ['Full-text search across all your books', '14 courses to learn whatever you need', 'Read in dark or on a paper page'],
        alt: 'Offline library with Wikipedia and guides',
      },
      {
        screen: 'plan', icon: 'backpack', hue: HUE.education, over: 'Plan and bag',
        h3: 'Your family knows what to do',
        p: 'Meeting points, contacts and everyone’s details, also as a printable PDF. And an emergency bag sized to your household, with expiry reminders.',
        checks: ['Water, food and medication worked out for your home and the days you choose', 'Local reminders before anything expires', 'Your plan never leaves your phone unless you share it'],
        alt: 'Family plan with meeting points and contacts',
      },
    ],
    how: {
      over: ['03', 'How it works'],
      h2: 'Ready <em>in a minute</em>',
      intro: 'Set it up today, while you’re online. Tomorrow you won’t need to be.',
      steps: [
        ['Pick your country', 'The app proposes a kit sized for your country and your phone’s storage: map and routes, guides, Wikipedia and the assistant.'],
        ['Download it on Wi‑Fi', 'Leave it downloading. Home tells you how prepared you are and what’s missing, so you can finish while the network is up.'],
        ['Use it offline', 'In airplane mode, in a blackout or in the middle of nowhere. And when your maps have newer versions, it lets you know.'],
      ],
    },
    privacy: {
      over: ['04', 'Yours and nobody else’s'],
      h2: 'Nothing to track. <em>Nothing to go down.</em>',
      ownH: 'Private by design',
      ownP: 'We collect no data: your plan, your contacts, your location and your questions never leave your phone. And since Nomad Pocket doesn’t depend on any server of its own, there’s nothing to go down.',
      zeros: [['0', 'accounts'], ['0', 'ads'], ['0', 'trackers'], ['0', 'servers of our own']],
      policy: 'Read the privacy policy',
      ossH: 'Truly open source',
      ossP: 'Nomad Pocket is free software (GPL‑3.0) inspired by Project N.O.M.A.D. You can read every line, suggest changes or build it yourself. It stands on open data:',
      credits: ['OpenStreetMap', 'Wikipedia', 'Kiwix', 'Protomaps', 'Valhalla'],
      github: 'See the code on GitHub',
      disclaimer: 'Nomad Pocket is an independent project, not affiliated with or endorsed by Crosstalk Solutions (Project N.O.M.A.D.) or these projects.',
    },
    faqHead: { over: ['05', 'FAQ'], h2: 'Frequently asked <em>questions</em>' },
    faq: [
      ['Does it really work without internet?', 'Yes. You only need a connection to download the content (Wi‑Fi is best) and to check for updates. After that, maps, routes, street search, emergency points, the guide, the library and the assistant all work in airplane mode.'],
      ['Does GPS work without data?', 'Yes. GPS receives signals from satellites, not from the internet, so the map finds you even with no signal. The first fix may take a little longer than with data.'],
      ['How much space does it take?', 'You decide. The welcome wizard suggests a kit for your country and free space (map and navigation, essential guides, Wikipedia and the assistant) and you can switch off each piece. A country takes from a few tens of MB to several GB.'],
      ['Does it work in my country?', 'There are maps, routes and emergency points for almost every country in the world, and a world map is built in from the first second. The app is in English and Spanish, and the library has content in many languages.'],
      ['Is it free? What’s the catch?', 'No catch: it’s free, with no ads, no purchases and no subscriptions. It’s an open source project with no server of its own, so there’s nothing to charge for and no data to sell.'],
      ['Which devices are supported?', 'iPhone and iPad with iOS 16.4 or later. Android 8.0 or later, coming soon to Google Play. The assistant uses Apple Intelligence where available; otherwise you download a model in the app (from about 500 MB; larger ones need more memory).'],
      ['What about Android?', 'It’s in review on Google Play and coming soon, with maps, routes, emergency services, the library, the plan and the assistant. First aid and medical information are only on iPhone and iPad.'],
      ['Do you collect my data?', 'No. No accounts, no analytics, no ads, no tracking. What you do in the app stays on your device. The details are in the <a href="{privacy}">privacy policy</a>.'],
      ['Does it replace the emergency services?', 'No. It helps when there’s no network, but the AI can make mistakes and medical information is no substitute for a professional. If you can, always call the emergency number.'],
    ],
    cta: { h2: 'Get ready today. <br>Tomorrow may be too late.', p: 'Free, open source and ready in a minute. It works when everything else fails.' },
    support: { h2: 'Questions, bugs or ideas?', p: 'Email us or open an issue: we answer everything.', mail: 'Send an email', issues: 'Issues on GitHub' },
    footer: {
      tagline: 'Knowledge that never goes offline',
      credits: `A free, open source app made by <a href="https://github.com/franlindebl">Fran Linde Blázquez</a> · Source code: <a href="${GITHUB}">github.com/franlindebl/nomad-pocket</a>`,
      links: [['{privacy}', 'Privacy'], [GITHUB, 'GitHub'], ['#support', 'Support'], ['../', 'Español']],
      legal: [
        '© 2026 Fran Linde Blázquez and contributors · Free software under the GPL‑3.0-or-later licence.',
        'The AI can make mistakes and medical information is no substitute for a professional. In an emergency, always call the emergency services if you can.',
        'Apple, the Apple logo, iPhone and iPad are trademarks of Apple Inc., registered in the U.S. and other countries. App Store is a service mark of Apple Inc. Google Play is a trademark of Google LLC.',
      ],
    },
    privacyHref: '../privacy.html#en',
  },
};

const strip = (html) => html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
const attr = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

function page(lang) {
  const t = COPY[lang];
  const base = lang === 'es' ? '' : '../';
  const url = ORIGIN + t.path;
  const priv = t.privacyHref;
  const screenPath = (key) => `img/screens/${lang}/${key}.webp`;
  const hasScreen = (key) => existsSync(join(SITE, screenPath(key)));

  const phone = (key, alt, { eager = false, cls = '' } = {}) =>
    hasScreen(key)
      ? `<div class="phone${cls}"><img src="${base}${screenPath(key)}" width="600" height="1304" alt="${attr(alt)}"${eager ? ' fetchpriority="high"' : ' loading="lazy"'} decoding="async"></div>`
      : `<div class="phone missing"></div>`;

  const stores = (where) => {
    const ios = `<a class="badge-ios" href="${APP_STORE}" data-where="${where}"><img src="${base}img/badge-app-store-${lang}.svg" width="162" height="54" alt="${attr(t.appStoreAlt)}"></a>`;
    const android = GOOGLE_PLAY
      ? `<a class="badge-ios" href="${GOOGLE_PLAY}"><img src="${base}img/badge-google-play-${lang}.png" width="140" height="54" alt="${attr(t.googlePlayAlt)}" style="height:54px;width:auto;margin:0 -8px"></a>`
      : `<span class="soon">${icon('smartphone')}<span><small>${t.soon.small}</small><strong>${t.soon.strong}</strong></span></span>`;
    return `<div class="stores">${ios}${android}</div>`;
  };

  const overline = ([n, label]) => `<p class="overline"><span><b>${n}</b> / ${label}</span></p>`;
  const fixLinks = (s) => s.replaceAll('{privacy}', priv);

  const alternates = ['es', 'en']
    .map((l) => `<link rel="alternate" hreflang="${l}" href="${ORIGIN + COPY[l].path}">`)
    .concat(`<link rel="alternate" hreflang="x-default" href="${ORIGIN}/">`)
    .join('\n  ');

  const screenshots = ['home', 'navigation', 'emergency', 'firstaid', 'assistant', 'library', 'plan', 'kit']
    .filter(hasScreen)
    .map((k) => `${ORIGIN}/${screenPath(k)}`);
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'MobileApplication',
        '@id': `${ORIGIN}/#app`,
        name: 'Nomad Pocket',
        alternateName: 'Nomad Pocket: Kit Offline',
        description: t.description,
        url,
        image: `${ORIGIN}/img/icon-512.png`,
        screenshot: screenshots,
        operatingSystem: 'iOS 16.4, iPadOS 16.4',
        applicationCategory: 'UtilitiesApplication',
        inLanguage: ['es', 'en'],
        isAccessibleForFree: true,
        license: 'https://www.gnu.org/licenses/gpl-3.0.html',
        offers: { '@type': 'Offer', price: '0', priceCurrency: lang === 'es' ? 'EUR' : 'USD' },
        installUrl: APP_STORE,
        downloadUrl: APP_STORE,
        author: { '@type': 'Person', name: 'Fran Linde Blázquez' },
        sameAs: [APP_STORE, GITHUB],
      },
      { '@type': 'WebSite', '@id': `${ORIGIN}/#site`, name: 'Nomad Pocket', url: `${ORIGIN}/`, inLanguage: lang },
      {
        '@type': 'FAQPage',
        inLanguage: lang,
        mainEntity: t.faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: strip(fixLinks(a)) } })),
      },
    ],
  };

  const tickerItems = t.ticker.map((s) => `<li>${s}</li>`).join('');

  return `<!doctype html>
<html lang="${lang}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>${t.title}</title>
  <meta name="description" content="${attr(t.description)}">
  <link rel="canonical" href="${url}">
  ${alternates}
  <meta name="theme-color" content="#0C0C0C">
  <meta name="color-scheme" content="dark">
  <meta name="apple-itunes-app" content="app-id=${APP_ID}">
  <meta name="robots" content="index, follow, max-image-preview:large">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Nomad Pocket">
  <meta property="og:title" content="${attr(t.title)}">
  <meta property="og:description" content="${attr(t.description)}">
  <meta property="og:url" content="${url}">
  <meta property="og:image" content="${ORIGIN}/img/og-${lang}.jpg">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:alt" content="${attr(t.ogAlt)}">
  <meta property="og:locale" content="${t.ogLocale}">
  <meta property="og:locale:alternate" content="${lang === 'es' ? 'en_US' : 'es_ES'}">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="icon" href="${base}favicon.png" sizes="48x48">
  <link rel="apple-touch-icon" href="${base}img/apple-touch-icon.png">
  <link rel="manifest" href="${base}site.webmanifest">
  <link rel="preload" href="${base}fonts/ChakraPetch-Bold.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="preload" href="${base}fonts/IBMPlexSans-Regular.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="${base}style.css">
  <link rel="stylesheet" href="${base}landing.css">
  <script>document.documentElement.classList.add('js')</script>
  <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
</head>
<body>
<a class="skip" href="#main">${t.skip}</a>
<div class="lang-hint" data-test="${t.langHint.test}"><div class="wrap"><span>${t.langHint.text} <a href="${t.langSwitch.href}" hreflang="${t.langSwitch.hreflang}">${t.langHint.link}</a></span><button type="button" aria-label="×">×</button></div></div>

<header class="site-header">
  <div class="wrap">
    <a class="logo" href="${lang === 'es' ? './' : './'}"><img src="${base}icon.png" width="34" height="34" alt=""><span>Nomad Pocket</span></a>
    <nav class="site-nav" aria-label="${lang === 'es' ? 'Secciones' : 'Sections'}">
      ${t.nav.map(([h, l]) => `<a href="${h}">${l}</a>`).join('\n      ')}
    </nav>
    <a class="lang-switch" href="${t.langSwitch.href}" hreflang="${t.langSwitch.hreflang}" lang="${t.langSwitch.hreflang}" title="${t.langSwitch.title}">${t.langSwitch.label}</a>
    <a class="btn btn-primary btn-sm" href="#${t.ids.download}">${t.download}</a>
  </div>
</header>

<main id="main" class="landing">
  <section class="hero">
    <div class="wrap">
      <div>
        <p class="status"><i></i><b>${t.hero.status[0]}</b> · ${t.hero.status[1]}</p>
        <h1>${t.hero.h1}</h1>
        <p class="lead">${t.hero.lead}</p>
        ${stores('hero')}
        <ul class="facts">${t.hero.facts.map((f) => `<li>${icon('check')}${f}</li>`).join('')}</ul>
      </div>
      <div class="devices" aria-hidden="false">
        ${phone('home', t.hero.alts.home, { eager: true })}
        ${phone('navigation', t.hero.alts.navigation)}
        <span class="tag-float t1">${icon('navigation')}${t.hero.tag2}</span>
        <span class="tag-float t2">${icon('wifiOff')}${t.hero.tag1}</span>
      </div>
    </div>
  </section>

  <div class="ticker" aria-hidden="true"><div class="ticker-track"><ul>${tickerItems}</ul><ul>${tickerItems}</ul></div></div>

  <section class="section" id="${t.ids.scenarios}">
    <div class="wrap">
      ${overline(t.story.over)}
      <div class="story">
        <div>
          <p class="stamp">${t.story.stamp}<small>${t.story.stampSmall}</small></p>
        </div>
        <div>
          <h2 class="h2">${t.story.h2}</h2>
          ${t.story.paras.map((p) => `<p>${p}</p>`).join('\n          ')}
        </div>
      </div>
      <div class="grid-3">
        ${t.scenarios.map(([ic, h, p]) => `<article class="tile ticks reveal"><span class="icon-badge">${icon(ic)}</span><h3>${h}</h3><p>${p}</p></article>`).join('\n        ')}
      </div>

      <div class="sim ticks reveal" data-cut="${attr(t.sim.cut)}" data-restore="${attr(t.sim.restore)}">
        <div class="sim-head">
          <p class="net">${t.sim.label}: <b class="on">${t.sim.on}</b><b class="off">${t.sim.off}</b></p>
          <button class="btn btn-secondary btn-sm" type="button" aria-pressed="false">${icon('power')}<span>${t.sim.cut}</span></button>
        </div>
        <div class="sim-cols" aria-live="polite">
          <div class="sim-col normal">
            <h3>${icon('smartphone', ' width="22" height="22"')}${t.sim.normal}</h3>
            <ul>${t.sim.rows.map((r) => `<li>${r}<span class="st"><span class="on">${icon('check')}${t.sim.works}</span><span class="off">${icon('x')}${t.sim.down}</span></span></li>`).join('')}</ul>
          </div>
          <div class="sim-col ours">
            <h3><img src="${base}icon.png" width="24" height="24" alt="">${t.sim.ours}</h3>
            <ul>${t.sim.rows.map((r) => `<li>${r}<span class="st">${icon('check')}${t.sim.works}</span></li>`).join('')}</ul>
          </div>
        </div>
        <p class="sim-foot">${t.sim.foot}</p>
      </div>
    </div>
  </section>

  <section class="section" id="${t.ids.features}">
    <div class="wrap">
      ${overline(t.featuresHead.over)}
      <h2 class="h2">${t.featuresHead.h2}</h2>
      <p class="intro">${t.featuresHead.intro}</p>
      <div class="numbers ticks">${t.featuresHead.numbers.map(([n, l]) => `<div><strong>${n}</strong><span>${l}</span></div>`).join('')}</div>
      ${t.features
        .map(
          (f) => `
      <article class="feature">
        <div class="feature-copy reveal">
          <p class="overline" style="--hue:${f.hue}"><span class="icon-badge" style="--hue:${f.hue}">${icon(f.icon)}</span>${f.over}</p>
          <h3>${f.h3}</h3>
          <p>${f.p}</p>
          <ul class="checks">${f.checks.map((c) => `<li>${icon('check')}<span>${c}</span></li>`).join('')}</ul>${f.note ? `\n          <p class="note">${f.note}</p>` : ''}
        </div>
        <div class="feature-media reveal">
          ${phone(f.screen, f.alt)}<div class="fallback ticks" style="--hue:${f.hue}" aria-hidden="true">${icon(f.icon)}</div>
        </div>
      </article>`,
        )
        .join('')}
    </div>
  </section>

  <section class="section" id="${t.ids.how}">
    <div class="wrap">
      ${overline(t.how.over)}
      <h2 class="h2">${t.how.h2}</h2>
      <p class="intro">${t.how.intro}</p>
      <ol class="steps" role="list">
        ${t.how.steps
          .map(
            ([h, p], i) =>
              `<li class="step ticks reveal"><span class="n">0${i + 1}</span><div class="bar" aria-hidden="true">${[0, 1, 2].map((k) => `<i${k <= i ? ' class="on"' : ''}></i>`).join('')}</div><h3>${h}</h3><p>${p}</p></li>`,
          )
          .join('\n        ')}
      </ol>
    </div>
  </section>

  <section class="section" id="${t.ids.privacy}">
    <div class="wrap">
      ${overline(t.privacy.over)}
      <h2 class="h2">${t.privacy.h2}</h2>
      <div class="split">
        <div class="panel ticks reveal">
          <span class="icon-badge">${icon('shieldCheck')}</span>
          <h3>${t.privacy.ownH}</h3>
          <p>${t.privacy.ownP}</p>
          <div class="zeros">${t.privacy.zeros.map(([n, l]) => `<div><strong>${n}</strong><span>${l}</span></div>`).join('')}</div>
          <a class="btn btn-secondary" href="${priv}">${t.privacy.policy}</a>
        </div>
        <div class="panel ticks reveal">
          <span class="icon-badge">${icon('github')}</span>
          <h3>${t.privacy.ossH}</h3>
          <p>${t.privacy.ossP}</p>
          <ul class="credits">${t.privacy.credits.map((c) => `<li>${c}</li>`).join('')}</ul>
          <a class="btn btn-secondary" href="${GITHUB}">${icon('github')}${t.privacy.github}</a>
          <p class="small" style="margin:16px 0 0">${t.privacy.disclaimer}</p>
        </div>
      </div>
    </div>
  </section>

  <section class="section" id="${t.ids.faq}">
    <div class="wrap">
      ${overline(t.faqHead.over)}
      <h2 class="h2">${t.faqHead.h2}</h2>
      <div class="faq">
        ${t.faq.map(([q, a], i) => `<details${i === 0 ? ' open' : ''}><summary>${q}</summary><p>${fixLinks(a)}</p></details>`).join('\n        ')}
      </div>
    </div>
  </section>

  <section id="${t.ids.download}">
    <div class="wrap">
      <div class="cta reveal">
        <div>
          <h2 class="h2">${t.cta.h2}</h2>
          <p>${t.cta.p}</p>
        </div>
        ${stores('cta')}
      </div>
    </div>
  </section>

  <section class="section" id="${t.ids.support}" style="padding-top:56px">
    <div class="wrap">
      <div class="support panel ticks">
        <div>
          <h2>${t.support.h2}</h2>
          <p>${t.support.p}</p>
        </div>
        <div class="actions">
          <a class="btn btn-secondary btn-sm" href="mailto:${EMAIL}">${icon('mail')}${t.support.mail}</a>
          <a class="btn btn-secondary btn-sm" href="${GITHUB}/issues">${icon('github')}${t.support.issues}</a>
        </div>
      </div>
    </div>
  </section>
</main>

<footer class="site-footer">
  <div class="wrap">
    <div class="cols">
      <div>
        <a class="logo" href="./"><img src="${base}icon.png" width="34" height="34" alt=""><span>Nomad Pocket</span></a>
        <p class="tagline">${t.footer.tagline}</p>
      </div>
      <nav aria-label="Footer">
        ${t.footer.links.map(([h, l]) => `<a href="${fixLinks(h)}">${l}</a>`).join('\n        ')}
      </nav>
    </div>
    <p class="credits-line">${t.footer.credits}</p>
    <div class="legal">${t.footer.legal.map((l) => `<p>${l}</p>`).join('')}</div>
  </div>
</footer>

<script>
(function () {
  // Outage simulator: the "normal phone" column goes dark, ours keeps working.
  var sim = document.querySelector('.sim');
  if (sim) {
    var btn = sim.querySelector('button'), label = btn.querySelector('span'), touched = false;
    var set = function (off) {
      if (off) sim.setAttribute('data-offline', ''); else sim.removeAttribute('data-offline');
      btn.setAttribute('aria-pressed', String(off));
      label.textContent = off ? sim.dataset.restore : sim.dataset.cut;
    };
    btn.addEventListener('click', function () { touched = true; set(!sim.hasAttribute('data-offline')); });
    var calm = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!calm && 'IntersectionObserver' in window) {
      var seen = new IntersectionObserver(function (e) {
        if (!e[0].isIntersecting) return;
        seen.disconnect();
        setTimeout(function () { if (!touched) set(true); }, 1200);
      }, { threshold: 0.6 });
      seen.observe(sim);
    }
  }
  // Fade sections in as they scroll into view.
  var items = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
    }, { rootMargin: '0px 0px -8% 0px' });
    items.forEach(function (el) { io.observe(el); });
  } else items.forEach(function (el) { el.classList.add('in'); });
  // Suggest the other language once, when the browser's differs from the page's.
  var hint = document.querySelector('.lang-hint');
  try {
    var want = hint.dataset.test, nav = (navigator.language || '').toLowerCase().slice(0, 2);
    var differs = want.charAt(0) === '!' ? nav && nav !== want.slice(1) : nav === want;
    if (differs && !localStorage.getItem('np-lang-hint')) hint.classList.add('show');
    hint.querySelector('button').addEventListener('click', function () {
      hint.classList.remove('show');
      try { localStorage.setItem('np-lang-hint', '1'); } catch (e) {}
    });
  } catch (e) {}
})();
</script>
</body>
</html>
`;
}

function sitemap() {
  const alt = ['es', 'en'].map((l) => `    <xhtml:link rel="alternate" hreflang="${l}" href="${ORIGIN + COPY[l].path}"/>`).join('\n');
  const entry = (loc, withAlt) => `  <url>\n    <loc>${loc}</loc>\n${withAlt ? alt + '\n' : ''}  </url>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${entry(`${ORIGIN}/`, true)}
${entry(`${ORIGIN}/en/`, true)}
${entry(`${ORIGIN}/privacy.html`, false)}
</urlset>
`;
}

const outputs = { 'index.html': page('es'), 'en/index.html': page('en'), 'sitemap.xml': sitemap() };
const check = process.argv.includes('--check');
let stale = 0;
for (const [rel, content] of Object.entries(outputs)) {
  const file = join(SITE, rel);
  if (check) {
    if (!existsSync(file) || readFileSync(file, 'utf8') !== content) {
      console.error(`stale: site/${rel}`);
      stale++;
    }
    continue;
  }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
  console.log(`wrote site/${rel}`);
}
if (stale) {
  console.error('Run: node scripts/site/build.mjs');
  process.exit(1);
}
