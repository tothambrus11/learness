#!/usr/bin/env node
/** MCP server for the French vocabulary list.
 *
 *  Lets an authenticated Claude session curate the words you collect in
 *  tutoring: read the list, add what came up in a lesson, correct a translation,
 *  drop something you no longer want.
 *
 *  The token it uses is deliberately scoped to `words`. Claude can shape the
 *  vocabulary; it cannot read your review history or touch scheduling state, so
 *  a mistake here costs you a word list edit, never your progress.
 *
 *  Configure with:
 *    FRCOG_API    https://frcog-sync.<you>.workers.dev
 *    FRCOG_TOKEN  a device token created with scope 'words'
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const API = (process.env.FRCOG_API || '').replace(/\/$/, '');
const TOKEN = process.env.FRCOG_TOKEN || '';

if (!API || !TOKEN) {
  console.error('Set FRCOG_API and FRCOG_TOKEN before starting frcog-mcp.');
  process.exit(1);
}

async function call(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      authorization: `Bearer ${TOKEN}`,
      'content-type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let body;
  try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
  if (!res.ok) throw new Error(body.error || `${res.status} ${res.statusText}`);
  return body;
}

const ok = (text) => ({ content: [{ type: 'text', text }] });

const wordKey = (french, pos) => `${french.trim().toLowerCase()}|${pos || 'unknown'}`;

const server = new McpServer({ name: 'frcog', version: '0.1.0' });

server.registerTool('list_words', {
  title: 'List my French words',
  description: 'Every word added by hand, from tutoring lessons or otherwise. '
    + 'Does not include the mined catalogue.',
  inputSchema: { includeDeleted: z.boolean().optional() },
}, async ({ includeDeleted }) => {
  const { words } = await call(`/v1/words${includeDeleted ? '?deleted=1' : ''}`);
  if (!words.length) return ok('The list is empty.');
  const lines = words.map((w) =>
    `${w.deleted ? '(removed) ' : ''}${w.fr || w.k}`
    + (w.en?.length ? ` — ${w.en.join(', ')}` : '')
    + (w.lesson ? `  [${w.lesson}]` : ''));
  return ok(`${words.length} words:\n${lines.join('\n')}`);
});

server.registerTool('add_words', {
  title: 'Add French words',
  description: 'Add or update words, typically the ones from a tutoring lesson. '
    + 'Adding a word that already exists updates it.',
  inputSchema: {
    words: z.array(z.object({
      french: z.string().describe('the French word, article included if it is a noun'),
      english: z.array(z.string()).optional().describe('accepted English translations'),
      pos: z.string().optional().describe('noun, verb, adj, adv, ...'),
      gender: z.enum(['m', 'f', 'mf']).optional(),
      note: z.string().optional(),
    })).min(1),
    lesson: z.string().optional().describe('label for the lesson these came from'),
  },
}, async ({ words, lesson }) => {
  const now = Date.now();
  const payload = words.map((w) => ({
    k: wordKey(w.french, w.pos),
    fr: w.french.trim(),
    en: w.english || [],
    pos: w.pos || 'unknown',
    gender: w.gender || '',
    note: w.note || '',
    lesson: lesson || '',
    source: 'mcp',
    updatedAt: now,
  }));
  const res = await call('/v1/words', { method: 'POST', body: JSON.stringify({ words: payload }) });
  return ok(`Added or updated ${res.written} words`
    + (lesson ? ` under "${lesson}"` : '')
    + `. They appear on your phone at the next sync.`);
});

server.registerTool('update_word', {
  title: 'Correct one word',
  description: 'Change the translations, part of speech, gender or note on a word already in the list.',
  inputSchema: {
    key: z.string().describe('the word key, as shown by list_words, e.g. "natel|noun"'),
    english: z.array(z.string()).optional(),
    pos: z.string().optional(),
    gender: z.enum(['m', 'f', 'mf']).optional(),
    note: z.string().optional(),
  },
}, async ({ key, ...fields }) => {
  const { words } = await call('/v1/words');
  const existing = words.find((w) => w.k === key);
  if (!existing) throw new Error(`no word with key ${key}; call list_words first`);
  const updated = { ...existing, updatedAt: Date.now() };
  if (fields.english) updated.en = fields.english;
  if (fields.pos) updated.pos = fields.pos;
  if (fields.gender) updated.gender = fields.gender;
  if (fields.note !== undefined) updated.note = fields.note;
  await call('/v1/words', { method: 'POST', body: JSON.stringify({ words: [updated] }) });
  return ok(`Updated ${updated.fr}.`);
});

server.registerTool('remove_word', {
  title: 'Remove a word',
  description: 'Take a word off the list. The removal syncs to your devices.',
  inputSchema: { key: z.string().describe('the word key, e.g. "natel|noun"') },
}, async ({ key }) => {
  await call(`/v1/words/${encodeURIComponent(key)}`, { method: 'DELETE' });
  return ok(`Removed ${key}.`);
});

server.registerTool('get_progress', {
  title: 'Progress summary',
  description: 'Counts only: how many words, cards, reviews and lessons exist. '
    + 'The review history itself is not readable through this server.',
  inputSchema: {},
}, async () => {
  const s = await call('/v1/progress');
  return ok(`${s.words} hand-added words, ${s.cards} scheduled cards, `
    + `${s.reviews} reviews recorded, ${s.lessons} lessons.`);
});

await server.connect(new StdioServerTransport());
