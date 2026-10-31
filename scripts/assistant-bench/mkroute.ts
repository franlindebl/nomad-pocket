// Router inputs for fmbench (ROUTER_INSTRUCTIONS + buildRouterPrompt, as chats.ts sends them).
import { readFileSync, writeFileSync } from 'node:fs';
const rc = await import(new URL('../../src/features/assistant/rag-core.ts', import.meta.url).href);
const qs = JSON.parse(readFileSync(process.argv[2], 'utf8'));
writeFileSync(process.argv[3], qs.map((q: any) => JSON.stringify({ id: q.id, instructions: rc.ROUTER_INSTRUCTIONS, prompt: rc.buildRouterPrompt(q.q, []) })).join('\n') + '\n');
