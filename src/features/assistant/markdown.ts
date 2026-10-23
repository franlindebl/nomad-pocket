// Tiny Markdown parser for model answers: headings, paragraphs, bullet and
// numbered lists, fenced code, quotes; inline bold, italics, code and [n]
// citations. Tolerant of half-written input while streaming. Pure (tested).

export type Inline =
  | { type: 'text'; text: string }
  | { type: 'bold'; children: Inline[] }
  | { type: 'italic'; children: Inline[] }
  | { type: 'code'; text: string }
  | { type: 'cite'; n: number };

export type Block =
  | { type: 'heading'; level: 1 | 2 | 3; children: Inline[] }
  | { type: 'paragraph'; children: Inline[] }
  | { type: 'list'; ordered: boolean; start: number; items: Inline[][] }
  | { type: 'code'; text: string; lang: string }
  | { type: 'quote'; children: Inline[] }
  | { type: 'rule' };

const pushText = (out: Inline[], text: string) => {
  if (!text) return;
  const last = out[out.length - 1];
  if (last?.type === 'text') last.text += text;
  else out.push({ type: 'text', text });
};

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let i = 0;
  while (i < src.length) {
    const rest = src.slice(i);
    // `code`
    if (rest[0] === '`') {
      const end = rest.indexOf('`', 1);
      if (end > 1) {
        out.push({ type: 'code', text: rest.slice(1, end) });
        i += end + 1;
        continue;
      }
    }
    // [1] or [1, 2] citations
    const cite = /^\[(\d{1,2}(?:\s*,\s*\d{1,2})*)\]/.exec(rest);
    if (cite) {
      for (const n of cite[1].split(',')) out.push({ type: 'cite', n: Number(n.trim()) });
      i += cite[0].length;
      continue;
    }
    // **bold** / __bold__
    const bold = /^(\*\*|__)(?=\S)([\s\S]*?\S)\1/.exec(rest);
    if (bold) {
      out.push({ type: 'bold', children: parseInline(bold[2]) });
      i += bold[0].length;
      continue;
    }
    // *italic* / _italic_ (underscore only at word boundaries)
    let italic = /^\*(?=\S)([^*]*?\S)\*(?!\*)/.exec(rest);
    if (!italic && rest[0] === '_' && (i === 0 || !/[\p{L}\p{N}]/u.test(src[i - 1]))) {
      italic = /^_(?=\S)([^_]*?\S)_(?![\p{L}\p{N}])/u.exec(rest);
    }
    if (italic) {
      out.push({ type: 'italic', children: parseInline(italic[1]) });
      i += italic[0].length;
      continue;
    }
    // Unclosed ** while streaming: hide the marker.
    if (rest.startsWith('**') && rest.indexOf('**', 2) === -1) {
      i += 2;
      continue;
    }
    // Plain run up to the next special char.
    const next = rest.slice(1).search(/[`[*_]/);
    const len = next === -1 ? rest.length : next + 1;
    pushText(out, rest.slice(0, len));
    i += len;
  }
  return out;
}

const BULLET = /^\s*[-*•+]\s+(.*)$/;
const ORDERED = /^\s*(\d{1,3})[.)]\s+(.*)$/;

export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let para: string[] = [];

  const flush = () => {
    if (para.length) blocks.push({ type: 'paragraph', children: parseInline(para.join(' ')) });
    para = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith('```')) {
      flush();
      const lang = trimmed.slice(3).trim();
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) body.push(lines[i++]);
      blocks.push({ type: 'code', text: body.join('\n'), lang });
      continue;
    }
    if (!trimmed) {
      flush();
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (heading) {
      flush();
      const level = Math.min(3, heading[1].length) as 1 | 2 | 3;
      blocks.push({ type: 'heading', level, children: parseInline(heading[2].replace(/\s+#+$/, '')) });
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flush();
      blocks.push({ type: 'rule' });
      continue;
    }
    if (trimmed.startsWith('>')) {
      flush();
      const body = [trimmed.replace(/^>\s?/, '')];
      while (i + 1 < lines.length && lines[i + 1].trim().startsWith('>')) body.push(lines[++i].trim().replace(/^>\s?/, ''));
      blocks.push({ type: 'quote', children: parseInline(body.join(' ')) });
      continue;
    }
    const b = BULLET.exec(line);
    const o = ORDERED.exec(line);
    if (b || o) {
      flush();
      const ordered = !b;
      const start = o ? Number(o[1]) : 1;
      const items: string[] = [b ? b[1] : o![2]];
      while (i + 1 < lines.length) {
        const nb = BULLET.exec(lines[i + 1]);
        const no = ORDERED.exec(lines[i + 1]);
        if (ordered ? no : nb) {
          items.push(ordered ? no![2] : nb![1]);
          i++;
        } else if (lines[i + 1].trim() && /^\s{2,}/.test(lines[i + 1])) {
          // Continuation line of the previous item.
          items[items.length - 1] += ` ${lines[++i].trim()}`;
        } else break;
      }
      blocks.push({ type: 'list', ordered, start, items: items.map(parseInline) });
      continue;
    }
    para.push(trimmed);
  }
  flush();
  return blocks;
}
