/// <reference types="node" />
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { afterEach, describe, it } from 'node:test';

// Node's type stripping needs the explicit .ts extension; tsconfig doesn't enable
// allowImportingTsExtensions, so silence TS5097 here (types still resolve).
import { buildEntriesUrl, decodeEntities, parseOpdsFeed, resolveLatest, searchKiwix, shortLanguage } from './opds.ts';

const fixture = (name: string) => readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf8');

// Real responses saved from opds.library.kiwix.org on 2026-10-24:
//   opds-sample.xml                  ?lang=spa&count=6
//   opds-name-wikipedia_es_top.xml   ?name=wikipedia_es_top
//   opds-name-nhs.xml                ?name=nhs.uk_en_medicines
const SAMPLE = fixture('opds-sample.xml');
const WIKIPEDIA_ES_TOP = fixture('opds-name-wikipedia_es_top.xml');
const NHS = fixture('opds-name-nhs.xml');
const EMPTY = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"><totalResults>0</totalResults><startIndex>0</startIndex></feed>`;

describe('parseOpdsFeed', () => {
  it('reads the total and every entry of a real feed', () => {
    const feed = parseOpdsFeed(SAMPLE);
    assert.equal(feed.total, 430);
    assert.equal(feed.entries.length, 6);
  });

  it('parses all fields of an entry', () => {
    const [ecured] = parseOpdsFeed(SAMPLE).entries;
    assert.deepEqual(ecured, {
      id: '87e75aa6-c845-217e-7666-9485e2229457',
      name: 'kiwix.ecured_es_all',
      flavour: null,
      title: 'EcuRed',
      description: 'EcuRed',
      language: 'spa',
      category: null,
      sizeBytes: 3321638912,
      version: '2019-05',
      url: 'https://lb.download.kiwix.org/zim/other/ecured_es_all_2019-05.zim',
      articleCount: 200968,
      illustrationUrl:
        'https://opds.library.kiwix.org/catalog/v2/illustration/87e75aa6-c845-217e-7666-9485e2229457/?size=48',
      tags: ['ecured'],
    });
  });

  it('does not confuse <author><name> with the book name', () => {
    for (const e of parseOpdsFeed(SAMPLE).entries) {
      assert.notEqual(e.name, 'openZIM');
      assert.ok(e.url.endsWith('.zim'), e.url);
      assert.ok(!e.url.endsWith('.meta4'));
    }
  });

  it('appends the flavour to the name and reads categories', () => {
    const entries = parseOpdsFeed(SAMPLE).entries;
    const vikidia = entries.filter((e) => e.name.startsWith('vikidia_es_all'));
    assert.deepEqual(vikidia.map((e) => [e.name, e.flavour, e.category]).sort(), [
      ['vikidia_es_all_maxi', 'maxi', 'vikidia'],
      ['vikidia_es_all_nopic', 'nopic', 'vikidia'],
    ]);
    const ted = entries.find((e) => e.name === 'ted_mul_worklife');
    assert.equal(ted?.category, 'ted');
    assert.ok(ted?.language.split(',').includes('spa'));
  });

  it('handles respin letters in file names (…_2026-09b.zim)', () => {
    const [nhs] = parseOpdsFeed(NHS).entries;
    assert.equal(nhs.name, 'nhs.uk_en_medicines');
    assert.equal(nhs.version, '2026-09');
    assert.equal(nhs.url, 'https://lb.download.kiwix.org/zim/zimit/nhs.uk_en_medicines_2026-09b.zim');
    assert.equal(nhs.category, 'other');
  });

  it('decodes entities and CDATA, and skips entries without an acquisition link', () => {
    const xml = `<feed><totalResults>2</totalResults>
      <entry>
        <id>urn:uuid:abc</id>
        <title>Caf&#233; &amp; T&#xE9; &lt;3</title>
        <summary><![CDATA[Raw <b>&amp;</b> text]]></summary>
        <language>spa</language>
        <name>cafe_es_all</name>
        <flavour/>
        <category></category>
        <tags>cocina;_category:other;_pictures:no</tags>
        <link rel='http://opds-spec.org/acquisition/open-access' href='https://example.org/zim/cafe_es_all_2025-01.zim.meta4' length='1024'/>
      </entry>
      <entry><id>urn:uuid:broken</id><title>No link</title></entry>
    </feed>`;
    const feed = parseOpdsFeed(xml);
    assert.equal(feed.total, 2);
    assert.equal(feed.entries.length, 1);
    const [e] = feed.entries;
    assert.equal(e.title, 'Café & Té <3');
    assert.equal(e.description, 'Raw & text');
    assert.equal(e.flavour, null);
    assert.equal(e.category, 'other'); // falls back to the _category: tag
    assert.deepEqual(e.tags, ['cocina']);
    assert.equal(e.sizeBytes, 1024);
    assert.equal(e.articleCount, null);
    assert.equal(e.illustrationUrl, null);
    assert.equal(e.version, '2025-01');
  });

  it('returns an empty result for an empty feed', () => {
    assert.deepEqual(parseOpdsFeed(EMPTY), { total: 0, entries: [] });
  });
});

