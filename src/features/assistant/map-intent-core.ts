// The assistant's map questions, the pure part: which messages ask about places, routes or where
// the person is ("búscame una farmacia cerca de Móstoles", "llévame al hospital más cercano",
// "¿dónde estoy?"), and what they ask for. Answers are built from the map data, never by the model
// (docs/ASSISTANT_MAP_PLAN.md), so this parser favours precision: anything unsure returns null and the
// message goes the normal way (library, model). Spanish and English.
// Pure TypeScript (no `@/` aliases) so node's test runner loads it.
import { parseCoordinates, type LatLon } from '../maps/geo.ts';
import { CATEGORY_WORDS, normalizeName } from '../maps/places-core.ts';
import type { Costing } from '../maps/routing-core.ts';

/**
 * A place named in a question: the person's position, text to look up (a town, an address, a saved
 * place's name), coordinates, or a result of the previous map answer (0 = first, -1 = last).
 */
export type PlaceRef = { here: true } | { text: string } | { coords: LatLon; name?: string } | { previous: number };

/**
 * `strong`: the wording leaves no doubt it's a map question, so a place that can't be found gets a
 * "not found" card; a weak one goes back to the normal answer instead (a library question that looked
 * like a map one).
 */
export type MapIntent =
  | { kind: 'nearby'; kinds: string[]; near: PlaceRef; name?: string; open?: boolean; onDuty?: boolean; strong: boolean }
  | { kind: 'goNearest'; kinds: string[]; from: PlaceRef; costing?: Costing; strong: boolean }
  | { kind: 'route'; from: PlaceRef; to: PlaceRef; costing?: Costing; askOnly: boolean; strong: boolean }
  | { kind: 'whereAmI'; forCall: boolean; strong: true }
  | { kind: 'shareLocation'; to?: string; strong: true }
  | { kind: 'call'; kinds: string[]; near: PlaceRef; strong: true }
  | { kind: 'callEmergency'; strong: true }
  | { kind: 'whereIs'; place: PlaceRef; coords?: boolean; strong: boolean }
  // Phase 2
  | { kind: 'saveHere'; name: string; strong: true }
  | { kind: 'saved'; names: string[]; strong: true }
  | { kind: 'meetingPoint'; go: boolean; strong: true }
  | { kind: 'lost'; strong: true }
  | { kind: 'sun'; to?: PlaceRef; costing?: Costing; strong: true }
  | { kind: 'alerts'; place: PlaceRef; quakes: boolean; strong: true }
  // Phase 3. `to` absent: the route on the map (guidance or a preview).
  | { kind: 'alongRoute'; kinds: string[]; to?: PlaceRef; rangeKm?: number; strong: true }
  | { kind: 'routeAlerts'; to?: PlaceRef; strong: true }
  | { kind: 'evacuate'; strong: true }
  | { kind: 'trip'; place: string; strong: false }
  /** "¿Qué es este sitio?": the town or neighbourhood you're in, asked of the library (chats.ts rewrites the question). */
  | { kind: 'aboutHere'; strong: true };

/** What the previous map answer of the conversation showed, for follow-ups ("¿y en Getafe?", "llévame a la segunda"). */
export type PreviousMap = { kinds?: string[]; count: number };

// ---------------------------------------------------------------------------
// Words

/** Kinds named by phrases that aren't the kind's name ("comprar ibuprofeno" → pharmacy). Accents off. */
const PHRASE_KINDS: Record<string, string[]> = {
  pharmacy: [
    'comprar medicinas', 'comprar medicamentos', 'comprar ibuprofeno', 'comprar paracetamol', 'comprar aspirinas',
    'comprar tiritas', 'botica', 'buy medicine', 'buy medicines', 'chemists', 'chemist s',
  ],
  fuel: ['repostar', 'echar gasolina', 'poner gasolina', 'gasoil', 'gasoleo', 'diesel', 'petrol', 'refuel', 'fill up'],
  drinking_water: ['agua para beber', 'agua de beber', 'beber agua', 'fuente para beber', 'drinking fountain', 'agua potable'],
  shelter: [
    'donde dormir', 'sitio para dormir', 'sitio donde dormir', 'lugar para dormir', 'lugar donde dormir', 'pasar la noche',
    'refugiarme', 'refugiarnos', 'resguardarme', 'resguardarnos', 'place to sleep', 'somewhere to sleep', 'where to sleep',
  ],
  supermarket: ['super', 'comprar comida', 'tienda de alimentacion', 'tienda de comida', 'food store', 'grocery store', 'buy food'],
  clinic: ['ambulatorio', 'ambulatorios', 'consultorio', 'consultorios', 'centro de atencion primaria', 'gp'],
  police: ['guardia civil', 'cuartel de la guardia civil', 'policia nacional', 'policia local', 'policia municipal', 'mossos', 'ertzaintza'],
  defibrillator: ['dea', 'desa'],
  fire_station: ['estacion de bomberos', 'firehouse'],
  townhall: ['consistorio', 'casa consistorial', 'alcaldia'],
  hardware: ['tienda de bricolaje'],
};

/** Category words too ambiguous inside a sentence; they still count as a whole query ("springs"). */
const SENTENCE_EXCLUDED = new Set(['er', 'spring', 'springs', 'fuel', 'hardware', 'water']);

/** The plural of a phrase's first word: "fuente de agua" → "fuentes de agua". */
function pluralFirst(phrase: string): string {
  const [first, ...rest] = phrase.split(' ');
  const plural = /[aeiou]$/.test(first) ? `${first}s` : /s$/.test(first) ? first : `${first}es`;
  return [plural, ...rest].join(' ');
}

/** Every phrase → kinds, longest first (so "centro de salud" wins over "salud"-like overlaps). */
const PHRASES: { phrase: string; kinds: string[]; whole: boolean }[] = (() => {
  const map = new Map<string, Set<string>>();
  const whole = new Set<string>();
  const add = (phrase: string, kind: string, onlyWhole: boolean) => {
    const key = normalizeName(phrase);
    if (!map.has(key)) map.set(key, new Set());
    map.get(key)!.add(kind);
    if (onlyWhole) whole.add(key);
  };
  for (const [kind, words] of [...Object.entries(CATEGORY_WORDS), ...Object.entries(PHRASE_KINDS)]) {
    for (const w of words) {
      add(w, kind, SENTENCE_EXCLUDED.has(w));
      if (w.includes(' ')) add(pluralFirst(w), kind, false);
    }
  }
  return [...map]
    .map(([phrase, kinds]) => ({ phrase, kinds: [...kinds], whole: whole.has(phrase) }))
    .sort((a, b) => b.phrase.length - a.phrase.length);
})();

