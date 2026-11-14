#!/usr/bin/env node
// The donations counter, filled in at deploy time (.github/workflows/pages.yml, hourly and on every push) rather
// than in the visitor's browser: the site keeps loading nothing from other sites (site/privacy.html), and the
// explorers see one request a day from GitHub instead of one per visitor. It adds up what the addresses in
// donate.mjs have received from public block explorers, values it at today's price, writes site/donations.json
// (also read by the README's badge) and fills the <!--donations--> slot that build.mjs leaves in each page.
// It never fails the deploy: a source that doesn't answer keeps yesterday's figure from the live
// donations.json, and if there's none the counter is simply left out. At 0 € it shows 0 €.
// Run from the repo root: node scripts/site/donations.mjs [--dry-run]
// To try it with any public address: DONATE_BTC=bc1… DONATE_ETH=0x… node scripts/site/donations.mjs --dry-run

import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DONATE, EXCLUDE_TXS, USDC_ETHEREUM } from './donate.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SITE = join(ROOT, 'site');
const LIVE = 'https://nomad-pocket.app/donations.json';
const DRY = process.argv.includes('--dry-run');
const BTC = process.env.DONATE_BTC || DONATE.btc;
const ETH = (process.env.DONATE_ETH || DONATE.eth)?.toLowerCase() ?? null;
const SPONSORS = DONATE.githubSponsors;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The free explorers rate-limit quick paging (429) and now and then fail a request (5xx): wait and try again.
async function getJson(url, init) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(30_000),
      headers: { accept: 'application/json', ...init?.headers },
    });
    if (res.ok) return res.json();
    if ((res.status !== 429 && res.status < 500) || attempt === 4) throw new Error(`${res.status} ${url}`);
    await sleep(2000 * attempt);
  }
}

// Bitcoin received, in BTC: outputs paying the address, skipping transactions that spend from it (their
// outputs back to it are change, not gifts). Esplora API, 25 confirmed transactions per page.
async function btcReceived(addr) {
  for (const api of ['https://mempool.space/api', 'https://blockstream.info/api']) {
    try {
      let sats = 0n;
      let last = '';
      for (let page = 0; page < 400; page++) {
        const txs = await getJson(`${api}/address/${addr}/txs/chain${last ? '/' + last : ''}`);
        for (const tx of txs) {
          if (EXCLUDE_TXS.has(tx.txid)) continue;
          if (tx.vin.some((v) => v.prevout?.scriptpubkey_address === addr)) continue;
          for (const o of tx.vout) if (o.scriptpubkey_address === addr) sats += BigInt(o.value);
        }
        if (txs.length < 25) return Number(sats) / 1e8;
        last = txs.at(-1).txid;
        await sleep(300);
      }
      throw new Error('too many transactions');
    } catch (e) {
      console.warn(`btc via ${api}: ${e.message}`);
    }
  }
  return null;
}

// ETH (plain and internal transfers: exchanges often pay out from a contract) and USDC received on Ethereum
// mainnet: from Etherscan when the workflow has an ETHERSCAN_API_KEY secret (a free key covers mainnet), else
// from Blockscout's REST API, which needs no key (its Etherscan-style API does, in practice: it answers 429).
// Failed transfers and the address paying itself don't count.
async function ethReceived(addr) {
  try {
    const key = process.env.ETHERSCAN_API_KEY;
    const r = key ? await viaEtherscan(addr, key) : await viaBlockscout(addr);
    return { eth: Number(r.wei) / 1e18, usdc: Number(r.usdc) / 1e6 };
  } catch (e) {
    console.warn(`eth: ${e.message}`);
    return null;
  }
}

async function viaEtherscan(addr, key) {
  const list = async (params) => {
    const out = [];
    for (let page = 1; page <= 50; page++) {
      const q = new URLSearchParams({ module: 'account', address: addr, ...params, page: String(page), offset: '1000', sort: 'asc' });
      const r = await getJson(`https://api.etherscan.io/v2/api?chainid=1&apikey=${key}&${q}`);
      if (!Array.isArray(r.result)) throw new Error(`${params.action}: ${r.result || r.message}`);
      out.push(...r.result);
      if (r.result.length < 1000) return out;
      await sleep(400);
    }
    throw new Error(`${params.action}: too many transactions`);
  };
  const gift = (t) =>
    t.to?.toLowerCase() === addr && t.from?.toLowerCase() !== addr && t.isError !== '1' && !EXCLUDE_TXS.has(t.hash?.toLowerCase());
  const sum = (items) => items.filter(gift).reduce((n, t) => n + BigInt(t.value), 0n);
  // One after another: in parallel they trip the free tier's rate limit.
  const wei = sum(await list({ action: 'txlist' })) + sum(await list({ action: 'txlistinternal' }));
  const tokens = await list({ action: 'tokentx', contractaddress: USDC_ETHEREUM });
  return { wei, usdc: sum(tokens.filter((t) => t.contractAddress?.toLowerCase() === USDC_ETHEREUM)) };
}

