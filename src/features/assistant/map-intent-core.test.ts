import assert from 'node:assert/strict';
import test from 'node:test';

import { categoryOf, intentFromModel, mapToolSpec, normalizeQuestion, parseMapIntent, parseMapToolArgs, placeCandidates, type MapIntent } from './map-intent-core.ts';

type Expect = Partial<Record<string, unknown>> & { kind: MapIntent['kind'] };

/** Each phrase → the fields it must have (a subset of the intent). */
const POSITIVE: [string, Expect][] = [
  // nearby: a category near a place
  ['Búscame una farmacia cerca de Móstoles', { kind: 'nearby', kinds: ['pharmacy'], near: { text: 'mostoles' } }],
  ['busca farmacias en Getafe', { kind: 'nearby', kinds: ['pharmacy'], near: { text: 'getafe' } }],
  ['¿Hay alguna farmacia de guardia en Alcorcón?', { kind: 'nearby', kinds: ['pharmacy'], near: { text: 'alcorcon' }, onDuty: true }],
  ['¿Dónde hay un hospital cerca de Toledo?', { kind: 'nearby', kinds: ['hospital'], near: { text: 'toledo' } }],
  ['hospitales en Valencia', { kind: 'nearby', kinds: ['hospital'], near: { text: 'valencia' } }],
  ['¿hay gasolineras por aquí?', { kind: 'nearby', kinds: ['fuel'], near: { here: true } }],
  ['farmacia', { kind: 'nearby', kinds: ['pharmacy'], near: { here: true } }],
  ['farmacias cerca', { kind: 'nearby', kinds: ['pharmacy'], near: { here: true } }],
  ['la farmacia más cercana', { kind: 'nearby', kinds: ['pharmacy'], near: { here: true } }],
  ['¿Dónde está la farmacia más cercana?', { kind: 'nearby', kinds: ['pharmacy'], near: { here: true } }],
  ['farmacia abierta ahora', { kind: 'nearby', kinds: ['pharmacy'], near: { here: true }, open: true }],
  ['necesito una farmacia', { kind: 'nearby', kinds: ['pharmacy'], near: { here: true } }],
  ['necesito agua', { kind: 'nearby', kinds: ['drinking_water'], near: { here: true } }],
  ['¿dónde puedo comprar ibuprofeno en Móstoles?', { kind: 'nearby', kinds: ['pharmacy'], near: { text: 'mostoles' } }],
  ['¿Dónde puedo repostar cerca de Burgos?', { kind: 'nearby', kinds: ['fuel'], near: { text: 'burgos' } }],
  ['comisaría más cercana', { kind: 'nearby', kinds: ['police'], near: { here: true } }],
  ['¿Dónde hay un centro de salud en Leganés?', { kind: 'nearby', kinds: ['clinic'], near: { text: 'leganes' } }],
  ['centros de salud cerca de mí', { kind: 'nearby', kinds: ['clinic'], near: { here: true } }],
  ['¿Hay fuentes de agua en el Retiro?', { kind: 'nearby', kinds: ['drinking_water'], near: { text: 'el retiro' } }],
  ['busca un supermercado cerca del Retiro', { kind: 'nearby', kinds: ['supermarket'], near: { text: 'el retiro' } }],
  ['necesito agua y un sitio donde dormir', { kind: 'nearby', kinds: ['drinking_water', 'shelter'], near: { here: true } }],
  ['busca agua potable y refugio cerca de Navacerrada', { kind: 'nearby', kinds: ['drinking_water', 'shelter'], near: { text: 'navacerrada' } }],
  ['¿Dónde está el desfibrilador más cercano?', { kind: 'nearby', kinds: ['defibrillator'], near: { here: true } }],
  ['desfibrilador cerca', { kind: 'nearby', kinds: ['defibrillator'], near: { here: true } }],
  ['¿Dónde está la embajada de España?', { kind: 'nearby', kinds: ['embassy'], name: 'espana', near: { here: true } }],
  ['embajada de España en París', { kind: 'nearby', kinds: ['embassy'], name: 'espana', near: { text: 'paris' } }],
  ['¿Hay un cuartel de la guardia civil en Navalcarnero?', { kind: 'nearby', kinds: ['police'], near: { text: 'navalcarnero' } }],
  ['ayuntamiento de aquí', { kind: 'nearby', kinds: ['townhall'], near: { here: true } }],
  ['bomberos cerca de Fuenlabrada', { kind: 'nearby', kinds: ['fire_station'], near: { text: 'fuenlabrada' } }],
  ['pharmacy near me', { kind: 'nearby', kinds: ['pharmacy'], near: { here: true } }],
  ['find a hospital near Madrid', { kind: 'nearby', kinds: ['hospital'], near: { text: 'madrid' } }],
  ['Where is the nearest gas station?', { kind: 'nearby', kinds: ['fuel'], near: { here: true } }],
  ['is there a supermarket around here', { kind: 'nearby', kinds: ['supermarket'], near: { here: true } }],
  ['I need drinking water', { kind: 'nearby', kinds: ['drinking_water'], near: { here: true } }],
  ['police station in Seville', { kind: 'nearby', kinds: ['police'], near: { text: 'seville' } }],
  ['Oye, ¿me puedes buscar una ferretería en Alcalá de Henares, por favor?', { kind: 'nearby', kinds: ['hardware'], near: { text: 'alcala de henares' } }],
  ['farmacias en Las Rozas', { kind: 'nearby', kinds: ['pharmacy'], near: { text: 'las rozas' } }],
  ['busca una farmacia en la calle Mayor 12', { kind: 'nearby', kinds: ['pharmacy'], near: { text: 'la calle mayor 12' } }],

  // goNearest
  ['Llévame al hospital más cercano', { kind: 'goNearest', kinds: ['hospital'], from: { here: true } }],
  ['llévame a la gasolinera más cercana', { kind: 'goNearest', kinds: ['fuel'] }],
  ['llévame a una farmacia', { kind: 'goNearest', kinds: ['pharmacy'] }],
  ['¿Cómo llego andando al centro de salud más cercano?', { kind: 'goNearest', kinds: ['clinic'], costing: 'pedestrian' }],
  ['necesito ir al hospital', { kind: 'goNearest', kinds: ['hospital'] }],
  ['take me to the nearest hospital', { kind: 'goNearest', kinds: ['hospital'] }],
  ['walk me to the closest pharmacy', { kind: 'goNearest', kinds: ['pharmacy'], costing: 'pedestrian' }],
  ['¿Cómo voy en coche a urgencias?', { kind: 'goNearest', kinds: ['hospital'], costing: 'auto' }],

  // route
  ['¿Cómo voy de Móstoles a Alcorcón?', { kind: 'route', from: { text: 'mostoles' }, to: { text: 'alcorcon' }, askOnly: false, strong: true }],
  ['¿Cómo llego a Toledo?', { kind: 'route', from: { here: true }, to: { text: 'toledo' }, strong: true }],
  ['llévame a la Calle Mayor 12', { kind: 'route', to: { text: 'la calle mayor 12' } }],
  ['llévame a la calle Doctor Esquerdo', { kind: 'route', to: { text: 'la calle doctor esquerdo' } }],
  ['ruta a pie de Sol a Atocha', { kind: 'route', from: { text: 'sol' }, to: { text: 'atocha' }, costing: 'pedestrian' }],
  ['¿Cómo se va desde Villanueva de la Cañada a Móstoles en bici?', { kind: 'route', from: { text: 'villanueva de la canada' }, to: { text: 'mostoles' }, costing: 'bicycle' }],
  ['llévame a casa', { kind: 'route', to: { text: 'casa' } }],
  ['llévame al coche', { kind: 'route', to: { text: 'el coche' } }],
  ['take me home', { kind: 'route', to: { text: 'home' } }],
  ['How do I get from Madrid to Toledo?', { kind: 'route', from: { text: 'madrid' }, to: { text: 'toledo' } }],
  ['Llévame a 40.3218, -3.8650', { kind: 'route', to: { coords: { lat: 40.3218, lon: -3.865 } } }],
  ['¿Cuánto tardo andando a Arroyomolinos?', { kind: 'route', to: { text: 'arroyomolinos' }, askOnly: true, costing: 'pedestrian' }],
  ['¿Cuánto hay de Madrid a Toledo?', { kind: 'route', from: { text: 'madrid' }, to: { text: 'toledo' }, askOnly: true }],
  ['¿A qué distancia está Segovia?', { kind: 'route', to: { text: 'segovia' }, askOnly: true }],
  ['¿a qué distancia estoy de Segovia?', { kind: 'route', to: { text: 'segovia' }, askOnly: true }],
  ['how long does it take to walk to Getafe', { kind: 'route', to: { text: 'getafe' }, askOnly: true, costing: 'pedestrian' }],
  ['how far is Toledo', { kind: 'route', to: { text: 'toledo' }, askOnly: true }],

  ['¿Qué tan lejos queda Toledo desde Madrid?', { kind: 'route', from: { text: 'madrid' }, to: { text: 'toledo' }, askOnly: true }],
  ['Dime cómo llegar a Valdemoro desde aquí', { kind: 'route', from: { here: true }, to: { text: 'valdemoro' } }],
  ['Estoy en Aranjuez, ¿dónde queda la comisaría?', { kind: 'nearby', kinds: ['police'], near: { text: 'aranjuez' } }],

  // whereAmI
  ['¿Dónde estoy?', { kind: 'whereAmI', forCall: false }],
  ['dime mi ubicación', { kind: 'whereAmI', forCall: false }],
  ['¿En qué calle estoy?', { kind: 'whereAmI', forCall: false }],
  ['¿Cuál es mi dirección actual?', { kind: 'whereAmI' }],
  ['mis coordenadas', { kind: 'whereAmI' }],
  ['where am I', { kind: 'whereAmI' }],
  ['¿Qué le digo al 112?', { kind: 'whereAmI', forCall: true }],
  ['¿Cómo le explico al 112 dónde estoy?', { kind: 'whereAmI', forCall: true }],
  ['what do I tell 911', { kind: 'whereAmI', forCall: true }],

  // shareLocation
  ['Manda mi ubicación por SMS', { kind: 'shareLocation' }],
  ['comparte mi ubicación', { kind: 'shareLocation' }],
  ['envía mi ubicación a mamá', { kind: 'shareLocation', to: 'mama' }],
  ['mándale mi ubicación a mi hermano por whatsapp', { kind: 'shareLocation', to: 'hermano' }],
  ['send my location to John', { kind: 'shareLocation', to: 'john' }],

  // calls
  ['Llama a la comisaría más cercana', { kind: 'call', kinds: ['police'], near: { here: true } }],
  ['teléfono de la farmacia más cercana', { kind: 'call', kinds: ['pharmacy'] }],
  ['llama al hospital de Móstoles', { kind: 'call', kinds: ['hospital'], near: { text: 'mostoles' } }],
  ['llama a una ambulancia', { kind: 'callEmergency' }],
  ['llama al 112', { kind: 'callEmergency' }],
  ['llama a la policía', { kind: 'callEmergency' }],
  ['call an ambulance', { kind: 'callEmergency' }],
  ['¿Cuál es el número de emergencias?', { kind: 'callEmergency' }],
  ['emergency number', { kind: 'callEmergency' }],

  // phase 2
  ['Guarda dónde estoy como el coche', { kind: 'saveHere', name: 'el coche' }],
  ['save this place as camp', { kind: 'saveHere', name: 'camp' }],
  ['¿Dónde he aparcado?', { kind: 'saved' }],
  ['where did I park', { kind: 'saved' }],
  ['¿Dónde quedamos si nos separamos?', { kind: 'meetingPoint', go: false }],
  ['¿Cuál es nuestro punto de encuentro?', { kind: 'meetingPoint', go: false }],
  ['Llévame al punto de encuentro', { kind: 'meetingPoint', go: true }],
  ['Where do we meet if we get separated?', { kind: 'meetingPoint' }],
  ['Estoy perdido', { kind: 'lost' }],
  ['Creo que me he perdido en el monte', { kind: 'lost' }],
  ['¿Hacia dónde está el pueblo más cercano?', { kind: 'lost' }],
  ["I'm lost", { kind: 'lost' }],
  ['¿A qué hora anochece?', { kind: 'sun' }],
  ['¿Cuánta luz me queda?', { kind: 'sun' }],
  ['¿Llego andando a Cercedilla antes de que anochezca?', { kind: 'sun', to: { text: 'cercedilla' }, costing: 'pedestrian' }],
  ['¿Me da tiempo a llegar a Navacerrada antes de que se haga de noche?', { kind: 'sun', to: { text: 'navacerrada' } }],
  ['Can I make it to Cercedilla before dark?', { kind: 'sun', to: { text: 'cercedilla' } }],
  ['¿Hay alertas cerca?', { kind: 'alerts', quakes: false, place: { here: true } }],
  ['¿Hay avisos oficiales?', { kind: 'alerts' }],
  ['¿Qué avisos hay en Valencia?', { kind: 'alerts', place: { text: 'valencia' } }],
  ['¿Ha habido terremotos por aquí?', { kind: 'alerts', quakes: true }],
  ['any alerts near me', { kind: 'alerts' }],
  ['¿Qué coordenadas tiene Móstoles?', { kind: 'whereIs', coords: true, place: { text: 'mostoles' } }],
  ['Pásame mis coordenadas a UTM', { kind: 'whereAmI' }],
  ['Llévame a 30T 430500 4466200', { kind: 'route' }],

  // phase 3
  ['Gasolineras de camino a Valencia', { kind: 'alongRoute', kinds: ['fuel'], to: { text: 'valencia' } }],
  ['¿Hay agua potable en el camino a Cercedilla?', { kind: 'alongRoute', kinds: ['drinking_water'], to: { text: 'cercedilla' } }],
  ['farmacias en la ruta', { kind: 'alongRoute', kinds: ['pharmacy'] }],
  ['¿Me da la gasolina para llegar a Valencia? Me quedan 80 km', { kind: 'alongRoute', kinds: ['fuel'], to: { text: 'valencia' }, rangeKm: 80 }],
  ['Tengo 60 km de autonomía, ¿dónde reposto?', { kind: 'alongRoute', kinds: ['fuel'], rangeKm: 60 }],
  ['petrol stations on the way to Toledo', { kind: 'alongRoute', kinds: ['fuel'], to: { text: 'toledo' } }],
  ['¿El aviso rojo afecta a mi ruta?', { kind: 'routeAlerts' }],
  ['¿Hay avisos de camino a Valencia?', { kind: 'routeAlerts', to: { text: 'valencia' } }],
  ['Tengo que salir de la zona del aviso', { kind: 'evacuate' }],
  ['¿Cómo salgo de la zona inundada?', { kind: 'evacuate' }],
  ['Me voy de viaje a Marruecos, ¿qué necesito?', { kind: 'trip', place: 'marruecos' }],
  ['Viajo a Portugal la semana que viene', { kind: 'trip', place: 'portugal' }],
  ["I'm travelling to France next week", { kind: 'trip', place: 'france' }],
  ['Me voy a Qatar', { kind: 'trip', place: 'qatar' }],
  ['¿Qué es este pueblo?', { kind: 'aboutHere' }],
  ['Háblame de este sitio', { kind: 'aboutHere' }],
  ['what is this town', { kind: 'aboutHere' }],

  // whereIs (weak)
  ['¿Dónde está Móstoles?', { kind: 'whereIs', place: { text: 'mostoles' }, strong: false }],
  ['where is Toledo', { kind: 'whereIs', place: { text: 'toledo' } }],
  // Weak: answered only when the index really has that place (else the library answers).
  ['¿Dónde está el páncreas?', { kind: 'whereIs', strong: false }],
];

