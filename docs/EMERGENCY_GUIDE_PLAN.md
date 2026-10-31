# Emergency guide: sources and decisions

Status: source inventory done 2026-10-31, no card written yet. Step 6 of `docs/ASSISTANT_QUALITY_PLAN.md`: a
bilingual guide of short official texts that the assistant searches first and, for vital protocols, shows as
they are. Owner's rules (2026-10-31): the whole guide, **no text of our own** (faithful copies of official
sources that may legally be reproduced, each with its reference), official Spanish versions first, vital cards
shown verbatim. Health cards follow `HEALTH_FEATURES` (hidden on Android).

Files in `docs/emergency-guide/`: `cards.md` (the 94 cards), `matrix.md` (status per card), and the four
inventories, one table row per card with the URLs that were opened, dates, licence and caveats:
`sources-1-first-aid.md` (sections 1–2), `sources-2-water-food-power.md` (3–6, 11),
`sources-3-shelter-disasters.md` (7–10, 13), `sources-4-survival-licences.md` (12, and the licence check).

## Licences (verified on each site's legal page)

| Source family | May we copy it into the app? | Conditions |
|---|---|---|
| US federal works (CDC, NIOSH, FDA, FEMA/Ready.gov, NPS, DHS/CISA, NOAA, USGS, SAMHSA, NLM) | Yes, public domain (17 U.S.C. §105) | Credit the agency; no logos; images checked one by one (some are licensed). CDC asks for no substantive changes. |
| MedlinePlus | Only the NLM-written health-topic summaries (EN and ES) | **Not** the A.D.A.M. encyclopedia (`/ency/`) or ASHP drug pages. |
| US Army manuals marked "Distribution A" (ATP 4-02.11 first aid, 2026; ATP 3-50.21 survival, 2018) | Yes | No insignia. **Not** FM 3-05.70 (restricted now) or the older FM 4-25.11 / TC 4-02.1 (superseded). |
| Spanish government (Protección Civil, Interior, Sanidad, AESAN, INSST, AEMPS, IGN, Defensa) | Yes, Ley 37/2007, commercial use included | Cite the source ("Origen de los datos: …"), give the last-update date, don't change the meaning, don't imply endorsement. Defensa: CC BY-SA. |
| European Commission | Yes, CC BY 4.0 | Credit, and mark a translation as a change. |
| **Guardia Civil, Ministerio de Justicia (toxicology service)** | **No** (private use only) | Facts such as the phone number 91 562 04 20 can be stated; their text can't. |
| **WHO** (CC BY-NC-SA 3.0 IGO) | Avoid | Non-commercial and share-alike clash with the GPL app and would bind our translations. |
| Red Cross, AHA, ERC, Mayo, NGOs | No (copyright) | Only with written permission. |

## What the inventory found

| | Cards (of 94) |
|---|---|
| English: current reusable source / thin or partly outdated / none | 71 / 18 / 5 |
| Spanish: same agency's official version / Spanish-government text / needs a faithful translation / none | 53 / 13 / 23 / 5 |
| A tempting source that must not be used (named in `matrix.md`) | 21 |
| Sources that contradict each other | 10 |

- **English is well covered**: almost every card has a current US federal source. The new US Army first-aid
  manual (ATP 4-02.11, March 2026) follows current guidance (compressions first, 100–120/min, 5 back blows then
  abdominal thrusts, tourniquet for life-threatening bleeding, no tourniquet or cutting for snake bites), but it
  reads military ("Service member", DD Form 1380) and has no Spanish version.
- **Spanish is the weak side**: many CDC, NIOSH, FDA, NIH and Ready.gov pages have the agency's own Spanish
  version, often older than the English one. Spain's own bodies say 112 and fit Spain (Protección Civil, Sanidad,
  AESAN, INSST, IGN), but mostly as image-only infographics without dates or English. The rest needs a faithful
  translation.
- **Official sources that must not be copied, though they look right**:
  - Protección Civil's earthquake infographic ("bajo los dinteles de las puertas": contradicts drop-cover-hold on;
    use IGN 2020 or Ready.gov/es);
  - INSST NTP 467 (choking: "never strike the back"), NTP 469 (pressure points, Trendelenburg), NTP 246
    (neutralising acids with bicarbonate);
  - Ready.gov/es and FEMA 2004's "16 drops of bleach per gallon" (double the CDC/EPA dose);
  - the US Army manual's unresponsive-choking paragraphs (rescue breaths and "6 to 10 thrusts" instead of CPR).
- **No current reusable source at all** (5 cards, both languages): infant choking, swallowed poisons (only "call
  Poison Control"), drowning rescue, emergency childbirth (only a 1960s civil-defence booklet), toilets without
  running water. Close to it: child and infant CPR beyond one paragraph, the recovery-position roll, a home-made oral
  rehydration recipe, distress signals, war and air raids in Spanish
  (the EU's 72-hour citizen guidance is promised for 2026), and a bleach dose for Spanish lejía (3.5–6 %, by law)
  in drops per litre.
- **Sources contradict each other** (boiling at altitude, toilet-tank water, how to disinfect cans, fridge 40 °F vs
  5 °C): each card follows one source, never a mix.
- **US details travel with a faithful copy**: 911, US Poison Control, °F, gallons, inches, US brands and species.

## Decisions for the owner

1. **Is a faithful translation "copying"?** 23 cards have no official Spanish text (many first-aid steps, all of
   outdoor survival). Options: (a) yes, marked "Traducción fiel de <fuente>" with the original
   linked, reviewed sentence by sentence; (b) no: those cards only in the language their source has.
2. **Excerpts.** Many sources are long pages or manual chapters: may a card be an excerpt (whole sentences and
   paragraphs left out, nothing reworded, marked "Fragmento")? Without it the US-system cards (alerts, documents,
   disability) and the Army manual are unusable.
3. **US details.** A copy keeps "call 911", °F and gallons. Options: (a) keep the text as it is and show a fixed note
   outside it ("En España: 112 · 91 562 04 20 Información Toxicológica"), with metric equivalents in brackets marked
   as ours; (b) prefer the Spanish-government text wherever one exists, even if EN and ES then differ.
4. **Gaps.** For the cards with no reusable source: (a) leave them out and let the assistant say so; (b) a card that
   only says what the official sources do say (call 112, the number) and nothing more; (c) ask Cruz Roja Española or
   the Consejo Español de RCP for permission to reproduce their protocols (infant choking, paediatric CPR,
   drowning, childbirth), which would close the most important gaps.
5. **Lejía.** No official Spanish dose in drops per litre exists. Options: the CDC/EPA table as it is (for 6 % and
   8.25 %, with a note that Spanish lejía is 3.5–6 % and the label rules), or no dose (boiling only).

## Next

After the decisions: write the cards (text copied, never generated), each with source, URL, date and licence line;
a check that compares each card with its source text; the guide shipped in the app (small, bilingual, searched
first by the assistant, vital cards shown whole); then the bench again.
