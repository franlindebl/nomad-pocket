import assert from 'node:assert/strict';
import test from 'node:test';

import { categoryOf, normalizeQuestion, parseMapIntent, type MapIntent } from './map-intent-core.ts';

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
  'gasolineras de camino a Valencia',
  '¿Cómo llego?',
  'llévame ahí',
  '¿Cuál es el número de emergencias en Japón?',
  'necesito agua potable, ¿cómo la consigo?',
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
