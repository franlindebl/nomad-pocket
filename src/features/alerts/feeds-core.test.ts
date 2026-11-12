import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { covers, current, mergeQuakes } from './alerts-core.ts';
import { parseCap } from './cap-core.ts';
import {
  alertOfCap,
  alertsOfAemetBundle,
  parseAemetRss,
  parseEmsc,
  parseGdacs,
  parseMeteoalarmAtom,
  parseNws,
  parseUsgs,
  vtecEvent,
} from './feeds-core.ts';
import { xmlFilesOfTarGz } from './tar-core.ts';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
const json = (name: string) => JSON.parse(fixture(name).toString()) as unknown;
/** A few minutes after the fixtures were downloaded (2026-11-04 ~23:57 CET). */
const NOW = Date.parse('2026-11-04T23:00:00Z');

const CARTAGENA = { lat: 37.6257, lon: -0.9966 };
const MADRID = { lat: 40.4168, lon: -3.7038 };

test("parseAemetRss finds the bundle (the first item) and the warnings' own CAP links", () => {
  const rss = parseAemetRss(fixture('aemet-rss-afae.xml').toString());
  assert.equal(rss.bundleUrl, 'https://www.aemet.es/documentos_d/eltiempo/prediccion/avisos/cap/Z_CAP_C_LEMM_20261104225001_AFAE.tar.gz');
  assert.equal(rss.updated, Date.parse('2026-11-04T22:50:01Z'));
  assert.equal(rss.caps.length, 42);
  const canarias = parseAemetRss(fixture('aemet-rss-afac65.xml').toString());
  assert.match(canarias.bundleUrl ?? '', /\.tar\.gz$/);
});

test("AEMET's bundle: green files dropped, the state current at the time, Cartagena under an orange", () => {
  const all = alertsOfAemetBundle(xmlFilesOfTarGz(fixture('aemet-afae.tar.gz')));
  assert.equal(all.length, 42, 'the 219 files hold 42 warnings; the rest are green');
  assert.equal(all.length, parseAemetRss(fixture('aemet-rss-afae.xml').toString()).caps.length, 'the same warnings the RSS lists');
  const now = current(all, NOW);
  assert.equal(now.length, 21, 'half had already expired');
  assert.deepEqual(
    now.filter((a) => a.level === 'orange').map((a) => a.area),
    ['Valle del Guadalentín, Lorca y Águilas', 'Campo de Cartagena y Mazarrón'],
  );
  assert.equal(new Set(now.map((a) => a.topic)).size, now.length, 'one warning per zone + phenomenon + measure');

  const atCartagena = now.filter((a) => covers(a, { pos: CARTAGENA, country: 'es' }));
  assert.deepEqual(
    atCartagena.map((a) => [a.level, a.hazard, a.topic]),
    [
      ['orange', 'rain', 'aemet:733005:PR.P1'],
      ['yellow', 'rain', 'aemet:733005:PR.P2'],
    ],
  );
  const orange = atCartagena[0];
  assert.equal(orange.source, 'aemet');
  assert.equal(orange.kind, 'weather');
  assert.equal(orange.msgType, 'update');
  assert.equal(orange.original, 'es');
  assert.deepEqual(Object.keys(orange.texts), ['es', 'en']);
  assert.equal(orange.texts.en.headline, 'Severe rain warning. Campo de Cartagena y Mazarrón');
  assert.deepEqual(orange.codes, ['733005']);
  assert.equal(orange.url, 'https://www.aemet.es/es/eltiempo/prediccion/avisos');
  assert.equal(now.filter((a) => covers(a, { pos: MADRID, country: 'es' })).length, 0);
  assert.equal(now.filter((a) => covers(a, { pos: null, country: 'es' })).length, 0, 'no position, nothing covers');
});