async function viaBlockscout(addr) {
  const all = async (path) => {
    const out = [];
    let next = '';
    for (let page = 0; page < 100; page++) {
      const r = await getJson(`https://eth.blockscout.com/api/v2/addresses/${addr}/${path}${next}`);
      out.push(...r.items);
      if (!r.next_page_params) return out;
      next =
        '&' +
        new URLSearchParams(
          Object.entries(r.next_page_params)
            .filter(([, v]) => v != null)
            .map(([k, v]) => [k, String(v)]),
        );
      await sleep(400);
    }
    throw new Error(`${path}: too many transactions`);
  };
  const gift = (t) =>
    t.to?.hash?.toLowerCase() === addr &&
    t.from?.hash?.toLowerCase() !== addr &&
    !EXCLUDE_TXS.has((t.hash ?? t.transaction_hash)?.toLowerCase());
  const sum = (items, value) => items.filter(gift).reduce((n, t) => n + BigInt(value(t)), 0n);
  const txs = (await all('transactions?filter=to')).filter((t) => t.status === 'ok');
  const internal = (await all('internal-transactions?filter=to')).filter((t) => t.success !== false);
  const tokens = (await all(`token-transfers?type=ERC-20&filter=to&token=${USDC_ETHEREUM}`)).filter(
    (t) => t.token?.address_hash?.toLowerCase() === USDC_ETHEREUM,
  );
  return { wei: sum(txs, (t) => t.value) + sum(internal, (t) => t.value), usdc: sum(tokens, (t) => t.total.value) };
}

// Public count of the Sponsors profile's sponsors (amounts are private to the owner).
async function sponsorCount(user) {
  if (!process.env.GITHUB_TOKEN) return null;
  try {
    const r = await getJson('https://api.github.com/graphql', {
      method: 'POST',
      headers: { authorization: `bearer ${process.env.GITHUB_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ query: `query($u:String!){user(login:$u){sponsors(first:0){totalCount}}}`, variables: { u: user } }),
    });
    return r.data?.user?.sponsors?.totalCount ?? null;
  } catch (e) {
    console.warn(`sponsors: ${e.message}`);
    return null;
  }
}

async function prices() {
  try {
    const p = await getJson('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,usd-coin&vs_currencies=eur,usd');
    return { btc: p.bitcoin, eth: p.ethereum, usdc: p['usd-coin'] };
  } catch (e) {
    console.warn(`prices: ${e.message}`);
    return null;
  }
}

const live = await getJson(LIVE).catch(() => null);
const [btc, eth, sponsors, price] = await Promise.all([
  BTC ? btcReceived(BTC) : 0,
  ETH ? ethReceived(ETH) : { eth: 0, usdc: 0 },
  SPONSORS ? sponsorCount(SPONSORS) : 0,
  prices(),
]);
const data = {
  updated: new Date().toISOString().slice(0, 10),
  btc: btc ?? live?.btc ?? null,
  eth: eth?.eth ?? live?.eth ?? null,
  usdc: eth?.usdc ?? live?.usdc ?? null,
  sponsors: sponsors ?? live?.sponsors ?? null,
  prices: price ?? live?.prices ?? null,
};
// The sponsors count is a bonus: without it the line just leaves it out. Without a coin's figure there's no total.
const known = [data.btc, data.eth, data.usdc, data.prices].every((v) => v !== null);
if (known) {
  const value = (cur) => data.btc * data.prices.btc[cur] + data.eth * data.prices.eth[cur] + data.usdc * data.prices.usdc[cur];
  data.fiat = { eur: Math.round(value('eur')), usd: Math.round(value('usd')) };
  data.badge = { es: money('es', data.fiat.eur), en: money('en', data.fiat.usd) };
}

function money(lang, n) {
  return lang === 'es'
    ? new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n)
    : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
}

const COPY = {
  es: {
    raised: 'recibido en cripto',
    sponsors: (n) => `${n} ${n === 1 ? 'patrocinador' : 'patrocinadores'} en GitHub`,
    updated: 'actualizado el',
  },
  en: {
    raised: 'received in crypto',
    sponsors: (n) => `${n} GitHub ${n === 1 ? 'sponsor' : 'sponsors'}`,
    updated: 'updated',
  },
};

// Shown even at 0 € (the owner's call: it's honest to show nobody has given yet). Left out only when there's no figure.
function line(lang) {
  if (!known) return '';
  const t = COPY[lang];
  const num = (n, max) => new Intl.NumberFormat(lang === 'es' ? 'es-ES' : 'en-US', { maximumFractionDigits: max }).format(n);
  const coins = [
    [data.btc, 'BTC', 5],
    [data.eth, 'ETH', 4],
    [data.usdc, 'USDC', 0],
  ]
    .filter(([n]) => n > 0)
    .map(([n, sym, max]) => `${num(n, max)} ${sym}`);
  const parts = [];
  const total = lang === 'es' ? data.badge.es : data.badge.en;
  parts.push(`<b>${data.fiat.eur ? '≈ ' : ''}${total}</b> ${t.raised}${coins.length ? ` <span>(${coins.join(' · ')})</span>` : ''}`);
  if (data.sponsors) parts.push(t.sponsors(data.sponsors));
  const date = new Intl.DateTimeFormat(lang === 'es' ? 'es-ES' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(
    new Date(data.updated),
  );
  parts.push(`<time datetime="${data.updated}">${t.updated} ${date}</time>`);
  return parts.join(' · ');
}

console.log(JSON.stringify(data));
for (const [lang, rel] of [
  ['es', 'index.html'],
  ['en', 'en/index.html'],
]) {
  const html = line(lang);
  if (DRY) {
    console.log(`${lang}: ${html || '(no counter)'}`);
    continue;
  }
  const file = join(SITE, rel);
  writeFileSync(
    file,
    readFileSync(file, 'utf8').replace(/<!--donations-->[\s\S]*?<!--\/donations-->/, `<!--donations-->${html}<!--/donations-->`),
  );
}
if (!DRY) writeFileSync(join(SITE, 'donations.json'), JSON.stringify(data, null, 2) + '\n');

// The hourly run republishes the site only when the figures or the day changed (not for price moves alone), so
// the site isn't deployed 24 times a day for nothing. Pushes always deploy (the workflow ignores this then).
const changed = !live || ['btc', 'eth', 'usdc', 'sponsors', 'updated'].some((k) => live[k] !== data[k]);
console.log(`changed: ${changed}`);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `changed=${changed}\n`);
