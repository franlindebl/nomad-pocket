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
  | { kind: 'whereIs'; place: PlaceRef; strong: false };

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
  /^(?:donde estoy|donde estamos|donde me encuentro|donde nos encontramos|en que (?:calle|sitio|lugar|pueblo|ciudad|zona|direccion|parte|barrio) (?:estoy|estamos|me encuentro)|cual es mi (?:ubicacion|direccion|posicion|localizacion)(?: actual)?|(?:dame |dime )?mi (?:ubicacion|direccion|posicion|localizacion)(?: actual)?|dime donde estoy|(?:dame |dime |cuales son )?mis coordenadas(?: actuales)?|(?:en )?que coordenadas tengo|where am i|where are we|what s my (?:location|address|position)|what is my (?:location|address|position)|(?:give me |tell me )?my (?:current )?(?:location|address|position|coordinates)|tell me where i am|what are my coordinates)$/;

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
  /^(?:como (?:voy|llego|puedo ir|puedo llegar|podemos ir|podemos llegar|se va|se llega|ir|llegar|vuelvo|regreso)|llevame|lleveme|llevanos|guiame|guianos|navega|navegar|quiero ir|queremos ir|tengo que ir|tenemos que ir|necesito ir|necesito llegar|necesitamos ir|ruta(?: para ir)?|indicaciones(?: para ir)?|take me|take us|navigate|directions|route|how (?:do|can) (?:i|we) (?:get|go)|how to get|get me|drive me|walk me|guide me|i need to get|i need to go|we need to go|i want to go)\b\s*(.*)$/;
/** Route verbs that leave no doubt (a failed lookup gets a card); "ruta", "tengo que ir" may be something else. */
const STRONG_ROUTE = /^(?:como (?:voy|llego|puedo ir|puedo llegar|podemos ir|podemos llegar|se va|se llega|vuelvo|regreso)|llevame|lleveme|llevanos|guiame|guianos|navega|take me|take us|navigate|directions|how (?:do|can) (?:i|we) (?:get|go)|how to get|drive me|walk me|guide me)\b/;

const ASK_FRAME =
  /^(?:cuanto (?:tardo|tardaria|tardariamos|tardamos|se tarda|tiempo (?:tardo|se tarda|hay|es|tardaria)|hay|queda|falta|me queda|me falta|nos queda|nos falta)|a que distancia (?:esta|queda|estoy|estamos)|que distancia hay|how long(?: does it take| will it take| would it take)?(?: to (?:get|go|walk|drive|cycle))?|how far(?: away)?(?: is it| is)?)\b\s*(.*)$/;

const FROM_TO = /^(desde|de|del|from) (.+?) (a|al|hasta|hacia|para|to) (.+)$/;
const TO_ONLY = /^(?:a|al|hasta|hacia|para|to|towards) (.+)$/;
const ASK_TO_ONLY = /^(?:a|al|hasta|hacia|to|towards) (.+)$/;
/** "¿Cómo llego a ser bombero?": a verb, not a place. */
const VERB_START = /^(?:ser|estar|tener|hacer|conseguir|saber|aprender|ganar|trabajar|vivir|dormir|comer|be|become|have|make|get better)\b/;
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

/**
 * What a message asks of the map, or null when it isn't a map question (or isn't clearly one).
 * `previous`: the conversation's last map answer, for follow-ups.
 */
export function parseMapIntent(text: string, previous: PreviousMap | null = null): MapIntent | null {
  const s = normalizeQuestion(text);
  if (!s || s.length > 160) return null;

  if (FOR_CALL.test(s)) return { kind: 'whereAmI', forCall: true, strong: true };
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

  const where = s.match(/^(?:donde (?:esta|queda|cae)|where is|where s|ubicame|muestrame|ensename|show me) (.+)$/);
  if (where && !KNOWLEDGE.test(s)) {
    const place = placeRef(where[1]);
    if (place && !('here' in place) && !('previous' in place)) return { kind: 'whereIs', place, strong: false };
  }
  return null;
}