/** Not map questions (or not clearly): the library and the model answer them. */
const NEGATIVE: string[] = [
  '¿Qué es una farmacia de guardia?',
  '¿Cómo purifico agua en el monte?',
  'historia de los hospitales de campaña',
  '¿Cuántas farmacias hay en España?',
  '¿Por qué los hospitales tienen generadores?',
  '¿Cómo se trata una quemadura?',
  'Hay una fuga de gas en mi casa',
  'hay un incendio cerca de mi casa',
  '¿Qué hago si me duele el pecho?',
  'explícame cómo funciona un desfibrilador',
  'tipos de refugio de supervivencia',
  '¿Cómo construyo un refugio?',
  'hola',
  'gracias',
  '¿Quién eres?',
  'Resume la respuesta anterior',
  'el hospital en el que nació Cervantes',
  'ruta de la plata',
  'ruta del Cares',
  '¿Cuánto falta para el invierno?',
  'what is a pharmacy',
  'how do I treat hypothermia',
  'history of police stations',
  'water purification methods',
  'spring water vs tap water',
  '¿Cómo llego a ser bombero?',
  'llama a mamá',
  '¿Cuánto es 2 + 2?',
  'busca información sobre la peste negra en Europa',
  '¿Cómo llego?',
  'llévame ahí',
  '¿Cuál es el número de emergencias en Japón?',
  'necesito agua potable, ¿cómo la consigo?',
  '¿Qué es una alerta roja?',
  '¿Qué hago si me pierdo en el monte?',
  'Se ha perdido mi hijo en la playa',
  '¿Por qué anochece antes en invierno?',
  '¿Qué es un terremoto?',
  'guarda la conversación',
  '¿Qué es un punto de encuentro?',
  'me voy a dormir',
  '¿Qué es el camino de Santiago?',
  'historia de la ruta de la seda',
  '¿Cuántos kilómetros tiene una maratón?',
];