const ARTICLES = new Set(['el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'algun', 'alguna', 'algunos', 'algunas', 'the', 'a', 'an', 'some', 'any']);

/** Words that say nothing about what is asked once the category and the place are out. */
const FILLERS = new Set([
  ...ARTICLES,
  'que', 'hay', 'mas', 'muy', 'cerca', 'cercano', 'cercana', 'cercanos', 'cercanas', 'proximo', 'proxima', 'proximos', 'proximas',
  'de', 'del', 'por', 'en', 'a', 'al', 'y', 'o', 'e', 'u', 'mi', 'me', 'nos', 'te', 'aqui', 'aca', 'ahora', 'mismo', 'abierto',
  'abierta', 'abiertos', 'abiertas', 'guardia', 'donde', 'esta', 'estan', 'queda', 'quedan', 'puedo', 'podemos', 'encontrar',
  'encuentro', 'tengo', 'busca', 'buscame', 'buscar', 'busco', 'buscanos', 'encuentra', 'encuentrame', 'localiza', 'localizame',
  'necesito', 'necesitamos', 'hace', 'falta', 'quiero', 'queremos', 'muestrame', 'ensename', 'dime', 'indicame', 'lista', 'listado',
  'ver', 'cual', 'cuales', 'es', 'son', 'hoy', 'zona', 'sitio', 'lugar', 'alguno', 'ningun', 'ninguna', 'tienes', 'conoces',
  'nearest', 'closest', 'nearby', 'near', 'open', 'now', 'is', 'are', 'there', 'where', 'can', 'i', 'we', 'find', 'search', 'look',
  'for', 'locate', 'need', 'show', 'list', 'get', 'tell', 'to', 'in', 'of', 'and', 'or', 'my', 'here', 'please', 'one', 'today',
  'right', 'duty', 'on', 'around', 'want', 'do', 'you', 'know',
]);

/** "Find" verbs: with one, a category plus a few words is a map question. */
const FIND =
  /\b(?:busca|buscame|buscar|busco|buscanos|encuentra|encuentrame|encontrar|localiza|localizame|donde (?:hay|esta|estan|queda|quedan|puedo|podemos|encuentro|tengo)|hay|necesito|necesitamos|me hace falta|quiero|muestrame|ensename|dime|indicame|lista|listado|find|search|look for|locate|where|is there|are there|i need|we need|show me|list|get me)\b/;

/** Questions about knowledge, not places: "¿qué es un hospital de campaña?", "¿cómo purifico agua?". */
const KNOWLEDGE =
  /^(?:como|how)\b(?! (?:voy|llego|puedo ir|puedo llegar|podemos ir|podemos llegar|se va|se llega|ir|llegar|vuelvo|regreso|do i get|do we get|can i get|can we get|to get|far|long))|\b(?:que es|que son|que significa|significa|por que|para que sirve|para que|historia|history|cuando|quien|quienes|cuantos|cuantas|how many|what is|what are|whats|why|who|when|definicion|definition|significado|explica|explain|diferencia|difference|tipos|types|fuga|incendio|herido|sangre|duele|dolor)\b/;

const HERE =
  /^(?:aqui|aca|aqui mismo|aqui cerca|por aqui|mi zona|mi barrio|mi ubicacion|mi posicion|mi localizacion|donde estoy|mi|me|nosotros|here|my location|my position|my area|where i am|us|this area)$/;

const PREVIOUS: [RegExp, number][] = [
  [/^(?:la|el) primer[oa]$|^(?:the )?first(?: one)?$/, 0],
  [/^(?:la|el) segund[oa]$|^(?:the )?second(?: one)?$/, 1],
  [/^(?:la|el) tercer[oa]?$|^(?:the )?third(?: one)?$/, 2],
  [/^(?:la|el) cuart[oa]$|^(?:the )?fourth(?: one)?$/, 3],
  [/^(?:la|el) quint[oa]$|^(?:the )?fifth(?: one)?$/, 4],
  [/^(?:la|el) ultim[oa]$|^(?:the )?last(?: one)?$/, -1],
  [/^(?:ahi|alli|alla|ese sitio|ese lugar|esa|ese|ella|esa farmacia|ese hospital|there|it|that one|that place)$/, 0],
];

const COSTING: [RegExp, Costing][] = [
  [/\b(?:andando|a pie|caminando|paseando|on foot|walking|by walking|to walk)\b/, 'pedestrian'],
  [/\b(?:en bici|en bicicleta|pedaleando|by bike|by bicycle|cycling|biking|to cycle)\b/, 'bicycle'],
  [/\b(?:en coche|en carro|en auto|conduciendo|by car|driving|to drive)\b/, 'auto'],
];

const LEAD =
  /^(?:oye|hola|hey|vale|ok|okay|bueno|por favor|porfa|porfavor|please|me puedes|puedes|podrias|me podrias|podria|can you|could you|would you|will you|quiero que|ayudame a|help me|necesito que)\s+/;
const TRAIL = /\s+(?:por favor|porfa|porfavor|please|gracias|thanks|thank you|en el mapa|on the map)$/;

// ---------------------------------------------------------------------------
// Helpers

/** Lower case, no accents or sentence punctuation; dots and commas inside numbers stay (coordinates). */
export function normalizeQuestion(text: string): string {
  let s = normalizeName(text)
    .replace(/[¿?¡!"«»()“”]/g, ' ')
    .replace(/['’]/g, ' ')
    .replace(/[.,;:](?=\s|$)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  for (let i = 0; i < 4; i++) {
    const next = s.replace(LEAD, '').replace(TRAIL, '').trim();
    if (next === s) break;
    s = next;
  }
  return s;
}

function takeCosting(s: string): { s: string; costing?: Costing } {
  for (const [re, costing] of COSTING) {
    if (re.test(s)) return { s: s.replace(re, ' ').replace(/\s+/g, ' ').trim(), costing };
  }
  return { s };
}

type Found = { kinds: string[]; start: number; end: number };

/** Category phrases inside `s`, word-bounded, not overlapping, in order. */
function findCategories(s: string, allowWhole = false): Found[] {
  const taken: Found[] = [];
  for (const p of PHRASES) {
    if (p.whole && !allowWhole) continue;
    let from = 0;
    for (;;) {
      const i = s.indexOf(p.phrase, from);
      if (i < 0) break;
      const end = i + p.phrase.length;
      const bounded = (i === 0 || s[i - 1] === ' ') && (end === s.length || s[end] === ' ');
      if (bounded && !taken.some((t) => i < t.end && end > t.start)) taken.push({ kinds: p.kinds, start: i, end });
      from = i + 1;
    }
  }
  return taken.sort((a, b) => a.start - b.start);
}

function unique(kinds: string[]): string[] {
  return [...new Set(kinds)];
}

/** Kinds when the whole phrase names a category ("la farmacia más cercana", "un hospital"), else null. */
export function categoryOf(text: string): string[] | null {
  const found = findCategories(text, true);
  if (!found.length) return null;
  let left = text;
  for (const f of [...found].reverse()) left = `${left.slice(0, f.start)} ${left.slice(f.end)}`;
  return left.split(' ').some((w) => w && !FILLERS.has(w)) ? null : unique(found.flatMap((f) => f.kinds));
}

function previousRef(text: string): number | null {
  for (const [re, n] of PREVIOUS) if (re.test(text)) return n;
  return null;
}

/** A place as written: here, a previous result, coordinates or text to look up. */
function placeRef(raw: string): PlaceRef | null {
  const text = raw
    .replace(/\s+(?:ahora mismo|ahora|right now|now|abiert[oa]s?|open|de guardia|on duty|24 ?h(?:oras)?|mas cercan[oa]s?)$/, '')
    .trim();
  if (!text) return null;
  if (HERE.test(text)) return { here: true };
  const prev = previousRef(text);
  if (prev !== null) return { previous: prev };
  const coords = parseCoordinates(text);
  if (coords && !/[a-z]{3,}/.test(text.replace(/\b(?:utm|[nsew]|lat|lon)\b/g, ''))) return { coords };
  // A clause ("el hospital en el que nació Cervantes") is not a place.
  if (/\b(?:que|quien|cuando|donde|como|cual|which|that|who|when|where|how|what)\b/.test(text)) return null;
  if (text.split(' ').length > 7) return null;
  return { text };
}

const LOCATIVE =
  /^(.*?)\s(cerca de(?:l)?|cerquita de(?:l)?|junto a(?:l)?|al lado de(?:l)?|alrededor de(?:l)?|por la zona de(?:l)?|en la zona de(?:l)?|en los alrededores de(?:l)?|en|por|near|around|close to|next to|in|at)\s(.+)$/;

/** Splits "farmacia de guardia en Móstoles" after the category: head and place. */
function splitLocative(s: string, after: number): { head: string; place: string | null } {
  const tail = s.slice(after);
  const m = tail.match(LOCATIVE);
  if (!m) return { head: s, place: null };
  const head = (s.slice(0, after) + m[1]).trim();
  let place = m[3].trim();
  // "del" / "al" glued to the marker: "cerca del Retiro" → "el Retiro".
  if (/(?:del|al)$/.test(m[2])) place = `el ${place}`;
  return { head, place };
}

/** Words left after removing the categories, the place and the fillers. */
function leftover(head: string, found: Found[], extra: RegExp[] = []): string[] {
  let s = head;
  for (const f of [...found].reverse()) s = `${s.slice(0, f.start)} ${s.slice(f.end)}`;
  for (const re of extra) s = s.replace(re, ' ');
  s = s.replace(/\b(?:de guardia|on duty|24 ?h(?:oras)?|ahora mismo|right now|me hace falta|is there|are there|show me|look for)\b/g, ' ');
  return s.split(' ').filter((w) => w && !FILLERS.has(w));
}

// ---------------------------------------------------------------------------
// Intents

const WHERE_AM_I =
  /^(?:donde estoy|donde estamos|donde me encuentro|donde nos encontramos|en que (?:calle|sitio|lugar|pueblo|ciudad|zona|direccion|parte|barrio) (?:estoy|estamos|me encuentro)|cual es mi (?:ubicacion|direccion|posicion|localizacion)(?: actual)?|(?:dame |dime )?mi (?:ubicacion|direccion|posicion|localizacion)(?: actual)?|dime donde estoy|(?:dame |dime |cuales son )?mis coordenadas(?: actuales)?|(?:en )?que coordenadas tengo|where am i|where are we|what s my (?:location|address|position)|what is my (?:location|address|position)|(?:give me |tell me )?my (?:current )?(?:location|address|position|coordinates)|tell me where i am|what are my coordinates|(?:dame |dime |pasame |cuales son )?mis coordenadas (?:en |a )?utm|en que cuadricula (?:utm )?estoy|(?:give me |what are )?my utm(?: coordinates)?)$/;

const FOR_CALL =
  /^(?:que (?:le )?(?:digo|tengo que decir|debo decir|diga|decimos) (?:al|a|a la) (?:112|911|999|061|091|062|080|emergencias|operador|operadora)|que (?:le )?(?:digo|doy) (?:al|a) (?:112|911|999|emergencias) (?:sobre )?donde estoy|como (?:le )?(?:explico|digo|doy) (?:al 112|a emergencias|al 911) donde estoy|como doy mi ubicacion(?: al 112| a emergencias| al 911)?|what do i (?:tell|say to) (?:the )?(?:112|911|999|operator|dispatcher|emergency services)|how do i tell (?:the )?(?:112|911|999|operator|dispatcher|emergency services) where i am)$/;

const SHARE_VERB = /^(?:manda|mandale|mandales|envia|enviale|enviales|enviar|mandar|comparte|compartir|comparteme|pasa|pasale|pasales|send|share|text)\b/;
const LOCATION_WORD = /\b(?:mi ubicacion|mi localizacion|mi posicion|mis coordenadas|donde estoy|ubicacion|localizacion|my location|my position|my coordinates|where i am|location)\b/;

const CALL_VERB = /^(?:llama|llamar|llamame|marca|marcar|telefono de|telefono del|numero de|numero del|call|phone|dial|ring)\s+(.+)$/;
const CALL_EMERGENCY =
  /^(?:al |a )?(?:112|911|999|emergencias|a emergencias|una ambulancia|la ambulancia|ambulancia|a una ambulancia|a la policia|la policia|policia|a los bomberos|los bomberos|bomberos|emergency services|emergency|an ambulance|ambulance|the police|police|the fire (?:department|brigade))$/;
const EMERGENCY_NUMBER =
  /^(?:cual es |dime |dame )?(?:el )?(?:numero|telefono) de (?:emergencias|emergencia)(?: aqui| de aqui| en este pais)?$|^(?:what is |whats |what s )?(?:the )?(?:local )?emergency (?:phone )?number(?: here)?$/;

const ROUTE_FRAME =
  /^(?:(?:dime |indicame |explicame )?como (?:voy|llego|puedo ir|puedo llegar|podemos ir|podemos llegar|se va|se llega|ir|llegar|vuelvo|regreso)|indicame el camino|llevame|lleveme|llevanos|guiame|guianos|navega|navegar|quiero ir|queremos ir|tengo que ir|tenemos que ir|necesito ir|necesito llegar|necesitamos ir|ruta(?: para ir)?|indicaciones(?: para ir)?|take me|take us|navigate|directions|route|how (?:do|can) (?:i|we) (?:get|go)|how to get|get me|drive me|walk me|guide me|i need to get|i need to go|we need to go|i want to go)\b\s*(.*)$/;
/** Route verbs that leave no doubt (a failed lookup gets a card); "ruta", "tengo que ir" may be something else. */
const STRONG_ROUTE = /^(?:(?:dime |indicame |explicame )?como (?:voy|llego|puedo ir|puedo llegar|podemos ir|podemos llegar|se va|se llega|llegar|ir|vuelvo|regreso)|indicame el camino|llevame|lleveme|llevanos|guiame|guianos|navega|take me|take us|navigate|directions|how (?:do|can) (?:i|we) (?:get|go)|how to get|drive me|walk me|guide me)\b/;

const ASK_FRAME =
  /^(?:que tan lejos (?:esta|queda)|a cuanto (?:esta|queda)|cuanto (?:tardo|tardaria|tardariamos|tardamos|se tarda|tiempo (?:tardo|se tarda|hay|es|tardaria)|hay|queda|falta|me queda|me falta|nos queda|nos falta)|a que distancia (?:esta|queda|estoy|estamos)|que distancia hay|how long(?: does it take| will it take| would it take)?(?: to (?:get|go|walk|drive|cycle))?|how far(?: away)?(?: is it| is)?)\b\s*(.*)$/;

const FROM_TO = /^(desde|de|del|from) (.+?) (a|al|hasta|hacia|para|to) (.+)$/;
/** "Toledo desde Madrid", "Toledo from Madrid": the destination first. */
const TO_FROM = /^(.+?) (desde|from) (.+)$/;
const TO_ONLY = /^(?:a|al|hasta|hacia|para|to|towards) (.+)$/;
const ASK_TO_ONLY = /^(?:a|al|hasta|hacia|to|towards) (.+)$/;
/** "¿Cómo llego a ser bombero?": a verb, not a place. */
const VERB_START =
  /^(?:ser|estar|tener|hacer|conseguir|saber|aprender|ganar|trabajar|vivir|dormir|comer|cenar|desayunar|ducharme|acostarme|estudiar|jugar|salir|ver|leer|cocinar|correr|andar|caminar|pasear|comprar|buscar|llamar|preguntar|mirar|descansar|be|become|have|make|get better|sleep|bed|eat|work|cook|bring|buy)\b/;
const ALONG_ROUTE = /\b(?:de camino|en el camino|por el camino|en la ruta|on the way|along the (?:way|route))\b/;

function glued(prefix: string, text: string): string {
  return prefix === 'al' || prefix === 'del' ? `el ${text}` : text;
}

function parseRouteRest(raw: string, strong: boolean, askOnly: boolean, costing: Costing | undefined, previous: PreviousMap | null): MapIntent | null {
  const rest = raw.replace(/^para (?:llegar|ir) /, '');
  if (ALONG_ROUTE.test(rest)) return null;
  const mode = costing ? { costing } : {};
  let fromRef: PlaceRef = { here: true };
  let toText: string | null = null;
  const ft = rest.match(FROM_TO);
  if (ft) {
    const from = placeRef(glued(ft[1], ft[2]));
    if (!from) return null;
    fromRef = from;
    toText = glued(ft[3], ft[4]);
  } else {
    const to = rest.match(askOnly ? ASK_TO_ONLY : TO_ONLY);
    if (to) toText = glued(rest.split(' ')[0], to[1]);
    else if (rest) {
      // "¿A qué distancia está Toledo?", "¿a qué distancia estoy de Toledo?", "take me home", "how do I get there".
      const bare = rest.replace(/^(?:de|del|from) /, (m) => (m.trim() === 'del' ? 'el ' : ''));
      if (/^(?:para|por|con|en|sin|que|for|with|in|until)\b/.test(bare)) return null;
      if (askOnly || previousRef(bare) !== null || strong) toText = bare;
      else return null;
    }
  }
  // "A Toledo desde Madrid", "Toledo desde aquí": the origin after the destination.
  const tf = !ft && toText ? toText.match(TO_FROM) : null;
  if (tf) {
    const from = placeRef(tf[3]);
    if (from && !('previous' in from)) {
      fromRef = from;
      toText = tf[1].replace(/^(?:a|al|hasta|to) /, '');
    }
  }
  if (toText === null) {
    // "¿Cómo llego?", "llévame": to the previous answer's first result.
    if (!previous?.count) return null;
    return { kind: 'route', from: fromRef, to: { previous: 0 }, ...mode, askOnly, strong: true };
  }
  // "Al hospital más cercano", "a una farmacia": the nearest of that kind, by travel time.
  const kinds = categoryOf(toText);
  if (kinds) return { kind: 'goNearest', kinds, from: fromRef, ...mode, strong: true };
  if (VERB_START.test(toText)) return null;
  const to = placeRef(toText);
  if (!to) return null;
  if ('previous' in to && !previous?.count) return null;
  return { kind: 'route', from: fromRef, to, ...mode, askOnly, strong: strong || !!ft };
}

function parseNearby(s: string, previous: PreviousMap | null): MapIntent | null {
  if (KNOWLEDGE.test(s) || ALONG_ROUTE.test(s)) return null;
  // "¿Y en Getafe?" after a list of pharmacies: the same kinds, another place.
  const follow = s.match(/^(?:y )?(?:en|cerca de|por|near|in|around|and in|and near|what about|y que tal en|y por) (.+)$/);
  if (follow && previous?.kinds?.length && !findCategories(s).length) {
    const near = placeRef(follow[1]);
    if (near && !('previous' in near)) return { kind: 'nearby', kinds: previous.kinds, near, strong: false };
  }
  const whole = categoryOf(s);
  if (whole) return { kind: 'nearby', kinds: whole, near: { here: true }, ...flags(s), strong: true };

  const firstCats = findCategories(s);
  if (!firstCats.length) return null;
  const { head, place } = splitLocative(s, firstCats[0].end);
  const cats = findCategories(head);
  if (!cats.length) return null;
  const kinds = unique(cats.flatMap((c) => c.kinds));

  // "La embajada de España": the country is a name filter, not a place.
  let name: string | undefined;
  let nameRe: RegExp | null = null;
  if (kinds.includes('embassy')) {
    const m = head.match(/\b(?:embajadas?|consulados?|embass(?:y|ies)|consulates?) (?:de|del|of) (?:la |los |las |the )?([a-z]+(?: [a-z]+)?)$/);
    if (m) {
      name = m[1];
      nameRe = new RegExp(`\\b(?:de|del|of) (?:la |los |las |the )?${m[1]}$`);
    }
  }
  const extra = nameRe ? [nameRe] : [];
  const left = leftover(head, cats, extra);
  const hasFind = FIND.test(head);
  const nearWord = /\b(?:cerca|cercan[oa]s?|proxim[oa]s?|nearest|closest|nearby|por aqui|near me)\b/.test(head);
  let near: PlaceRef | null = null;
  if (place) {
    near = placeRef(place);
    if (!near) return null;
    if ('previous' in near) return null;
  } else if (nearWord || hasFind || !left.length) near = { here: true };
  if (!near) return null;
  if (left.length > (hasFind || place || nearWord ? 1 : 0)) return null;
  return { kind: 'nearby', kinds, near, ...(name ? { name } : {}), ...flags(s), strong: hasFind || nearWord || !left.length };
}

function flags(s: string): { open?: boolean; onDuty?: boolean } {
  const out: { open?: boolean; onDuty?: boolean } = {};
  if (/\b(?:abiert[oa]s?|open)\b/.test(s)) out.open = true;
  if (/\b(?:de guardia|on duty|24 ?h(?:oras)?)\b/.test(s)) out.onDuty = true;
  return out;
}

// --- Phase 2 -------------------------------------------------------------------

const SAVE_HERE =
  /^(?:guarda|guardame|guardar|apunta|apuntame|marca|save|mark)\s+(?:donde estoy|donde estamos|esta (?:ubicacion|posicion)|mi (?:ubicacion|posicion)|este (?:sitio|lugar|punto)|aqui|el sitio donde estoy|where i am|this (?:place|spot|location)|my location|here)\s+(?:como|con el nombre(?: de)?|as|called|named)\s+(.+)$/;
const PARKED = /^(?:donde (?:he )?aparcado|donde aparque|donde (?:he )?dejado el coche|donde deje el coche|donde esta (?:mi|el) coche|where did i park|where is my car|where did i leave the car)$/;
const MEETING =
  /^(?:(?:donde|en que sitio) (?:quedamos|nos vemos|nos encontramos|nos reunimos)(?: si nos separamos| si no hay cobertura| si pasa algo| en una emergencia)?|cual es (?:nuestro|el) punto de encuentro|(?:donde esta )?(?:el|nuestro) punto de encuentro|where do we meet(?: if we get separated| in an emergency)?|where is our meeting point|what is our meeting point)$/;
const MEETING_GO = /^(?:llevame|llevanos|como (?:llego|llegamos|voy|vamos)|ir|take me|take us|how do i get|how do we get)\b.*\bpunto de encuentro\b|^(?:take me|take us|how do (?:i|we) get) to (?:the |our )?meeting point$/;
const LOST =
  /^(?:(?:creo que )?(?:me he perdido|estoy perdid[oa]|estamos perdid[oa]s|nos hemos perdido)(?: en (?:el monte|la montana|el bosque|la sierra|el campo))?|hacia donde (?:esta|queda) el pueblo mas cercano|donde (?:esta|queda) el pueblo mas cercano|cual es el pueblo mas cercano|i m lost|i am lost|we re lost|we are lost|where is the nearest (?:town|village))$/;
const DARK = /\s*(?:antes de que (?:anochezca|se haga de noche|oscurezca|se ponga el sol)|antes del anochecer|before (?:dark|nightfall|sunset|it gets dark))\s*/;
const SUN_ONLY =
  /^(?:a que hora (?:anochece|se hace de noche|se pone el sol|oscurece|amanece|sale el sol)|cuanta luz (?:me |nos )?queda|cuando (?:anochece|se pone el sol|amanece|sale el sol)|when (?:is sunset|is sunrise|does the sun set|does the sun rise|does it get dark)|how much (?:day)?light (?:is |do i have |do we have )?left)$/;
const ARRIVE = /^(?:llego|llegamos|llegare|llegaremos|me da tiempo a llegar|nos da tiempo a llegar|da tiempo a llegar|puedo llegar|podemos llegar|can i get|can we get|will i get|will we get|can i make it|can we make it|will i make it)(?: (?:a|al|hasta|to))? (.+)$/;
const ALERTS =
  /^(?:(?:hay|tengo|tenemos) (?:alguna |algun )?(?:alertas?|avisos?)(?: oficiales?)?(?: (?:activos?|activas?))?(?: (?:cerca|aqui|por aqui|en mi zona|donde estoy))?|(?:que|cuales) (?:alertas?|avisos?) hay(?: (?:aqui|cerca|por aqui|en mi zona))?|any (?:alerts|warnings)(?: (?:near me|here|nearby|around here))?|(?:are there )?(?:any )?alerts near me)$/;
const ALERTS_AT = /^(?:(?:que|cuales|hay) (?:alertas?|avisos?)(?: hay)?|any (?:alerts|warnings)) (?:en|para|in|for) (.+)$/;
const QUAKES = /^(?:(?:ha habido|hay|hubo) (?:algun |un )?(?:terremotos?|seismos?|temblor(?:es)? de tierra|temblor(?:es)?)(?: (?:cerca|por aqui|aqui|hoy))?|(?:has there been|were there|was there|is there) (?:an? |any )?(?:earthquakes?|quakes?)(?: (?:near me|nearby|here|today))?)$/;
const COORDS_OF = /^(?:(?:que|cuales son las|dame las|dime las) )?coordenadas (?:tiene|de|del) (.+)$|^(?:what are )?(?:the )?coordinates (?:of|for) (.+)$/;

// --- Phase 3 -------------------------------------------------------------------

const ALONG_TO = /\b(?:de camino|en el camino|por el camino|camino|en la ruta|on the way|along the way|along the route|en el trayecto|en el viaje)\s+(?:a|al|hacia|hasta|para|to|towards)\s+(.+)$/;
const RANGE = /\b(\d{1,4})\s*(?:km|kms|kilometros|kilometers|kilometres)\b/;
const FUEL_WORDS = /\b(?:gasolina|combustible|gasoil|deposito|fuel|petrol|gas|tank|autonomia|range)\b/;
const RANGE_WORDS = /\b(?:autonomia|range|me quedan|nos quedan|quedan|tengo para|left|me da|da para|llego con)\b/;
const ROUTE_ALERTS = /\b(?:avisos?|alertas?|warnings?|alerts?)\b.*\b(?:mi ruta|la ruta|el camino|de camino|el trayecto|el viaje|my route|the route|the way|on the way)\b|\b(?:afecta|afectan|affects?)\b.*\b(?:mi ruta|la ruta|el camino|el trayecto|my route|the route)\b/;
const EVACUATE =
  /^(?:(?:tengo|tenemos|necesito|necesitamos) que salir|como (?:salgo|salimos)|por donde (?:salgo|salimos)|adonde (?:voy|vamos)(?: para salir)?|hacia donde (?:voy|vamos|salgo|salimos)(?: para salir)?|salir) de (?:la )?(?:zona del aviso|zona de la alerta|zona del incendio|zona inundada|zona de la inundacion|zona afectada|la zona)$|^(?:how do (?:i|we) )?(?:get out of|leave) the (?:alert|warning|affected|flood|fire) (?:area|zone)$/;
const TRIP =
  /^(?:me voy|nos vamos|voy|vamos|viajo|viajamos|me marcho|nos marchamos|preparo un viaje|preparar (?:un )?viaje|planear (?:un )?viaje|planeo un viaje|i m (?:going|travelling|traveling)|we re (?:going|travelling|traveling)|i am (?:going|travelling|traveling)|trip|travelling|traveling)(?: de viaje)? (?:a|al|para|to) (.+)$/;
/** What follows the destination in "me voy a Marruecos la semana que viene, ¿qué necesito?". */
const TRIP_TAIL = /\s+(?:que|y|la|el|esta|este|dentro|manana|pasado|en|para|de|next|this|in|for|and|what|tomorrow)\b.*$/;

const ABOUT_HERE =
  /^(?:que es (?:este|esta) (?:sitio|lugar|pueblo|ciudad|barrio|zona)|que (?:sitio|lugar|pueblo|ciudad|barrio) es este|hablame de (?:este|esta) (?:sitio|lugar|pueblo|ciudad|barrio|zona)|que (?:se sabe|sabes) de (?:este|esta) (?:sitio|lugar|pueblo|ciudad|barrio|zona)|what is this (?:place|town|city|village|neighbourhood|neighborhood)|tell me about this (?:place|town|city|village|area))$/;

function parsePhase3(s: string): MapIntent | null {
  if (ABOUT_HERE.test(s)) return { kind: 'aboutHere', strong: true };
  if (KNOWLEDGE.test(s.replace(/^como (?:salgo|salimos)\b/, 'salir'))) {
    // "¿Cómo salgo de la zona…?" is a route question, not knowledge; anything else stays out.
    if (!/^como (?:salgo|salimos)\b/.test(s)) return null;
  }
  if (EVACUATE.test(s)) return { kind: 'evacuate', strong: true };
  if (ROUTE_ALERTS.test(s)) {
    const to = s.match(ALONG_TO);
    const ref = to ? placeRef(to[1]) : null;
    return { kind: 'routeAlerts', ...(ref && !('here' in ref) ? { to: ref } : {}), strong: true };
  }
  // "¿Me da la gasolina? Me quedan 80 km": fuel along the route, the last stop within the range.
  const range = s.match(RANGE);
  if (range && FUEL_WORDS.test(s) && RANGE_WORDS.test(s)) {
    const to = s.match(/\b(?:llegar|ir|to get|get|reach)\s+(?:a|al|hasta|to)\s+(.+?)(?:\s+(?:me|nos|si|con|y|with|and)\b.*)?$/) ?? s.match(ALONG_TO);
    const ref = to ? placeRef(to[1].replace(RANGE, '').trim()) : null;
    return { kind: 'alongRoute', kinds: ['fuel'], ...(ref && !('here' in ref) ? { to: ref } : {}), rangeKm: Number(range[1]), strong: true };
  }
  if (ALONG_ROUTE.test(s)) {
    const to = s.match(ALONG_TO);
    const head = to ? s.slice(0, s.indexOf(to[0])) : s;
    const kinds = unique(findCategories(head, true).flatMap((f) => f.kinds));
    if (!kinds.length) return null;
    const ref = to ? placeRef(to[1]) : null;
    if (to && (!ref || 'previous' in ref || 'here' in ref)) return null;
    return { kind: 'alongRoute', kinds, ...(ref ? { to: ref } : {}), strong: true };
  }
  const trip = s.match(TRIP);
  if (trip) {
    const place = trip[1].replace(TRIP_TAIL, '').trim();
    // "Me voy a dormir", "voy a comer": a verb, not a destination.
    const verb = VERB_START.test(place);
    if (place && !verb && place.split(' ').length <= 4 && !findCategories(place, true).length) return { kind: 'trip', place, strong: false };
  }
  return null;
}

function parsePhase2(s: string): MapIntent | null {
  const save = s.match(SAVE_HERE);
  if (save) {
    const name = save[1].replace(/^(?:el|la|los|las|mi|the|my)\s+/, '').trim();
    if (name && name.split(' ').length <= 5) return { kind: 'saveHere', name: save[1].trim(), strong: true };
  }
  if (PARKED.test(s)) return { kind: 'saved', names: ['coche', 'el coche', 'mi coche', 'car', 'my car', 'aparcamiento', 'parking'], strong: true };
  if (MEETING.test(s)) return { kind: 'meetingPoint', go: false, strong: true };
  if (MEETING_GO.test(s)) return { kind: 'meetingPoint', go: true, strong: true };
  if (LOST.test(s)) return { kind: 'lost', strong: true };
  if (SUN_ONLY.test(s)) return { kind: 'sun', strong: true };
  if (DARK.test(s)) {
    const rest = s.replace(DARK, ' ').replace(/\s+/g, ' ').trim();
    const { s: plain, costing } = takeCosting(rest);
    const m = plain.match(ARRIVE);
    if (m) {
      const to = placeRef(m[1].replace(/^(?:a|al|hasta|to) /, ''));
      if (to && !('here' in to)) return { kind: 'sun', to, costing: costing ?? 'pedestrian', strong: true };
    }
  }
  if (QUAKES.test(s)) return { kind: 'alerts', place: { here: true }, quakes: true, strong: true };
  if (ALERTS.test(s)) return { kind: 'alerts', place: { here: true }, quakes: false, strong: true };
  const at = s.match(ALERTS_AT);
  if (at) {
    const place = placeRef(at[1]);
    if (place && !('previous' in place)) return { kind: 'alerts', place, quakes: false, strong: true };
  }
  const co = s.match(COORDS_OF);
  if (co) {
    const place = placeRef(co[1] ?? co[2]);
    if (place && !('here' in place)) return { kind: 'whereIs', place, coords: true, strong: true };
  }
  return null;
}

/**
 * What a message asks of the map, or null when it isn't a map question (or isn't clearly one).
 * `previous`: the conversation's last map answer, for follow-ups.
 */
export function parseMapIntent(text: string, previous: PreviousMap | null = null): MapIntent | null {
  const s = normalizeQuestion(text);
  if (!s || s.length > 160) return null;

  if (FOR_CALL.test(s)) return { kind: 'whereAmI', forCall: true, strong: true };
  const phase2 = parsePhase2(s);
  if (phase2) return phase2;
  const phase3 = parsePhase3(s);
  if (phase3) return phase3;
  if (WHERE_AM_I.test(s)) return { kind: 'whereAmI', forCall: false, strong: true };
  if (EMERGENCY_NUMBER.test(s)) return { kind: 'callEmergency', strong: true };

  if (SHARE_VERB.test(s) && LOCATION_WORD.test(s)) {
    const after = s.slice(s.search(LOCATION_WORD));
    const to = after.match(/\s(?:a|to)\s(.+)$/);
    const name = to?.[1]
      .replace(/\s+(?:por|via|by|con|with)\s+(?:sms|mensaje|whatsapp|text|message)$/, '')
      .replace(/^(?:mi|my|el|la)\s+/, '')
      .trim();
    return { kind: 'shareLocation', ...(name ? { to: name } : {}), strong: true };
  }

  const call = s.match(CALL_VERB);
  if (call) {
    const rest = call[1].trim();
    if (CALL_EMERGENCY.test(rest)) return { kind: 'callEmergency', strong: true };
    const head = rest.replace(/^(?:a|al|to)\s/, '');
    const found = findCategories(head);
    if (found.length) {
      let { head: what, place } = splitLocative(head, found[0].end);
      // "El hospital de Móstoles".
      const of = place ? null : what.slice(found[0].end).match(/^ (?:de|del|of) (.+)$/);
      if (of) {
        what = what.slice(0, found[0].end);
        place = of[1];
      }
      const kinds = categoryOf(what);
      if (kinds) {
        const near = place ? placeRef(place) : { here: true as const };
        if (near && !('previous' in near)) return { kind: 'call', kinds, near, strong: true };
      }
    }
    return null;
  }

  const ask = s.match(ASK_FRAME);
  if (ask) {
    const { s: rest, costing } = takeCosting(ask[1].trim());
    return parseRouteRest(rest, false, true, costing ?? takeCosting(s).costing, previous);
  }

  // "Walk me", "drive me" carry the mode in the verb.
  const verbCosting: Costing | undefined = /^walk me\b/.test(s) ? 'pedestrian' : /^drive me\b/.test(s) ? 'auto' : undefined;
  const route = s.match(ROUTE_FRAME);
  if (route) {
    const { s: rest, costing } = takeCosting(route[1].trim());
    return parseRouteRest(rest, STRONG_ROUTE.test(s), false, costing ?? verbCosting, previous);
  }

  const nearby = parseNearby(s, previous);
  if (nearby) return nearby;

  // "Estoy en Aranjuez, ¿dónde queda la comisaría?": the place said apart from the request.
  const at = s.match(/(?:^|\s)(?:estoy|estamos|me encuentro|nos encontramos|i m|i am|we re|we are) (?:en|cerca de|por|in|near|at|around) ([^,]+?)(?=\s(?:y|and|donde|where)\s|$)/);
  if (at) {
    const rest = s.replace(at[0], ' ').replace(/\s+/g, ' ').trim();
    const place = placeRef(at[1]);
    const inner = rest && place && !('previous' in place) && !('here' in place) ? parseNearby(rest, null) : null;
    if (inner?.kind === 'nearby' && 'here' in inner.near) return { ...inner, near: place!, strong: true };
  }

  const where = s.match(/^(?:donde (?:esta|queda|cae)|where is|where s|ubicame|muestrame|ensename|show me) (.+)$/);
  if (where && !KNOWLEDGE.test(s)) {
    const place = placeRef(where[1]);
    // "¿Dónde está la embajada de mi país?" names a kind, not a place to look up.
    if (place && !('here' in place) && !('previous' in place) && !findCategories(normalizeQuestion(where[1]), true).length) {
      return { kind: 'whereIs', place, strong: false };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// The model's say (phase 1b): phrasings the parser misses ("se me acaba la gasolina y estoy en Ávila") reach the
// model, which may call search_map (GGUF tools) or fill the router's map fields (Apple). It only extracts what is
// asked; the answer is still the map card. Anything that doesn't name a known kind or place is dropped.

export const MAP_TOOL_NAME = 'search_map';

export const MAP_ACTIONS = ['nearby', 'go_nearest', 'route', 'where_am_i'] as const;

/** What a model said about a map question: search_map's arguments, or the router's map fields. */
export type MapModelArgs = { action?: string; category?: string; place?: string; destination?: string; mode?: string };

/** OpenAI-style definition of search_map, for chat templates with tools. Offered next to search_library. */
export function mapToolSpec(lang: 'es' | 'en') {
  const t =
    lang === 'es'
      ? {
          d: 'Busca en los mapas sin conexión: sitios de un tipo cerca de un lugar (farmacia, hospital, gasolinera, agua potable, refugio, policía, supermercado…), cómo llegar o cuánto se tarda a un sitio, o dónde está el usuario. Responde con una tarjeta del mapa.',
          action: 'nearby: sitios de un tipo cerca; go_nearest: llevar al más cercano de un tipo; route: ruta o tiempo hasta un destino; where_am_i: dónde está el usuario.',
          category: 'El tipo de sitio en palabras del usuario (ej. "farmacia", "gasolinera"). Vacío si no hay.',
          place: 'Pueblo, dirección o lugar de referencia (o el origen de una ruta). Vacío si es donde está el usuario.',
          destination: 'Solo en route: el destino.',
          mode: 'car, walk o bike, si el usuario lo dice.',
        }
      : {
          d: "Searches the offline maps: places of a kind near somewhere (pharmacy, hospital, petrol station, drinking water, shelter, police, supermarket…), directions or travel time to a place, or where the user is. Answers with a map card.",
          action: 'nearby: places of a kind nearby; go_nearest: take the user to the nearest of a kind; route: route or travel time to a destination; where_am_i: where the user is.',
          category: 'The kind of place in the user\'s words (e.g. "pharmacy", "petrol station"). Empty if none.',
          place: "Town, address or landmark (or a route's origin). Empty for the user's position.",
          destination: 'Only for route: the destination.',
          mode: 'car, walk or bike, if the user says so.',
        };
  return {
    type: 'function',
    function: {
      name: MAP_TOOL_NAME,
      description: t.d,
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: [...MAP_ACTIONS], description: t.action },
          category: { type: 'string', description: t.category },
          place: { type: 'string', description: t.place },
          destination: { type: 'string', description: t.destination },
          mode: { type: 'string', enum: ['car', 'walk', 'bike'], description: t.mode },
        },
        required: ['action'],
      },
    },
  };
}

/** The line added to the tools system prompt when search_map is offered. */
export const MAP_TOOL_RULE: Record<'es' | 'en', string> = {
  es: 'Si el usuario pide encontrar un tipo de sitio (farmacia, hospital, gasolinera, agua, refugio, policía…) cerca de algún lugar, cómo llegar o cuánto se tarda a un sitio, o dónde está, llama a search_map, no a search_library.',
  en: 'If the user asks to find a kind of place (pharmacy, hospital, petrol station, water, shelter, police…) near somewhere, directions or travel time to a place, or where they are, call search_map, not search_library.',
};

/** Added to the router's instructions when maps are installed (the router's map fields, nomad-llm SearchDecision). */
export const MAP_ROUTER_RULES = [
  'The assistant can also search the offline maps. Set map to true when the latest message asks to find a kind of place near somewhere (pharmacy, hospital, health centre, petrol station, drinking water, shelter, police, supermarket, hardware shop, town hall, embassy, defibrillator), how to get to a place or how long it takes, or where the user is. Then set search to false.',
  'mapAction: nearby (places of a kind near somewhere), go_nearest (take me to the nearest one), route (directions or travel time to a destination), where_am_i. mapCategory: the kind of place in the user\'s words. mapPlace: the town, address or landmark, or the origin of a route; empty for the user\'s position. mapDestination: only for route.',
  'Questions about places as knowledge (history, what something is, how hospitals work) are not map questions.',
  '',
  'Map examples:',
  '"se me está acabando la gasolina y estoy cerca de Ávila" → map, nearby, "gasolinera", "Ávila"',
  '"¿dónde puedo llenar las botellas de agua en Cercedilla?" → map, nearby, "agua potable", "Cercedilla"',
  '"tengo que ver a un médico urgente, estoy en Leganés" → map, go_nearest, "centro de salud", "Leganés"',
  '"¿qué tan lejos queda Toledo desde Madrid?" → map, route, place "Madrid", destination "Toledo"',
  '"we need somewhere to sleep tonight" → map, nearby, "shelter", ""',
  '"¿cuándo se fundó el hospital de La Paz?" → search, not map',
].join('\n');

/** search_map's arguments from a tool call (lenient: a bare object or a JSON string). */
export function parseMapToolArgs(args: string | undefined): MapModelArgs {
  if (!args) return {};
  try {
    const v: unknown = JSON.parse(args);
    if (!v || typeof v !== 'object') return {};
    const s = (k: string) => {
      const x = (v as Record<string, unknown>)[k];
      return typeof x === 'string' ? x : undefined;
    };
    return { action: s('action'), category: s('category'), place: s('place'), destination: s('destination'), mode: s('mode') };
  } catch {
    return {};
  }
}

/** The kinds a model's category names: a category word ("farmacia", "petrol station") or a kind id ("drinking_water"). */
/** Words small models put in `category` that aren't category words of the parser (a misspelling included). */
const MODEL_CATEGORY: [RegExp, string][] = [
  [/^(?:tiendas?|shops?|stores?|comida|food|alimentacion)$/, 'supermarket'],
  [/^(?:emba\w*|embassy|embassies|consulados?)$/, 'embassy'],
  [/^(?:medicos?|doctors?|ambulatorios?)$/, 'clinic'],
  [/^(?:urgencias|emergency room|er)$/, 'hospital'],
];

function kindsOfCategory(category: string | undefined): string[] | null {
  const s = normalizeQuestion(category ?? '');
  if (!s) return null;
  if (s.replace(/ /g, '_') in CATEGORY_WORDS) return [s.replace(/ /g, '_')];
  for (const [re, kind] of MODEL_CATEGORY) if (re.test(s)) return [kind];
  // The whole category only: "ayuntamiento de Getafe" is a kind near a place (intentFromModel), not a kind.
  const whole = categoryOf(s);
  if (whole) return whole;
  // A misspelt category ("parke de bomberos"): its stem, for a short phrase only.
  if (s.split(' ').length <= 3) for (const [re, kind] of CATEGORY_STEMS) if (re.test(s)) return [kind];
  // What it is for ("pilas y linterna" → a hardware shop or a supermarket).
  const purpose = PURPOSE.filter(([re]) => re.test(s)).flatMap(([, kinds]) => kinds);
  return purpose.length ? unique(purpose) : null;
}

/** Stems of the kinds, for a model's misspelt category; first match wins. */
const CATEGORY_STEMS: [RegExp, string][] = [
  [/farmac|pharmac|chemist/, 'pharmacy'],
  [/bomber|fire ?(?:station|brigade|department)/, 'fire_station'],
  [/hospit|urgenc/, 'hospital'],
  [/salud|clinic|medic|doctor/, 'clinic'],
  [/gasolin|petrol|fuel|gas station/, 'fuel'],
  [/polic|comisar|guardia civil/, 'police'],
  [/supermer|supermark|grocer/, 'supermarket'],
  [/desfibril|defibril/, 'defibrillator'],
  [/ayunta|town ?hall|city ?hall/, 'townhall'],
  [/ferret|hardware/, 'hardware'],
  [/embaj|embas|consul/, 'embassy'],
  [/refugi|shelter|albergue/, 'shelter'],
  [/agua|water|fuente|fountain/, 'drinking_water'],
];


function costingOf(mode: string | undefined): Costing | undefined {
  const m = normalizeName(mode ?? '');
  if (/^(?:car|auto|drive|driving|coche)/.test(m)) return 'auto';
  if (/^(?:walk|foot|pedestrian|pie|andando)/.test(m)) return 'pedestrian';
  if (/^(?:bike|bicycle|cycling|bici)/.test(m)) return 'bicycle';
  return undefined;
}

/** A place a model wrote; empty or "here" words are the person's position. Null: not a usable place. */
function modelPlace(text: string | undefined, question: string | null = null): PlaceRef | null {
  const s = normalizeQuestion(text ?? '');
  if (!s || /^(?:aqui|here|current location|my location|mi ubicacion|user|usuario|el usuario|the user|ninguno|none|n a)$/.test(s)) return { here: true };
  // A place the question doesn't name is the model's invention (a town from the instructions' examples).
  if (question !== null) {
    const words = s.split(' ').filter((w) => w.length > 2 && !FILLERS.has(w));
    if (!words.length || !words.every((w) => new RegExp(`\\b${w}\\b`).test(question))) return null;
  }
  const ref = placeRef(s);
  return ref && !('previous' in ref) ? ref : null;
}

/**
 * The intent a model's map call stands for, or null when it doesn't name something the map can answer (an unknown
 * kind, no destination). Model intents are strong: the model chose the map, so a place it can't find gets a card.
 */
export function intentFromModel(a: MapModelArgs, question?: string): MapIntent | null {
  const action = normalizeName(a.action ?? '').replace(/[\s-]+/g, '_');
  const mode = costingOf(a.mode);
  const costing = mode ? { costing: mode } : {};
  // On the bench both models sent crisis questions to the map ("huele a humo" → shelters, "un hombre me sigue" →
  // police, "¿tengo que ir al médico?" → health centres in Leganés, a town from the router's examples). What the
  // question itself says decides: it must ask where/how to get somewhere, name the kind (or what it is for), and
  // name the place the model wrote.
  const q = question === undefined ? null : normalizeQuestion(question);
  const asks = q === null || ASKS_WHERE.test(q);
  const named = q === null ? null : namedKinds(q);
  const fits = (kinds: string[]) => named === null || kinds.some((k) => named.has(k));
  const place = (text: string | undefined) => modelPlace(text, q);
  if (!asks) return null;
  if (action === 'where_am_i') return q === null || /\b(?:donde|ubicacion|posicion|coordenadas|direccion|where|location|coordinates|address)\b/.test(q) ? { kind: 'whereAmI', forCall: false, strong: true } : null;
  if (action === 'nearby' || action === 'go_nearest') {
    const kinds = kindsOfCategory(a.category);
    const near = place(a.place);
    if (!kinds || !near || !fits(kinds)) return null;
    // A town the model wrote may not be in the index: then the library answers, no "not found" card.
    const strong = 'here' in near;
    return action === 'nearby' ? { kind: 'nearby', kinds, near, strong } : { kind: 'goNearest', kinds, from: near, ...costing, strong };
  }
  if (action === 'route') {
    const from = place(a.place);
    const dest = normalizeQuestion(a.destination ?? '');
    if (!from || !dest) return null;
    // "El ayuntamiento de Getafe": that kind near that place ("farmacia de guardia" is a kind: its tail is fillers).
    const found = findCategories(dest, true)[0];
    const of = found && found.start === 0 ? dest.slice(found.end).match(/^ (?:de|del|en|of|in) (.+)$/) : null;
    if (found && of && of[1].split(' ').some((w) => !FILLERS.has(w))) {
      const near = place(of[1]);
      if (!near || 'here' in near || !fits(found.kinds)) return null;
      return { kind: 'nearby', kinds: found.kinds, near, strong: false };
    }
    const kinds = kindsOfCategory(dest);
    if (kinds) return fits(kinds) ? { kind: 'goNearest', kinds, from, ...costing, strong: 'here' in from } : null;
    const to = place(dest);
    if (!to || 'here' in to) return null;
    // Weak: a destination the maps don't know ("casa", "el trabajo") goes back to the library.
    return { kind: 'route', from, to, ...costing, askOnly: false, strong: false };
  }
  return null;
}

/** The question asks where something is, or how to get somewhere (or says where the person is). */
const ASKS_WHERE =
  /\b(?:donde|adonde|cerca|cercan[oa]s?|proxim[oa]s?|hay|busc\w*|encuentr\w*|encontrar|llevame|llegar|ir a|ir al|camino|ruta|lejos|distancia|tardo|tarda|tardaria|llevaria|estoy en|estamos en|estoy cerca|estamos cerca|estoy por|estamos por|where|near|nearby|around|find|is there|are there|take me|get to|how far|how long|i m in|i m near|we re in|we re near|i am in|i am near|how do i (?:get|go|walk|drive|cycle)|(?:walk|drive|get|go) from)\b/;

/** What a question names by what it is for ("¿dónde denuncio?", "no tengo insulina"), and the kinds it means. */
const PURPOSE: [RegExp, string[]][] = [
  [/\b(?:medicamentos?|medicinas?|medicacion|paracetamol|ibuprofeno|insulina|receta|medicine|medication|insulin)\b/, ['pharmacy']],
  [/\b(?:denunci\w*|robad[oa]s?|robo|report|stolen)\b/, ['police']],
  [/\b(?:tienda|comida|alimentos?|shop|store|food)\b/, ['supermarket']],
  [/\b(?:pilas|linterna|batteries|torch|flashlight)\b/, ['hardware', 'supermarket']],
  [/\b(?:pasaporte|passport)\b/, ['embassy', 'police']],
  [/\b(?:gasolina|gasoil|combustible|carburante|fuel|petrol|gas)\b/, ['fuel']],
  [/\b(?:medico|doctor)\b/, ['clinic', 'hospital']],
  [/\b(?:dormir|sleep)\b/, ['shelter']],
  [/\b(?:water|refill)\b/, ['drinking_water']],
];

/** The kinds a question names, by name or purpose; a hospital and a health centre stand in for each other. */
export function namedKinds(normalized: string): Set<string> {
  const out = new Set(findCategories(normalized, true).flatMap((f) => f.kinds));
  for (const [re, kinds] of PURPOSE) if (re.test(normalized)) kinds.forEach((k) => out.add(k));
  if (out.has('hospital')) out.add('clinic');
  if (out.has('clinic')) out.add('hospital');
  return out;
}

/** Whether a question names a kind of place, by name or by what it is for. */
export function namesAPlace(question: string): boolean {
  return namedKinds(normalizeQuestion(question)).size > 0;
}

// ---------------------------------------------------------------------------
// Places named in a library answer (phase 3, #21/#22): candidates for "Ver en el mapa" chips under it. Capitalised
// runs of words ("Alcalá de Henares", "San Lorenzo de El Escorial"); the index decides which are real places.

/** Capitalised words that start sentences or are names of other things, never looked up. */
const NOT_PLACES = new Set(
  [
    'el', 'la', 'los', 'las', 'un', 'una', 'si', 'no', 'para', 'por', 'en', 'de', 'del', 'con', 'sin', 'es', 'son', 'hay', 'que', 'como',
    'cuando', 'donde', 'pero', 'y', 'o', 'también', 'además', 'según', 'nota', 'fuente', 'fuentes', 'paso', 'pasos', 'importante',
    'atención', 'llama', 'llamar', 'después', 'antes', 'primero', 'segundo', 'luego', 'este', 'esta', 'estos', 'estas', 'su', 'sus',
    'the', 'a', 'an', 'if', 'in', 'on', 'of', 'and', 'or', 'but', 'also', 'note', 'source', 'sources', 'step', 'steps', 'call', 'then',
    'first', 'this', 'these', 'it', 'its', 'you', 'your', 'we', 'i', 'he', 'she', 'they',
    'wikipedia', 'nomad', 'pocket', 'internet', 'gps', 'utm', 'osm', 'openstreetmap', 'cruz', 'roja', 'guardia', 'civil', 'protección',
    'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo', 'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday',
    'saturday', 'sunday', 'january', 'february', 'march', 'april', 'june', 'july', 'august', 'september', 'october', 'november',
    'december', 'dios', 'god',
  ].map((w) => normalizeName(w)),
);
const LINKS = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'of', 'the', 'upon', 'on', 'sur', 'sobre', 'd']);

/** Up to `max` place-like names in a text, most mentioned first, each once (accents kept: they go to the index). */
export function placeCandidates(text: string, max = 6): string[] {
  const clean = text.replace(/\[[0-9, –-]+\]/g, ' ').replace(/[*_`#>]/g, ' ');
  const counts = new Map<string, { name: string; n: number; first: number }>();
  // "y" / "and" separate two places ("La Coruña y Las Rozas"), they don't join one.
  const re = /\p{Lu}[\p{L}'’-]+(?:\s+(?:(?:de|del|la|las|los|el|of|the|upon|on|sur|sobre|d['’])\s+)*\p{Lu}[\p{L}'’-]+)*/gu;
  let pos = 0;
  for (const m of clean.matchAll(re)) {
    let words = m[0].split(/\s+/);
    // Drop leading stop words ("En Toledo", "La" at a sentence start keeps "La Coruña" when the next word is a name).
    const capitalLink = (w: string) => LINKS.has(normalizeName(w)) && /^\p{Lu}/u.test(w);
    while (words.length && (NOT_PLACES.has(normalizeName(words[0])) || LINKS.has(normalizeName(words[0]))) && !(words.length > 1 && capitalLink(words[0]))) words = words.slice(1);
    while (words.length && LINKS.has(normalizeName(words[words.length - 1]))) words = words.slice(0, -1);
    if (!words.length || words.length > 5) continue;
    // Every word a non-place ("Cruz Roja", "Guardia Civil").
    if (words.every((w) => NOT_PLACES.has(normalizeName(w)) || LINKS.has(normalizeName(w)))) continue;
    const name = words.join(' ');
    const key = normalizeName(name);
    if (key.length < 3 || NOT_PLACES.has(key)) continue;
    const c = counts.get(key);
    if (c) c.n++;
    else counts.set(key, { name, n: 1, first: pos++ });
  }
  return [...counts.values()]
    .sort((a, b) => b.n - a.n || a.first - b.first)
    .slice(0, max)
    .map((c) => c.name);
}
