// Router inputs for fmbench (ROUTER_INSTRUCTIONS + buildRouterPrompt, as chats.ts sends them).
// `--map`: with the map rules appended, as the app does when maps are installed (MAP_ROUTER_RULES).
import { readFileSync, writeFileSync } from 'node:fs';
const rc = await import(new URL('../../src/features/assistant/rag-core.ts', import.meta.url).href);
const mc = await import(new URL('../../src/features/assistant/map-intent-core.ts', import.meta.url).href);
const files = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const map = process.argv.includes('--map');
const instructions = map ? `${rc.ROUTER_INSTRUCTIONS}\n\n${mc.MAP_ROUTER_RULES}` : rc.ROUTER_INSTRUCTIONS;
const qs = files.slice(0, -1).flatMap((f) => JSON.parse(readFileSync(f, 'utf8')));
writeFileSync(files[files.length - 1], qs.map((q: any) => JSON.stringify({ id: q.id, instructions, prompt: rc.buildRouterPrompt(q.q, []) })).join('\n') + '\n');