function subset(actual: unknown, expected: Record<string, unknown>): boolean {
  if (!actual || typeof actual !== 'object') return false;
  return Object.entries(expected).every(([k, v]) => {
    const a = (actual as Record<string, unknown>)[k];
    return typeof v === 'object' && v !== null ? JSON.stringify(a) === JSON.stringify(v) || subset(a, v as Record<string, unknown>) : a === v;
  });
}

test('map questions are recognised with what they ask', () => {
  const failures: string[] = [];
  for (const [phrase, expected] of POSITIVE) {
    const got = parseMapIntent(phrase);
    if (!subset(got, expected)) failures.push(`${phrase}\n    want ${JSON.stringify(expected)}\n    got  ${JSON.stringify(got)}`);
  }
  assert.equal(failures.length, 0, `\n${failures.join('\n')}`);
});

test('other questions are left to the library and the model', () => {
  const failures = NEGATIVE.map((p) => [p, parseMapIntent(p)] as const).filter(([, got]) => got !== null);
  assert.equal(failures.length, 0, `\n${failures.map(([p, got]) => `${p} → ${JSON.stringify(got)}`).join('\n')}`);
});

test('follow-ups use the previous map answer', () => {
  const previous = { kinds: ['pharmacy'], count: 5 };
  assert.deepEqual(parseMapIntent('¿y en Getafe?', previous), { kind: 'nearby', kinds: ['pharmacy'], near: { text: 'getafe' }, strong: false });
  assert.deepEqual(parseMapIntent('¿Cómo llego?', previous), { kind: 'route', from: { here: true }, to: { previous: 0 }, askOnly: false, strong: true });
  assert.ok(subset(parseMapIntent('llévame a la segunda', previous), { kind: 'route', to: { previous: 1 } }));
  assert.ok(subset(parseMapIntent('llévame ahí', previous), { kind: 'route', to: { previous: 0 } }));
  assert.ok(subset(parseMapIntent('take me to the last one', previous), { kind: 'route', to: { previous: -1 } }));
  assert.ok(subset(parseMapIntent('¿cuánto tardo andando a la tercera?', previous), { kind: 'route', to: { previous: 2 }, askOnly: true, costing: 'pedestrian' }));
  // Without a previous answer there is nothing to go to.
  assert.equal(parseMapIntent('¿y en Getafe?'), null);
});

