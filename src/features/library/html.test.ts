/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { decodeEntities, extractLinks, htmlToText, resolveZimHref, stripTags } from './html.ts';

const ARTICLE = `<!DOCTYPE html><html><head><title>Water &amp; Ice</title><style>p{color:red}</style>
<script>var x = "<p>nope</p>";</script></head><body>
<header><a href="Home">Home</a></header>
<div class="mw-body"><h1>Water</h1>
<div role="note" class="hatnote">For other uses, see <a href="Water_(disambiguation)">Water (disambiguation)</a>.</div>
<table class="infobox"><tr><th>Formula</th><td>H2O infobox</td></tr></table>
<p>Water is an <b>inorganic</b> compound<sup class="reference"><a href="#cite_note-1">[1]</a></sup> with the formula H<sub>2</sub>O.</p>
<p>It is   vital&nbsp;for <a href="Life" title="Life">all known forms of life</a>, see <a href="./Ice#Phases">ice</a> and <a href="https://example.org">the web</a>.</p>
<ul><li>Solid</li><li>Liquid</li></ul>
<table class="navbox"><tr><td><a href="Navbox_Link">Nav</a></td></tr></table>
<p><img src="../I/drop.png"><a href="../I/drop.png">image</a> <a href="Life">Life again</a> <a href="Ocean">Ocean</a></p>
</div>
<footer>Footer text</footer>
</body></html>`;

test('decodeEntities handles named and numeric entities', () => {
  assert.equal(decodeEntities('a &amp; b &#233; &#x1F600; &ntilde; &unknown;'), 'a & b é 😀 ñ &unknown;');
});

test('stripTags removes highlight markup', () => {
  assert.equal(stripTags('the <b>water</b>   cycle &amp; more'), 'the water cycle & more');
});

test('htmlToText keeps paragraphs and drops chrome', () => {
  const { title, text } = htmlToText(ARTICLE);
  assert.equal(title, 'Water & Ice');
  assert.match(text, /^Water\n\nWater is an inorganic compound with the formula H2O\./);
  assert.match(text, /It is vital for all known forms of life, see ice and the web\./);
  assert.match(text, /• Solid\n• Liquid/);
  for (const banned of ['infobox', 'nope', 'color:red', 'Footer', 'Home', 'Nav', '[1]', 'For other uses']) {
    assert.ok(!text.includes(banned), `should not contain ${banned}`);
  }
});

test('htmlToText truncates at a word boundary', () => {
  const { text } = htmlToText(`<p>${'word '.repeat(100)}</p>`, 52);
  assert.ok(text.length <= 53);
  assert.ok(text.endsWith('word…'));
});

test('resolveZimHref resolves relative paths', () => {
  assert.equal(resolveZimHref('Foo', 'A/Bar'), 'A/Foo');
  assert.equal(resolveZimHref('../-/s.css', 'A/Bar'), '-/s.css');
  assert.equal(resolveZimHref('./Caf%C3%A9#x', 'Bar'), 'Café');
  assert.equal(resolveZimHref('#top', 'Bar'), null);
  assert.equal(resolveZimHref('https://x.org', 'Bar'), null);
});

test('extractLinks returns internal article links in order, deduplicated', () => {
  const links = extractLinks(ARTICLE, 'Water');
  assert.deepEqual(links, [
    { path: 'Life', title: 'all known forms of life' },
    { path: 'Ice', title: 'ice' },
    { path: 'Ocean', title: 'Ocean' },
  ]);
});