describe('shortLanguage', () => {
  it('maps ISO 639-3 to the codes the app shows', () => {
    assert.equal(shortLanguage('spa'), 'es');
    assert.equal(shortLanguage('eng'), 'en');
    assert.equal(shortLanguage('eng,spa'), 'mul');
    assert.equal(shortLanguage('xyz'), 'xyz');
    assert.equal(shortLanguage(''), '');
  });
});

describe('decodeEntities', () => {
  it('leaves unknown entities untouched', () => {
    assert.equal(decodeEntities('a &bogus; b &#65;'), 'a &bogus; b A');
  });
});

describe('network', () => {
  const realFetch = globalThis.fetch;
  const calls: string[] = [];
  const mockFetch = (responder: (url: string) => string | number) => {
    calls.length = 0;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      const body = responder(url);
      return typeof body === 'number' ? new Response('', { status: body }) : new Response(body, { status: 200 });
    }) as typeof fetch;
  };
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('builds search URLs', () => {
    assert.equal(
      buildEntriesUrl({ q: ' primeros auxilios ', lang: ['spa', 'eng'], category: 'wikipedia', start: 20, count: 10 }),
      'https://opds.library.kiwix.org/catalog/v2/entries?q=primeros%20auxilios&lang=spa%2Ceng&category=wikipedia&start=20&count=10',
    );
    assert.equal(buildEntriesUrl({}), 'https://opds.library.kiwix.org/catalog/v2/entries');
  });

  it('searchKiwix fetches and parses', async () => {
    mockFetch(() => SAMPLE);
    const res = await searchKiwix({ lang: 'spa', count: 6 });
    assert.equal(calls[0], 'https://opds.library.kiwix.org/catalog/v2/entries?lang=spa&count=6');
    assert.equal(res.total, 430);
    assert.equal(res.entries.length, 6);
  });

  it('searchKiwix rejects on HTTP errors', async () => {
    mockFetch(() => 503);
    await assert.rejects(searchKiwix({ q: 'x' }), /HTTP 503/);
  });

  it('resolveLatest strips the flavour for the query and picks the matching flavour', async () => {
    mockFetch((url) => (url.includes('name=wikipedia_es_top&') ? WIKIPEDIA_ES_TOP : EMPTY));
    const e = await resolveLatest('wikipedia_es_top_mini');
    assert.equal(calls[0], 'https://opds.library.kiwix.org/catalog/v2/entries?name=wikipedia_es_top&count=100');
    assert.equal(e?.name, 'wikipedia_es_top_mini');
    assert.equal(e?.url, 'https://lb.download.kiwix.org/zim/wikipedia/wikipedia_es_top_mini_2026-10.zim');
  });

  it('resolveLatest picks the newest version', async () => {
    const older = NHS.replaceAll('2026-09b', '2025-12').replace(/<id>urn:uuid:[^<]+<\/id>/, '<id>urn:uuid:old</id>');
    const both = NHS.replace('</feed>', `${older.slice(older.indexOf('<entry>'), older.indexOf('</feed>'))}</feed>`);
    mockFetch(() => both);
    assert.equal(parseOpdsFeed(both).entries.length, 2);
    const e = await resolveLatest('nhs.uk_en_medicines');
    assert.equal(e?.version, '2026-09');
  });

  it('resolveLatest returns null for unknown books', async () => {
    mockFetch(() => EMPTY);
    assert.equal(await resolveLatest('does_not_exist_mini'), null);
    assert.equal(calls.length, 2); // unflavoured name, then the literal name
  });

  it('passes the abort signal to fetch', async () => {
    let seen: AbortSignal | undefined;
    globalThis.fetch = (async (_: RequestInfo | URL, init?: RequestInit) => {
      seen = init?.signal ?? undefined;
      return new Response(EMPTY);
    }) as typeof fetch;
    const ctrl = new AbortController();
    await searchKiwix({ q: 'a' }, ctrl.signal);
    assert.equal(seen, ctrl.signal);
  });
});
