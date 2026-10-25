import assert from 'node:assert/strict';
import { test } from 'node:test';

import { emergencyKind, kindCategory, overpassQuery, parseOverpassTsv, policeForce, splitBBox, tileEmergencyKind } from './emergency-core.ts';

// Real Overpass answer for central Soria (columns as in overpassQuery).
const SORIA = [
  'node\t257478045\t41.7652784\t-2.4610439\tpolice\t\t\t\t\t\t\tPolicía Municipal\t\t\t\t\t',
  'node\t354589202\t41.7653502\t-2.4791588\tpolice\t\t\t\t\t\t\tGuardia Civil\tGuardia Civil\t\t\t\t',
  'way\t1123417877\t41.7623158\t-2.4821260\thospital\thospital\tno\t\t\t\t\tHospital Latorre\t\t+34 975 950 450\t\t\t',
  'relation\t2609862\t41.7718024\t-2.4714023\thospital\thospital\tyes\t\t\t\t\tHospital Santa Bárbara\t\t\t\t24/7\t',
  'node\t348773400\t41.7644862\t-2.4761151\tdrinking_water\t\t\t\t\t\t\t\t\t\t\t\t',
  'node\t354601827\t41.7578048\t-2.4742108\t\t\t\t\t\tsupermarket\t\tMercadona\t\t\t\t\t',
  // Melilla: Overpass CSV-quotes values that contain quotes.
  'way\t304513573\t35.30\t-2.95\t\t\t\tbarracks\t\t\t\t"Acuartelamiento ""Capitán Federico de la Paz Orduña"""\t\t\t\t\t',
  'node\t1\t41.7\t-2.4\twater_point\t\t\t\t\t\t\t\t\t\t\t\tno',
  'node\t2\t41.7\t-2.4\tbench\t\t\t\t\t\t\t\t\t\t\t\t',
  'garbage line',
  '',
].join('\n');

test('parseOverpassTsv keeps emergency kinds with their details', () => {
  const pois = parseOverpassTsv(SORIA);
  assert.deepEqual(
    pois.map((p) => [p.osmId, p.kind]),
    [
      ['n257478045', 'police'],
      ['n354589202', 'police'],
      ['w1123417877', 'hospital'],
      ['r2609862', 'hospital'],
      ['n348773400', 'drinking_water'],
      ['n354601827', 'supermarket'],
      ['w304513573', 'military'],
    ],
  );
  assert.equal(pois.find((p) => p.kind === 'military')!.name, 'Acuartelamiento "Capitán Federico de la Paz Orduña"');
  const santaBarbara = pois.find((p) => p.osmId === 'r2609862')!;
  assert.equal(santaBarbara.name, 'Hospital Santa Bárbara');
  assert.equal(santaBarbara.emergency, 1);
  assert.equal(santaBarbara.openingHours, '24/7');
  assert.equal(santaBarbara.lat, 41.7718024);
  const latorre = pois.find((p) => p.osmId === 'w1123417877')!;
  assert.equal(latorre.emergency, 0);
  assert.equal(latorre.phone, '+34 975 950 450');
  assert.equal(pois.find((p) => p.kind === 'drinking_water')!.name, null);
});

test('emergencyKind and categories', () => {
  assert.equal(emergencyKind({ healthcare: 'hospital' }), 'hospital');
  assert.equal(emergencyKind({ amenity: 'doctors' }), 'clinic');
  assert.equal(emergencyKind({ military: 'barracks', landuse: 'military' }), 'military');
  assert.equal(emergencyKind({ office: 'diplomatic' }), 'embassy');
  assert.equal(emergencyKind({ shop: 'doityourself' }), 'hardware');
  assert.equal(emergencyKind({ amenity: 'restaurant' }), null);
  assert.equal(kindCategory('fire_station'), 'security');
  assert.equal(kindCategory('spring'), 'water');
});

test('policeForce', () => {
  assert.equal(policeForce('Guardia Civil'), 'guardiaCivil');
  assert.equal(policeForce('Cuerpo Nacional de Policía'), 'nacional');
  assert.equal(policeForce('Policía Municipal'), 'local');
  assert.equal(policeForce('Mossos d’Esquadra'), 'autonomica');
  assert.equal(policeForce('Metropolitan Police'), null);
  assert.equal(policeForce(null), null);
});

test('overpassQuery uses south,west,north,east and quotes namespaced tags', () => {
  const q = overpassQuery([-4.58, 39.88, -3.05, 41.17], 90);
  assert.match(q, /\[bbox:39\.88,-4\.58,41\.17,-3\.05\]/);
  assert.match(q, /\[timeout:90\]/);
  assert.match(q, /"contact:phone"/);
  assert.match(q, /out center;$/);
});

test('splitBBox covers the box with small cells', () => {
  const spain: [number, number, number, number] = [-9.4, 35.9, 4.4, 43.8];
  const cells = splitBBox(spain, 3);
  assert.equal(cells.length, 5 * 3);
  for (const [w, s, e, n] of cells) {
    assert.ok(e - w <= 3 && n - s <= 3);
  }
  assert.deepEqual(cells[0].slice(0, 2), [-9.4, 35.9]);
  assert.deepEqual(cells[cells.length - 1].slice(2), [4.4, 43.8]);
  assert.equal(splitBBox([0, 0, 1, 1]).length, 1);
});

test('tileEmergencyKind maps Protomaps POI kinds', () => {
  assert.equal(tileEmergencyKind('hospital'), 'hospital');
  assert.equal(tileEmergencyKind('doctors'), 'clinic');
  assert.equal(tileEmergencyKind('doityourself'), 'hardware');
  assert.equal(tileEmergencyKind('defibrillator'), 'defibrillator');
  assert.equal(tileEmergencyKind('military'), 'military');
  assert.equal(tileEmergencyKind('spring'), 'spring');
  assert.equal(tileEmergencyKind('restaurant'), null);
});
