import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { attrs, blocks, parseCap, parsePolygon, parseReferences, parseTime, text, without, xmlText } from './cap-core.ts';
import { xmlFilesOfTarGz } from './tar-core.ts';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
const aemet = xmlFilesOfTarGz(fixture('aemet-afae.tar.gz'));
const aemetFile = (zoneAndPhenomenon: string) => aemet.find((f) => f.name.includes(zoneAndPhenomenon))!.xml;

test('parseCap reads an AEMET orange warning: head, both languages, level, area with polygon and zone', () => {
  const cap = parseCap(aemetFile('20261104094648_AFAZ733005PRP10505'))!;
  assert.equal(cap.identifier, '2.49.0.0.724.0.ES.20261104094648.733005PRP105051793785608');
  assert.equal(cap.sender, 'http://www.aemet.es');
  assert.equal(cap.status, 'Actual');
  assert.equal(cap.msgType, 'Update');
  assert.equal(cap.sent, Date.parse('2026-11-04T09:46:48Z'));
  assert.deepEqual(cap.references, [
    '2.49.0.0.724.0.ES.20261103103341.733005PRP104231793702021',
    '2.49.0.0.724.0.ES.20261103103535.733005PRP105021793702135',
  ]);
  assert.deepEqual(
    cap.infos.map((i) => i.language),
    ['es-ES', 'en-GB'],
  );
  const [es, en] = cap.infos;
  assert.equal(es.event, 'Aviso de lluvias de nivel naranja');
  assert.equal(es.severity, 'Severe');
  assert.equal(es.headline, 'Aviso de lluvias de nivel naranja. Campo de Cartagena y Mazarrón');
  assert.match(es.instruction, /^Esté preparado\./);
  assert.equal(en.headline, 'Severe rain warning. Campo de Cartagena y Mazarrón');
  assert.equal(es.onset, Date.parse('2026-11-04T19:00:00+01:00'));
  assert.equal(es.expires, Date.parse('2026-11-05T05:59:59+01:00'));
  assert.equal(es.parameters['AEMET-Meteoalerta nivel'], 'naranja');
  assert.equal(es.eventCodes['AEMET-Meteoalerta fenomeno'], 'PR;Lluvias');
  assert.equal(es.areas.length, 1);
  assert.equal(es.areas[0].desc, 'Campo de Cartagena y Mazarrón');
  assert.deepEqual(es.areas[0].geocodes, { 'AEMET-Meteoalerta zona': ['733005'] });
  const ring = es.areas[0].polygons[0];
  assert.equal(es.areas[0].polygons.length, 1);
  assert.deepEqual(ring.slice(0, 2), ring.slice(-2), 'closed ring');
  assert.ok(ring[0] < 0 && ring[1] > 37, 'stored as [lon, lat]');
});

test('parseCap reads every file of the bundle, green ones included', () => {
  const caps = aemet.map((f) => parseCap(f.xml));
  assert.ok(caps.every((c) => c !== null && c.infos.length === 2 && c.infos.every((i) => i.areas.length > 0)));
  // Some green files cover many zones, and a zone can have more than one ring (Grazalema: two).
  assert.ok(caps.some((c) => c!.infos[0].areas.some((a) => a.polygons.length > 1)));
});

test("parseCap reads MeteoAlarm's CAP (awareness parameters, EMMA_ID, no polygon)", () => {
  const cap = parseCap(fixture('meteoalarm-cap-spain.xml').toString())!;
  assert.equal(cap.msgType, 'Alert');
  assert.deepEqual(cap.references, []);
  const info = cap.infos[0];
  assert.equal(info.parameters['awareness_level'], '2; yellow; Moderate');
  assert.equal(info.parameters['awareness_type'], '10; Rain');
  assert.deepEqual(info.areas[0].geocodes, { EMMA_ID: ['ES084'] });
  assert.deepEqual(info.areas[0].polygons, []);
});

