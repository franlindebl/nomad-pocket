/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { decodeEntities, extractHeadings, extractLinks, htmlToText, metaRefreshTarget, resolveZimHref, stripTags } from './html.ts';

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

test('htmlToText reads sloppy attributes', () => {
  const { text } = htmlToText('<p class="a"id=\'b\' data-x=1/2 title="q"style="display:none">kept</p><p hidden>gone</p><a href=x/>y</a>');
  assert.equal(text, 'y');
  assert.equal(htmlToText('<p title="a"lang=es>uno</p><p>dos</p>').text, 'uno\n\ndos');
});

test('htmlToText stays fast on a tag with many attributes and a broken close', () => {
  const attrs = Array.from({ length: 30 }, (_, i) => `a${i}="v${i}"`).join(' ');
  const start = performance.now();
  const { text } = htmlToText(`<p>before</p><img ${attrs} / ><p>after</p>`);
  // Backtracking over every quoted/unquoted reading took seconds at 24 attributes.
  assert.ok(performance.now() - start < 200, `took ${Math.round(performance.now() - start)} ms`);
  assert.match(text, /^before\n\n/);
  assert.match(text, /after$/);
});

test('resolveZimHref resolves relative paths', () => {
  assert.equal(resolveZimHref('Foo', 'A/Bar'), 'A/Foo');
  assert.equal(resolveZimHref('../-/s.css', 'A/Bar'), '-/s.css');
  assert.equal(resolveZimHref('./Caf%C3%A9#x', 'Bar'), 'Café');
  assert.equal(resolveZimHref('#top', 'Bar'), null);
  assert.equal(resolveZimHref('https://x.org', 'Bar'), null);
});

test('metaRefreshTarget follows HTML redirect pages', () => {
  const page = `<html>\n  <head>\n    <title>Prince Michael Jackson</title>\n    <meta http-equiv="refresh" content="0;URL='./Michael_Jackson#Label_dispute_and_Invincible_(1997\u20132002)'" />\n  </head>\n  <body><a href="./Michael_Jackson">Prince Michael Jackson</a></body>\n</html>`;
  assert.equal(metaRefreshTarget(page, 'Prince_Michael_Jackson'), 'Michael_Jackson');
  assert.equal(metaRefreshTarget('<meta content="0; url=../A/Caf%C3%A9" http-equiv="Refresh">', 'B/x'), 'A/Café');
  assert.equal(metaRefreshTarget(ARTICLE, 'Water'), null);
});

test('extractLinks returns internal article links in order, deduplicated', () => {
  const links = extractLinks(ARTICLE, 'Water');
  assert.deepEqual(links, [
    { path: 'Life', title: 'all known forms of life' },
    { path: 'Ice', title: 'ice' },
    { path: 'Ocean', title: 'Ocean' },
  ]);
});

test('extractLinks keeps portal-style page layouts but drops Wikipedia portal boxes', () => {
  const html = `<body><div class="portal-columna-izquierda"><a href="Física">Física</a></div>
    <div class="portal"><a href="Portal:Ciencia">Ciencia</a></div><div class="portal-bar-content"><a href="Portal:X">X</a></div></body>`;
  assert.deepEqual(extractLinks(html, 'Portada'), [{ path: 'Física', title: 'Física' }]);
});

test('extractHeadings: ids on headings or inner mw-headline spans, deduped, in order', () => {
  const html = `<h2 id="Historia">Historia</h2><p>x</p>
<h3><span class="mw-headline" id="Origen">Or&iacute;gen</span><span class="edit">[editar]</span></h3>
<h4 id="deep">Too deep</h4><h2>No id</h2><h2 id="Historia">Dup</h2>`;
  assert.deepEqual(extractHeadings(html), [
    { id: 'Historia', title: 'Historia', level: 2 },
    { id: 'Origen', title: 'Orígen', level: 3 },
  ]);
});
