// The printable emergency plan: an HTML page that expo-print turns into an A4 PDF.
// Paper is the point (it works when the phone is dead), so empty tables still print a
// few blank rows to fill in by hand. Pure: strings come in already translated.
import type { MeetingPoint, PrepareData } from './types.ts';

export type DocumentKitItem = { title: string; detail: string; have: boolean };
export type DocumentKitGroup = { title: string; items: DocumentKitItem[] };

export type PlanDocumentInput = {
  data: PrepareData;
  kit: DocumentKitGroup[];
  t: (k: string, options?: Record<string, unknown>) => string;
  formatCoords: (lat: number, lon: number) => string;
  generatedAt: string;
};

/** A4 in PostScript points (expo-print defaults to US Letter). */
export const A4 = { width: 595, height: 842 };

const BLANK_ROWS = 2;

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}

/** Escaped, with line breaks kept. */
function text(value: string): string {
  return escapeHtml(value.trim()).replace(/\n/g, '<br>');
}

function table(headers: string[], rows: string[][]): string {
  const blank = Array.from({ length: rows.length ? 1 : BLANK_ROWS }, () => headers.map(() => '&nbsp;'));
  const body = [...rows.map((r) => r.map(text)), ...blank];
  return `<table><thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead><tbody>${body
    .map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`)
    .join('')}</tbody></table>`;
}

function meeting(label: string, point: MeetingPoint | null, input: PlanDocumentInput): string {
  const coords =
    point?.lat != null && point.lon != null ? `<div class="muted">${escapeHtml(input.formatCoords(point.lat, point.lon))}</div>` : '';
  const body = point
    ? `<div class="strong">${text(point.place)}</div>${point.details.trim() ? `<div>${text(point.details)}</div>` : ''}${coords}`
    : '<div class="line"></div><div class="line"></div>';
  return `<div class="box"><div class="label">${escapeHtml(label)}</div>${body}</div>`;
}

export function planDocument(input: PlanDocumentInput): string {
  const { data, t } = input;
  const section = (title: string, body: string) => `<section><h2>${escapeHtml(title)}</h2>${body}</section>`;

  const people = data.people.length
    ? data.people
        .map((p) => {
          const rows = (
            [
              ['prepare:fields.person.medications', p.medications],
              ['prepare:fields.person.allergies', p.allergies],
              ['prepare:fields.person.bloodType', p.bloodType],
              ['prepare:fields.person.note', p.note],
            ] as const
          )
            .filter(([, v]) => v.trim())
            .map(([k, v]) => `<div><span class="muted">${escapeHtml(t(k))}:</span> ${text(v)}</div>`)
            .join('');
          return `<div class="box"><div class="strong">${text(p.name)}</div>${rows}</div>`;
        })
        .join('')
    : '<div class="box"><div class="line"></div><div class="line"></div></div>';

  const kit = input.kit
    .filter((g) => g.items.length)
    .map(
      (g) =>
        `<div class="kit-group"><h3>${escapeHtml(g.title)}</h3>${g.items
          .map(
            (i) =>
              `<div class="kit-item"><span class="check">${i.have ? '&#9745;' : '&#9744;'}</span><span>${escapeHtml(i.title)}${
                i.detail ? ` <span class="muted">· ${escapeHtml(i.detail)}</span>` : ''
              }</span></div>`,
          )
          .join('')}</div>`,
    )
    .join('');

  return `<!doctype html><html><head><meta charset="utf-8"><style>
@page { margin: 36pt; }
body { font-family: -apple-system, Helvetica, Arial, sans-serif; font-size: 10.5pt; color: #18171B; margin: 0; }
h1 { font-size: 20pt; margin: 0 0 2pt; }
h2 { font-size: 12pt; margin: 0 0 6pt; padding-bottom: 3pt; border-bottom: 1.5pt solid #F2643A; }
h3 { font-size: 10pt; margin: 6pt 0 3pt; text-transform: uppercase; letter-spacing: 0.5pt; color: #6A6760; }
section { margin-top: 14pt; page-break-inside: avoid; }
.muted { color: #6A6760; }
.strong { font-weight: 600; }
.intro { color: #6A6760; margin-bottom: 4pt; }
.grid { display: flex; gap: 8pt; }
.grid > .box { flex: 1; }
.box { border: 0.75pt solid #D5D2CB; border-radius: 6pt; padding: 6pt 8pt; margin-bottom: 6pt; }
.label { font-size: 8.5pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5pt; color: #F2643A; margin-bottom: 2pt; }
.line { border-bottom: 0.75pt solid #D5D2CB; height: 16pt; }
table { width: 100%; border-collapse: collapse; }
th { text-align: left; font-size: 8.5pt; text-transform: uppercase; letter-spacing: 0.4pt; color: #6A6760; padding: 3pt 4pt; border-bottom: 0.75pt solid #D5D2CB; }
td { padding: 5pt 4pt; border-bottom: 0.75pt solid #E3E0D9; vertical-align: top; height: 12pt; }
.notes { white-space: normal; min-height: 40pt; }
.kit-group { break-inside: avoid; }
.kit-item { display: flex; gap: 4pt; margin: 1.5pt 0; }
.check { font-size: 12pt; line-height: 1; }
footer { margin-top: 16pt; font-size: 8pt; color: #9B978E; }
</style></head><body>
<h1>${escapeHtml(t('prepare:doc.title'))}</h1>
<div class="intro">${escapeHtml(t('prepare:doc.intro'))}</div>
<div class="muted">${escapeHtml(t('prepare:doc.generated', { date: input.generatedAt }))}</div>
${section(
  t('prepare:plan.meeting'),
  `<div class="grid">${meeting(t('prepare:meeting.primary'), data.meeting.primary, input)}${meeting(t('prepare:meeting.secondary'), data.meeting.secondary, input)}</div>`,
)}
${section(
  t('prepare:plan.contacts'),
  table(
    [
      t('prepare:fields.contact.name'),
      t('prepare:fields.contact.relation'),
      t('prepare:fields.contact.phone'),
      t('prepare:fields.contact.note'),
    ],
    data.contacts.map((c) => [c.name, c.relation, c.phone, c.note]),
  ),
)}
${section(
  t('prepare:plan.numbers'),
  table(
    [t('prepare:fields.number.label'), t('prepare:fields.number.value'), t('prepare:fields.number.note')],
    data.numbers.map((n) => [n.label, n.value, n.note]),
  ),
)}
${section(t('prepare:plan.people'), people)}
${section(t('prepare:plan.homeNotes'), `<div class="box notes">${data.homeNotes.trim() ? text(data.homeNotes) : '<div class="line"></div><div class="line"></div>'}</div>`)}
${section(t('prepare:kit.title'), `<div class="kit">${kit}</div>`)}
<footer>${escapeHtml(t('prepare:doc.footer'))}</footer>
</body></html>`;
}
