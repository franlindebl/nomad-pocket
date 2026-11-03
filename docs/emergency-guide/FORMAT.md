# Emergency guide: card format and rules

How a card of the emergency guide is written. Decisions behind it: `docs/EMERGENCY_GUIDE_PLAN.md`; which source each
card uses: `matrix.md` and the `sources-*.md` inventories next to this file.

## Files

One file per card and language: `src/data/guide/<id>.<lang>.md`, e.g. `cpr-adult.es.md` and `cpr-adult.en.md`.
`<id>` is a short English slug, the same in both languages, stable (the app links to it). Both languages must exist.
`node scripts/guide/build.mjs` turns them into `src/data/guide.json` (bundled with the app); `--check` fails when the
JSON is stale. `node scripts/guide/check-sources.mjs [id…]` compares every copied sentence with its source (below).

```markdown
---
id: cpr-adult
number: 1.1
title: RCP en adultos
vital: yes
health: yes
kind: copy
source: MedlinePlus, Biblioteca Nacional de Medicina de EE. UU. | Reanimación cardiopulmonar | https://medlineplus.gov/spanish/cpr.html | 28/07/2026
licence: Dominio público (obra del Gobierno de EE. UU.). Cortesía de MedlinePlus, de la Biblioteca Nacional de Medicina.
keywords: rcp, reanimación, masaje cardiaco, no respira, parada cardiaca, inconsciente, desfibrilador
---
Body in Markdown: the source's own text.
```

Front matter, one `key: value` per line (no nesting, no quotes needed):

| Key | Value |
|---|---|
| `id` | the slug, same as the file name |
| `number` | position in `cards.md` (`1.1`, `11.5`): orders the guide; its first part is the section |
| `title` | the card's title in this language (ours: a plain name of the topic, not the source page's title) |
| `vital` | `yes` when the assistant shows the card itself, word for word, instead of writing an answer (protocols where a paraphrase can kill: CPR, choking, bleeding, bleach doses…). Otherwise `no` |
| `health` | `yes` for anything about health, medicine or first aid (hidden on Android, `HEALTH_FEATURES`). Otherwise `no` |
| `kind` | `copy` (the source's text, whole), `excerpt` (the source's text with whole sentences or paragraphs left out), `translation` (a faithful translation of the other language's card), `own` (our wording of current guidance: only the five gap cards) |
| `source` | `Agency | Title of the page or document (section, paragraphs) | URL | date as the page shows it`. Repeat the line for a second source. For a `translation`, the original's source line (the card it translates) |
| `licence` | the reuse line the source asks for (public domain + credit, Ley 37/2007 "Origen de los datos", CC BY 4.0…) |
| `translatedFrom` | `translation` only: the language of the card it translates (`en` or `es`) |
| `basis` | `own` only: the guidelines followed, e.g. `ERC Guidelines 2025: First Aid; WHO 2023 …` |
| `see` | optional: comma-separated ids of related cards, shown as links under the card ("if the person stops breathing" → `cpr-adult`). Cross-references go here, never in the body |
| `transcribed` | optional: `yes` when the source shows the text only in an image (an infographic with no text layer) and the card was transcribed from it word for word; the source check skips it, a person compares it with the image |
| `note` | optional, rare: one short sentence of ours shown outside the text, labelled as Nomad Pocket's (e.g. the strength of Spanish bleach on the bleach card). Facts only, with the source given in the inventory |
| `keywords` | comma-separated words and phrases people would type or say, in this card's language: synonyms, colloquial terms, symptoms ("se ha tragado", "no respira", "picadura de víbora"). 8–25 of them |

## Body rules (hard)

1. **No text of our own** (except `own` cards). Every sentence comes from the source as it is: same words, same order,
   same numbers. Fix nothing, modernise nothing, merge nothing. If a sentence is wrong or outdated, leave it out (whole)
   and say so in the inventory, or pick another source.
2. **Excerpts** leave out whole sentences, list items or paragraphs, never parts of a sentence. Mark a gap inside the text
   with `[…]` on its own line. A list may keep only some of its items without a mark.
3. **Structure** may follow the source's: `##`/`###` headings, `-` bullets, `1.` numbered steps, `**bold**` where the
   source has it. No tables, no links, no images (the app's Markdown has none). A heading the source doesn't have may be
   added only if it is a word or two naming the part ("## Qué hacer"); prefer the source's own headings.
4. **US details stay** (911, °F, gallons, inches, US brands). Write "911" as the source has it: when the person's
   emergency number is another one, the app shows that number in its place (`cardBody`, not in `own` cards) and a note
   outside the text says the original says 911 (since 2026-11-03, the owner's call: a vital card read in a hurry must
   not send someone in Spain to dial 911). US Poison Control (1-800-222-1222, "poison control center") also stays in the
   text: the app adds Spain's Servicio de Información Toxicológica (91 562 04 20) in a note for people in Spain, and
   elsewhere outside the US says the 1-800 number only works there. A metric equivalent may follow a US unit in brackets, marked as ours:
   `95 °F [≈ 35 °C, nota de Nomad]` / `2 inches [≈ 5 cm, Nomad note]`. Nothing else in brackets.
5. **Short**: the protocol, not the page. Aim for 120–350 words; leave out background, statistics, prevention (unless
   the card is about prevention), "learn more", course adverts, contact boxes. A vital card is read in a hurry: the steps
   first.
6. **Translations** (`kind: translation`) translate the other language's card sentence by sentence: same sentences, same
   order, same numbers and units, nothing added or dropped, neutral Spanish of Spain ("usted" when the source addresses
   the reader formally, as CDC en español does; otherwise "tú" is fine if the original is direct imperative — be
   consistent within a card). Medical terms as Spain's official bodies use them (RCP, desfibrilador / DEA, torniquete,
   posición lateral de seguridad, 112 stays a note, not in the text).
7. **Own cards** (`kind: own`, the five gaps only: infant choking, swallowed poison, drowning, emergency childbirth,
   toilets without running water): our plain wording of what the current guideline says, nothing beyond it, no doses
   or numbers the guideline doesn't give. Every step must be traceable to the `basis` guideline. The app labels them
   "Redactado por Nomad Pocket según <basis>". Both languages say the same thing.

## Source check

`node scripts/guide/check-sources.mjs [id…]` fetches every `source` URL of the `copy` and `excerpt` cards (PDFs through
`pdftotext`), caches the text outside the repo (`$GUIDE_CACHE`, default `$TMPDIR/nomad-guide-sources`), and prints every
sentence of the card that it can't find in the source (after normalising whitespace, quotes, dashes, case, Markdown
markers, hyphenation and our bracketed notes). A card is done when it prints no miss, or when each miss is explained
(a PDF line break inside a word, a page header splitting a paragraph). Translations and own cards are reviewed by a
person or an agent sentence by sentence against their original or basis.