test('normalizeQuestion keeps coordinates and drops politeness', () => {
  assert.equal(normalizeQuestion('¿Me puedes decir, por favor, dónde estoy?'), 'decir por favor donde estoy');
  assert.equal(normalizeQuestion('Llévame a 40.32, -3.86 por favor'), 'llevame a 40.32 -3.86');
  assert.equal(normalizeQuestion('Oye, ¿dónde estoy?'), 'donde estoy');
});

test('categoryOf names a whole category only', () => {
  assert.deepEqual(categoryOf('la farmacia mas cercana'), ['pharmacy']);
  assert.deepEqual(categoryOf('una gasolinera'), ['fuel']);
  assert.equal(categoryOf('la calle doctor esquerdo'), null);
  assert.equal(categoryOf('casa'), null);
});

test('a model map call becomes an intent only when it names something the map knows', () => {
  // A town the model wrote is weak: if the index doesn't have it, the library answers.
  assert.deepEqual(intentFromModel({ action: 'nearby', category: 'gasolinera', place: 'Ávila' }), {
    kind: 'nearby',
    kinds: ['fuel'],
    near: { text: 'avila' },
    strong: false,
  });
  assert.deepEqual(intentFromModel({ action: 'nearby', category: 'drinking_water', place: '' }), { kind: 'nearby', kinds: ['drinking_water'], near: { here: true }, strong: true });
  assert.ok(subset(intentFromModel({ action: 'nearby', category: 'petrol station', place: 'my location' }), { kinds: ['fuel'], near: { here: true } }));
  assert.ok(subset(intentFromModel({ action: 'go_nearest', category: 'centro de salud', place: 'Leganés', mode: 'walk' }), { kind: 'goNearest', kinds: ['clinic'], costing: 'pedestrian' }));
  assert.ok(subset(intentFromModel({ action: 'route', place: 'Madrid', destination: 'Toledo', mode: 'car' }), { kind: 'route', from: { text: 'madrid' }, to: { text: 'toledo' }, costing: 'auto' }));
  assert.ok(subset(intentFromModel({ action: 'route', destination: 'el hospital más cercano' }), { kind: 'goNearest', kinds: ['hospital'] }));
  assert.deepEqual(intentFromModel({ action: 'where_am_i' }), { kind: 'whereAmI', forCall: false, strong: true });
  // Kinds the map doesn't hold, or a route with nowhere to go: not a map answer.
  assert.equal(intentFromModel({ action: 'nearby', category: 'panadería', place: 'Ávila' }), null);
  assert.equal(intentFromModel({ action: 'route', place: 'Madrid' }), null);
  assert.equal(intentFromModel({ action: 'translate' }), null);
  // A model's misspelling, a kind near a place as a destination.
  assert.ok(subset(intentFromModel({ action: 'nearby', category: 'embasía', place: 'Lisboa' }), { kinds: ['embassy'] }));
  assert.ok(subset(intentFromModel({ action: 'nearby', category: 'pilas y linterna', place: 'Parla' }), { kinds: ['hardware', 'supermarket'] }));
  assert.ok(subset(intentFromModel({ action: 'route', destination: 'ayuntamiento de Getafe' }), { kind: 'nearby', kinds: ['townhall'], near: { text: 'getafe' } }));
});