test("MeteoAlarm's Atom: one alert per entry, EMMA zone, level from the title, the CAP link", () => {
  const atom = parseMeteoalarmAtom(fixture('meteoalarm-atom-spain.xml').toString());
  assert.equal(atom.length, 8);
  const first = atom[0];
  assert.equal(first.id, '2.49.0.0.724.0.ES.261104171408.611804PRP1050712448');
  assert.equal(first.level, 'yellow');
  assert.equal(first.hazard, 'rain');
  assert.equal(first.area, 'Costa granadina');
  assert.deepEqual(first.codes, ['ES084']);
  assert.equal(first.onset, Date.parse('2026-11-04T23:00:00Z'));
  assert.equal(first.capUrl, 'https://feeds.meteoalarm.org/api/v1/warnings/feeds-spain/dcb30d1a-f186-4eb0-b5b8-ab7e1669ffc4');
  assert.equal(atom[1].msgType, 'update');
  assert.ok(covers(first, { pos: null, country: 'es', codes: ['ES084'] }));
  assert.ok(!covers(first, { pos: null, country: 'es', codes: ['ES072'] }));

  // The entry's CAP: same id and topic, now with both languages and the official texts.
  const cap = alertOfCap(parseCap(fixture('meteoalarm-cap-spain.xml').toString())!, 'meteoalarm')!;
  assert.equal(cap.id, first.id);
  assert.equal(cap.topic, first.topic);
  assert.equal(cap.level, 'yellow');
  assert.equal(cap.original, 'es');
  assert.equal(cap.texts.es.description, 'Precipitación acumulada en una hora: 15 mm.');
  assert.equal(cap.texts.en.event, 'Moderate rain warning');
});

test("MeteoAlarm's Atom: the entries of one CAP over several areas become one alert with every zone", () => {
  const atom = parseMeteoalarmAtom(fixture('meteoalarm-atom-germany.xml').toString());
  assert.equal(atom.length, 4, '24 entries, 4 warnings');
  const wide = atom.find((a) => a.codes!.length === 16)!;
  assert.ok(wide, 'the warning over 16 areas');
  assert.equal(wide.area.split(', ').length, 16);
  assert.equal(wide.topic, `meteoalarm:${[...wide.codes!].sort().join('+')}:${wide.hazard}`);
  assert.equal(new Set(atom.map((a) => a.id)).size, 4);
});

test("MeteoAlarm's Atom: an EMMA region only in the entry's link, or a drawn area, still places the warning", () => {
  const entry = (id: string, inner: string) => `<entry><cap:identifier>${id}</cap:identifier><title>Orange Wind Warning issued for X</title>
    <cap:event>Wind</cap:event><cap:message_type>Alert</cap:message_type><cap:areaDesc>Area ${id}</cap:areaDesc>${inner}</entry>`;
  const xml = `<feed>${entry('F1', '<cap:geocode><valueName>NUTS3</valueName><value>FR718</value></cap:geocode><link href="https://meteoalarm.org?geocode=EMMA_ID:FR035"/>')}
    ${entry('S1', '<cap:polygon>45.5,13.7 45.6,13.7 45.6,13.8 45.5,13.7</cap:polygon>')}</feed>`;
  const [fr, si] = parseMeteoalarmAtom(xml);
  assert.deepEqual(fr.codes, ['FR035']);
  assert.equal(fr.polygons, undefined);
  assert.equal(si.codes, undefined);
  assert.deepEqual(si.polygons, [[13.7, 45.5, 13.7, 45.6, 13.8, 45.6, 13.7, 45.5]]);
});

test('NWS: affected zones keep their type (forecast, county, fire), the UGC codes alone lose it', () => {
  const us = parseNws(JSON.parse(fixture('nws-active-us.json').toString()));
  const statement = us.find((a) => a.zones?.length && a.zones.length > 3)!;
  assert.ok(statement.zones!.every((z) => /^(forecast|county|fire)\/[A-Z]{2}[ZC]\d{3}$/.test(z)));
  assert.deepEqual(
    statement.zones!.map((z) => z.split('/')[1]),
    statement.codes,
  );
  const point = parseNws(JSON.parse(fixture('nws-active-point.json').toString()));
  assert.deepEqual(point[0].zones, ['county/LAC019']);
});

test('alertOfCap: the issuing service (senderName) is kept', () => {
  const cap = alertOfCap(parseCap(fixture('meteoalarm-cap-spain.xml').toString())!, 'meteoalarm')!;
  assert.equal(cap.issuer, 'AEMET. Agencia Estatal de Meteorología');
});

