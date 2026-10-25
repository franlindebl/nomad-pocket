import assert from 'node:assert/strict';
import { test } from 'node:test';

import { escapeHtml, planDocument } from './document.ts';
import { DEFAULT_HOUSEHOLD } from './kit.ts';
import type { PrepareData } from './types.ts';

const empty: PrepareData = {
  contacts: [],
  numbers: [],
  people: [],
  meeting: { primary: null, secondary: null },
  homeNotes: '',
  household: DEFAULT_HOUSEHOLD,
  kit: {},
  custom: [],
};

const render = (data: PrepareData) =>
  planDocument({
    data,
    kit: [{ title: 'Agua', items: [{ title: 'Agua embotellada', detail: '24 L', have: true }] }],
    t: (key, o) => (o ? `${key}:${JSON.stringify(o)}` : key),
    formatCoords: (lat, lon) => `${lat},${lon}`,
    generatedAt: '25/10/2026',
  });

test('escapes user text', () => {
  assert.equal(escapeHtml(`<b>"Tom" & 'Ana'</b>`), '&lt;b&gt;&quot;Tom&quot; &amp; &#39;Ana&#39;&lt;/b&gt;');
  const html = render({ ...empty, contacts: [{ id: '1', name: '<script>x</script>', relation: '', phone: '600', note: '' }] });
  assert.ok(!html.includes('<script>x'));
  assert.ok(html.includes('&lt;script&gt;x'));
});

test('an empty plan still prints blank rows to fill in', () => {
  const html = render(empty);
  assert.ok(html.includes('class="line"'));
  assert.ok((html.match(/<td>&nbsp;<\/td>/g) ?? []).length >= 8);
});

test('meeting point with coordinates and kit checks', () => {
  const html = render({
    ...empty,
    meeting: {
      primary: { place: 'Plaza Mayor', details: 'A las 18:00\nJunto a la fuente', markerId: 1, lat: 40.4, lon: -3.7 },
      secondary: null,
    },
  });
  assert.ok(html.includes('Plaza Mayor'));
  assert.ok(html.includes('A las 18:00<br>Junto a la fuente'));
  assert.ok(html.includes('40.4,-3.7'));
  assert.ok(html.includes('&#9745;'));
  assert.ok(html.includes('prepare:doc.generated:{&quot;date&quot;:&quot;25/10/2026&quot;}'));
});
