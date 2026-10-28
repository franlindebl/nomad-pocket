// Extra search terms for the country picker: ISO3 codes and the names people actually type
// ("EEUU", "Holanda", "Inglaterra") that differ from the Natural Earth names in regions.json.
// Pure (no imports) so it is unit-tested; keys are ISO2 ids as in regions.json, values already folded
// (lower-case, no accents; see `fold` in regions.ts).

const ISO3: Record<string, string> = {
  af: 'afg', al: 'alb', dz: 'dza', ad: 'and', ao: 'ago', ag: 'atg', ar: 'arg', am: 'arm', au: 'aus', at: 'aut', az: 'aze', bs: 'bhs', bh: 'bhr',
  bd: 'bgd', bb: 'brb', by: 'blr', be: 'bel', bz: 'blz', bj: 'ben', bt: 'btn', bo: 'bol', ba: 'bih', bw: 'bwa', br: 'bra', bn: 'brn', bg: 'bgr',
  bf: 'bfa', bi: 'bdi', cv: 'cpv', kh: 'khm', cm: 'cmr', ca: 'can', cf: 'caf', td: 'tcd', cl: 'chl', cn: 'chn', co: 'col', km: 'com', cg: 'cog',
  cd: 'cod', cr: 'cri', ci: 'civ', hr: 'hrv', cu: 'cub', cy: 'cyp', cz: 'cze', dk: 'dnk', dj: 'dji', dm: 'dma', do: 'dom', ec: 'ecu', eg: 'egy',
  sv: 'slv', gq: 'gnq', er: 'eri', ee: 'est', sz: 'swz', et: 'eth', fj: 'fji', fi: 'fin', fr: 'fra', ga: 'gab', gm: 'gmb', ge: 'geo', de: 'deu',
  gh: 'gha', gr: 'grc', gd: 'grd', gt: 'gtm', gn: 'gin', gw: 'gnb', gy: 'guy', ht: 'hti', hn: 'hnd', hu: 'hun', is: 'isl', in: 'ind', id: 'idn',
  ir: 'irn', iq: 'irq', ie: 'irl', il: 'isr', it: 'ita', jm: 'jam', jp: 'jpn', jo: 'jor', kz: 'kaz', ke: 'ken', ki: 'kir', kp: 'prk', kr: 'kor',
  kw: 'kwt', kg: 'kgz', la: 'lao', lv: 'lva', lb: 'lbn', ls: 'lso', lr: 'lbr', ly: 'lby', li: 'lie', lt: 'ltu', lu: 'lux', mg: 'mdg', mw: 'mwi',
  my: 'mys', mv: 'mdv', ml: 'mli', mt: 'mlt', mh: 'mhl', mr: 'mrt', mu: 'mus', mx: 'mex', fm: 'fsm', md: 'mda', mc: 'mco', mn: 'mng', me: 'mne',
  ma: 'mar', mz: 'moz', mm: 'mmr', na: 'nam', nr: 'nru', np: 'npl', nl: 'nld', nz: 'nzl', ni: 'nic', ne: 'ner', ng: 'nga', mk: 'mkd', no: 'nor',
  om: 'omn', pk: 'pak', pw: 'plw', pa: 'pan', pg: 'png', py: 'pry', pe: 'per', ph: 'phl', pl: 'pol', pt: 'prt', qa: 'qat', ro: 'rou', ru: 'rus',
  rw: 'rwa', kn: 'kna', lc: 'lca', vc: 'vct', ws: 'wsm', sm: 'smr', st: 'stp', sa: 'sau', sn: 'sen', rs: 'srb', sc: 'syc', sl: 'sle', sg: 'sgp',
  sk: 'svk', si: 'svn', sb: 'slb', so: 'som', za: 'zaf', ss: 'ssd', es: 'esp', lk: 'lka', sd: 'sdn', sr: 'sur', se: 'swe', ch: 'che', sy: 'syr',
  tw: 'twn', tj: 'tjk', tz: 'tza', th: 'tha', tl: 'tls', tg: 'tgo', to: 'ton', tt: 'tto', tn: 'tun', tr: 'tur', tm: 'tkm', tv: 'tuv', ug: 'uga',
  ua: 'ukr', ae: 'are', gb: 'gbr', us: 'usa', uy: 'ury', uz: 'uzb', vu: 'vut', va: 'vat', ve: 'ven', vn: 'vnm', ye: 'yem', zm: 'zmb', zw: 'zwe',
  ps: 'pse', xk: 'xkx', hk: 'hkg', mo: 'mac', pr: 'pri', gl: 'grl', eh: 'esh',
};

const NAMES: Record<string, string[]> = {
  us: ['eeuu', 'ee uu', 'ee. uu.', 'e.e.u.u.', 'estados unidos de america', 'united states of america', 'america', 'u.s.', 'u.s.a.'],
  gb: ['uk', 'u.k.', 'inglaterra', 'england', 'escocia', 'scotland', 'gales', 'wales', 'irlanda del norte', 'northern ireland', 'gran bretana', 'great britain', 'britain', 'britania'],
  nl: ['holanda', 'holland', 'paises bajos'],
  ae: ['emiratos', 'uae', 'emiratos arabes unidos', 'emiratos arabes'],
  cz: ['chequia', 'czechia', 'republica checa'],
  mm: ['myanmar', 'birmania', 'burma'],
  mk: ['macedonia', 'macedonia del norte', 'north macedonia'],
  sz: ['suazilandia', 'swaziland', 'eswatini'],
  tr: ['turquia', 'turkey', 'turkiye'],
  kr: ['corea', 'south korea', 'corea del sur'],
  kp: ['corea', 'north korea', 'corea del norte'],
  ci: ['costa de marfil', 'ivory coast', 'cote d ivoire'],
  cd: ['rdc', 'drc', 'congo kinshasa', 'republica democratica del congo'],
  cg: ['congo brazzaville'],
  ru: ['rusia', 'russia'],
  de: ['alemania', 'germany', 'deutschland'],
  va: ['vaticano', 'santa sede', 'holy see'],
  cv: ['cabo verde', 'cape verde'],
  tl: ['timor', 'east timor', 'timor oriental'],
  by: ['bielorrusia', 'belarus', 'belorusia'],
  fm: ['micronesia'],
  mx: ['mejico'],
};

/** True when `q` (folded, non-empty) is an ISO3 code of the region or one of its alternative names. */
export function aliasMatches(regionId: string, q: string): boolean {
  if (!q) return false;
  if (ISO3[regionId] === q) return true;
  return (NAMES[regionId] ?? []).some((n) => n === q || (q.length >= 3 && n.includes(q)));
}