test('a model map call needs the question to name what is wanted', () => {
  // Apple's router on the bench: a town from its instructions' examples, the wrong kind, no place asked for.
  assert.equal(intentFromModel({ action: 'nearby', category: 'centro de salud', place: 'Leganés' }, 'Me ha dado un calambrazo al tocar el cuadro eléctrico, ¿tengo que ir al médico?'), null);
  assert.equal(intentFromModel({ action: 'nearby', category: 'refugio' }, 'Vivo en un bajo y está entrando el agua por la puerta, ¿qué hago ya?'), null);
  assert.equal(intentFromModel({ action: 'where_am_i' }, 'Están sonando las sirenas, ¿qué hago ahora mismo?'), null);
  // "Comarcal" is in the question: weak, so a town that doesn't exist sends it to the library.
  assert.ok(subset(intentFromModel({ action: 'nearby', category: 'gasolinera', place: 'comarcal' }, 'Me he quedado sin gasolina en una carretera comarcal y no hay cobertura, ¿qué hago?'), { strong: false }));
  // Crisis questions the model sent to the map on the bench: the guide answers them.
  assert.equal(intentFromModel({ action: 'nearby', category: 'refugio' }, 'Huele a humo en la escalera, ¿salgo o me quedo en casa?'), null);
  assert.equal(intentFromModel({ action: 'nearby', category: 'policía' }, 'Un hombre me sigue por la calle de noche, tengo miedo'), null);
  assert.equal(intentFromModel({ action: 'nearby', category: 'policía', place: 'playa' }, 'Mi hijo se ha perdido en la playa, ayuda'), null);
  // Places the maps don't know: a weak route, the library answers instead.
  assert.ok(subset(intentFromModel({ action: 'route', place: 'trabajo', destination: 'casa' }, 'Se ha ido la luz y estoy en el trabajo. ¿Cómo vuelvo a casa sin metro?'), { kind: 'route', strong: false }));
  // Named by what it is for.
  assert.ok(subset(intentFromModel({ action: 'nearby', category: 'farmacia', place: 'Pinto' }, 'Mi hija tiene fiebre y no tengo paracetamol, ¿hay algún sitio abierto en Pinto?'), { kinds: ['pharmacy'] }));
  assert.ok(subset(intentFromModel({ action: 'nearby', category: 'policía', place: 'Fuenlabrada' }, 'Me han robado la cartera en Fuenlabrada, ¿dónde denuncio?'), { kinds: ['police'] }));
  assert.ok(subset(intentFromModel({ action: 'nearby', category: 'gasolinera', place: 'Ávila' }, 'Se me está acabando la gasolina y estoy cerca de Ávila'), { kinds: ['fuel'] }));
});

test('search_map arguments are read leniently', () => {
  assert.deepEqual(parseMapToolArgs('{"action":"nearby","category":"farmacia","place":"Getafe"}'), {
    action: 'nearby',
    category: 'farmacia',
    place: 'Getafe',
    destination: undefined,
    mode: undefined,
  });
  assert.deepEqual(parseMapToolArgs('not json'), {});
  assert.equal(mapToolSpec('es').function.name, 'search_map');
});

test('place-like names in an answer, for map chips', () => {
  assert.deepEqual(placeCandidates('Móstoles es un municipio al suroeste de Madrid, cerca de Alcorcón. Móstoles tiene hospital [1].'), ['Móstoles', 'Madrid', 'Alcorcón']);
  assert.deepEqual(placeCandidates('San Lorenzo de El Escorial está en la sierra. En Alcalá de Henares nació Cervantes.').slice(0, 2), ['San Lorenzo de El Escorial', 'Alcalá de Henares']);
  assert.deepEqual(placeCandidates('**Importante:** llama al 112. Según la Cruz Roja, el lunes...'), []);
  assert.deepEqual(placeCandidates('La Coruña y Las Rozas'), ['La Coruña', 'Las Rozas']);
});