test('alertOfCap: a cancel without a level is kept as a cancel; exercises and green are not warnings', () => {
  const cap = (msgType: string, status = 'Actual', level = '') =>
    parseCap(`<alert><identifier>C1</identifier><status>${status}</status><msgType>${msgType}</msgType>
      <references>s,A1,t</references><info><severity>Unknown</severity>${level}<area><areaDesc>Z</areaDesc></area></info></alert>`)!;
  const cancel = alertOfCap(cap('Cancel'), 'aemet')!;
  assert.equal(cancel.msgType, 'cancel');
  assert.deepEqual(cancel.references, ['A1']);
  assert.equal(alertOfCap(cap('Alert'), 'aemet'), null, 'no level');
  assert.equal(
    alertOfCap(
      cap('Alert', 'Exercise', '<parameter><valueName>AEMET-Meteoalerta nivel</valueName><value>rojo</value></parameter>'),
      'aemet',
    ),
    null,
  );
  assert.equal(
    alertOfCap(
      cap('Alert', 'Actual', '<parameter><valueName>AEMET-Meteoalerta nivel</valueName><value>verde</value></parameter>'),
      'aemet',
    ),
    null,
  );
  assert.equal(
    alertOfCap(cap('Alert', 'Actual', '<parameter><valueName>AEMET-Meteoalerta nivel</valueName><value>rojo</value></parameter>'), 'aemet')
      ?.level,
    'red',
  );
});