test('parseCap accepts a namespace prefix and reads circles; rejects what is not CAP', () => {
  const xml = `<cap:alert xmlns:cap="urn:oasis:names:tc:emergency:cap:1.2"><cap:identifier>X1</cap:identifier>
    <cap:sent>2026-11-04T10:00:00Z</cap:sent><cap:status>Actual</cap:status><cap:msgType>Cancel</cap:msgType>
    <cap:references>s,A1,2026-11-04T09:00:00Z s,A0,2026-11-04T08:00:00Z</cap:references>
    <cap:info><cap:event>Test &amp; more</cap:event><cap:area><cap:areaDesc>Here</cap:areaDesc>
    <cap:circle>40.1,-3.5 12.5</cap:circle></cap:area></cap:info></cap:alert>`;
  const cap = parseCap(xml)!;
  assert.equal(cap.identifier, 'X1');
  assert.equal(cap.msgType, 'Cancel');
  assert.deepEqual(cap.references, ['A1', 'A0']);
  assert.equal(cap.infos[0].language, 'en-US', "CAP's default language");
  assert.equal(cap.infos[0].event, 'Test & more');
  assert.deepEqual(cap.infos[0].areas[0].circles, [{ lat: 40.1, lon: -3.5, km: 12.5 }]);
  assert.equal(parseCap('<feed><entry/></feed>'), null);
  assert.equal(parseCap('<alert><status>Actual</status></alert>'), null, 'no identifier');
});

test('xmlText keeps paragraphs, collapses spaces, decodes entities and keeps CDATA as is', () => {
  assert.equal(xmlText('  One\r\n  line &lt;b&gt;   two\n\n\n\nThree &#233;&#x20AC;  '), 'One\nline <b> two\n\nThree é€');
  assert.equal(xmlText('<![CDATA[a &amp; <b>]]> c'), 'a &amp; <b> c');
});

test('blocks, text, attrs and without read only the element asked for', () => {
  const xml = '<r><area><areaDesc>A</areaDesc></area><area/><link type="x" href="1"/><link type="cap" href="2?a=1&amp;b=2"/></r>';
  assert.deepEqual(blocks(xml, 'area'), ['<areaDesc>A</areaDesc>', '']);
  assert.equal(text(xml, 'areaDesc'), 'A');
  assert.equal(text(xml, 'missing'), '');
  assert.equal(attrs(xml, 'link', (a) => a.type === 'cap')?.href, '2?a=1&b=2');
  assert.equal(without(xml, ['area', 'link']), '<r></r>');
});

test('parsePolygon turns "lat,lon" pairs into [lon, lat] and rejects bad ones', () => {
  assert.deepEqual(parsePolygon('1,2 3,4 5,6 1,2'), [2, 1, 4, 3, 6, 5, 2, 1]);
  assert.equal(parsePolygon('1,2 3,4 1,2'), null, 'fewer than 4 points');
  assert.equal(parsePolygon('1,2 3,x 5,6 1,2'), null);
  assert.equal(parsePolygon('95,2 3,4 5,6 95,2'), null, 'latitude out of range');
});

test('parseTime reads CAP and RSS times; parseReferences the identifiers', () => {
  assert.equal(parseTime('2026-11-03T10:27:59-00:00'), Date.parse('2026-11-03T10:27:59Z'));
  assert.equal(parseTime('Wed,  4 Nov 2026 22:50:01 +0000'), Date.parse('2026-11-04T22:50:01Z'));
  assert.equal(parseTime('Wed, 04 Nov 2026 21:42:44 GMT'), Date.parse('2026-11-04T21:42:44Z'));
  assert.equal(parseTime('4 Nov 2026 23:50 -0130'), Date.parse('2026-11-05T01:20:00Z'));
  assert.equal(parseTime(''), null);
  assert.equal(parseTime('soon'), null);
  assert.deepEqual(parseReferences(' a,ID1,t\n b,ID2,t '), ['ID1', 'ID2']);
  assert.deepEqual(parseReferences(''), []);
});