test('parseNws: the flood warning at the point asked for, tracked by its VTEC event, lasting until "ends"', () => {
  const [a, ...rest] = parseNws(json('nws-active-point.json'));
  assert.equal(rest.length, 0);
  assert.equal(a.source, 'nws');
  assert.equal(a.level, 'orange', 'severity Severe');
  assert.equal(a.hazard, 'flood');
  assert.equal(a.kind, 'weather');
  assert.equal(a.topic, 'nws:KLCH.FL.W.0047');
  assert.equal(a.area, 'Calcasieu, LA');
  assert.deepEqual(a.codes, ['LAC019']);
  assert.equal(a.expires, Date.parse('2026-11-07T06:00:00-06:00'));
  assert.equal(a.original, 'en');
  assert.match(a.texts.en.instruction, /^Turn around, don't drown/);
  assert.match(a.texts.en.description, /\n\n/, 'paragraphs kept');
  assert.equal(a.polygons?.length, 1);
  assert.ok(covers(a, { pos: null, country: 'us' }), 'NWS answered for the point already');
});

test('parseNws: tsunami warnings are tsunamis; tests and unknown severities are skipped', () => {
  const feature = (event: string, severity: string, status = 'Actual') => ({
    properties: { id: event + status, status, event, severity, messageType: 'Alert', sent: '2026-11-04T10:00:00Z', language: 'en-US' },
  });
  const out = parseNws({
    features: [feature('Tsunami Warning', 'Extreme'), feature('Test Message', 'Unknown'), feature('Tornado Warning', 'Extreme', 'Test')],
  });
  assert.deepEqual(
    out.map((a) => [a.kind, a.hazard, a.level]),
    [['tsunami', 'tsunami', 'red']],
  );
  assert.deepEqual(parseNws({}), []);
  assert.deepEqual(parseNws(null), []);
});

test('vtecEvent', () => {
  assert.equal(vtecEvent('/O.EXT.KLCH.FL.W.0047.000000T0000Z-261107T1200Z/'), 'KLCH.FL.W.0047');
  assert.equal(vtecEvent('/O.NEW.KOUN.TO.W.0012.261104T2200Z-261104T2245Z/'), 'KOUN.TO.W.0012');
  assert.equal(vtecEvent(''), '');
});

test('USGS and EMSC: the same four days of quakes, merged into one list', () => {
  const usgs = parseUsgs(json('usgs-4.5_day.geojson'));
  const emsc = parseEmsc(json('emsc-query.json'));
  assert.equal(usgs.length, 4);
  assert.equal(emsc.length, 4);
  assert.deepEqual(usgs[0], {
    id: 'us7000tw43',
    source: 'usgs',
    kind: 'quake',
    hazard: 'quake',
    level: 'orange',
    msgType: 'alert',
    references: [],
    topic: '',
    sent: 1793827465643,
    onset: 1793827465643,
    expires: 1793827465643 + 24 * 3600_000,
    area: 'south of the Fiji Islands',
    texts: { en: { event: 'Earthquake', headline: 'M 5.0 - south of the Fiji Islands', description: '', instruction: '' } },
    original: 'en',
    point: { lat: -25.3174, lon: 179.8078 },
    mag: 5,
    depthKm: 508.132,
    url: 'https://earthquake.usgs.gov/earthquakes/eventpage/us7000tw43',
  });
  assert.equal(emsc[0].area, 'South Of Fiji Islands');
  assert.equal(emsc[0].depthKm, 508.1, 'EMSC writes depth negative in the geometry, positive in the properties');
  assert.equal(emsc[0].url, 'https://www.seismicportal.eu/eventdetails.html?unid=20261104_0000300');

  // Fiji ×2 and the Philippines/Talaud event are the same in both; Samar (EMSC) and Nicaragua (USGS) are not.
  const merged = mergeQuakes([...emsc, ...usgs]);
  assert.deepEqual(
    merged.map((q) => [q.id, q.references]),
    [
      ['20261104_0000300', ['us7000tw43']],
      ['20261104_0000251', []],
      ['20261104_0000090', ['us7000tvwj']],
      ['20261104_0000002', ['us7000tvuv']],
      ['us7000tw3k', []],
    ],
  );
});

const gdacsItem = (type: string, level: string, iso3: string, extra = '') => `<item>
  <title>${level} ${type} event</title><link>https://www.gdacs.org/report.aspx?eventid=9</link><guid isPermaLink="false">${type}9</guid>
  <pubDate>Wed, 04 Nov 2026 21:42:44 GMT</pubDate><gdacs:datemodified>Wed, 04 Nov 2026 21:42:44 GMT</gdacs:datemodified>
  <gdacs:fromdate>Mon, 02 Nov 2026 00:00:00 GMT</gdacs:fromdate><gdacs:todate>Wed, 04 Nov 2026 12:00:00 GMT</gdacs:todate>
  <geo:Point><geo:lat>23.5</geo:lat><geo:long>90.1</geo:long></geo:Point>
  <gdacs:eventtype>${type}</gdacs:eventtype><gdacs:alertlevel>${level}</gdacs:alertlevel><gdacs:eventid>9</gdacs:eventid>
  <gdacs:episodeid>3</gdacs:episodeid><gdacs:iso3>${iso3}</gdacs:iso3><gdacs:country>Bangladesh</gdacs:country>${extra}</item>`;

test('parseGdacs: Orange and Red events with their countries; Green and earthquakes skipped', () => {
  assert.equal(parseGdacs(fixture('gdacs-rss-24h.xml').toString()).length, 0, 'every item in the sample is Green');
  const rss = `<rss><channel>${gdacsItem('FL', 'Orange', 'BGD, IND')}${gdacsItem('TC', 'Red', 'BGD')}${gdacsItem('EQ', 'Red', 'BGD')}${gdacsItem('FL', 'Green', 'BGD')}</channel></rss>`;
  const out = parseGdacs(rss);
  assert.deepEqual(
    out.map((a) => [a.id, a.hazard, a.level, a.countries]),
    [
      ['FL9-3', 'flood', 'orange', ['bd', 'in']],
      ['TC9-3', 'cyclone', 'red', ['bd']],
    ],
  );
  const flood = out[0];
  assert.equal(flood.kind, 'disaster');
  assert.equal(flood.topic, 'gdacs:FL9');
  assert.equal(flood.onset, Date.parse('2026-11-02T00:00:00Z'));
  assert.equal(flood.expires, Date.parse('2026-11-05T12:00:00Z'), 'a day past the last report');
  assert.deepEqual(flood.point, { lat: 23.5, lon: 90.1 });
  assert.ok(covers(flood, { pos: null, country: 'in' }));
  assert.ok(!covers(flood, { pos: null, country: 'np' }));
});
