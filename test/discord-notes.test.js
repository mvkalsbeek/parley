import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderNotes, renderNotesChunks, groupActionItems, chunk } from '../src/delivery/discord-notes.js';
import { LANGUAGES } from '../src/adapters/summarizer/languages.js';
import { postNotes } from '../src/delivery/post.js';

const notes = {
  tldr: 'We discussed the launch.',
  topics: [{ title: 'Launch', points: ['date set', 'owners assigned'] }],
  decisions: ['Launch on Friday'],
  openQuestions: ['Who writes the post?'],
  actionItems: [
    { assignee: 'Alice', task: 'finish API' },
    { assignee: 'Alice', task: 'write tests' },
    { assignee: null, task: 'book venue' },
  ],
};
const talktime = [{ displayName: 'Alice', ms: 60000, words: 120, pct: 75 }, { displayName: 'Bob', ms: 20000, words: 40, pct: 25 }];

test('talk time includes recorded duration, speakers, words and individual durations', () => {
  const meta = { date: '2026-10-01T10:00:00Z', endedAt: '2026-10-01T11:02:03Z', summaryLanguage: 'nl' };
  const md = renderNotes(notes, talktime, meta);
  assert.match(md, /\*\*Vergaderduur:\*\* 1 uur 2 min 3 sec/);
  assert.match(md, /\*\*Sprekers:\*\* 2/);
  assert.match(md, /\*\*Totaal woorden:\*\* 160/);
  assert.match(md, /Alice: 75% \(1 min · 120 woorden\)/);
  assert.match(md, /Bob: 25% \(20 sec · 40 woorden\)/);
  const chunks = renderNotesChunks(notes, talktime, meta, 180);
  assert.ok(chunks.every((part) => part.length <= 180));
  assert.equal(chunks.filter((part) => part.includes('Vergaderduur')).length, 1);
});

test('missing or invalid meeting timestamps never produce a guessed duration', () => {
  for (const endedAt of [undefined, 'invalid', '2026-10-01T09:59:59Z']) {
    const md = renderNotes(notes, talktime, { date: '2026-10-01T10:00:00Z', endedAt });
    assert.doesNotMatch(md, /Meeting duration|NaN/);
    assert.match(md, /Total words/);
  }
});

test('duration remains visible without speaker data and supports zero duration', () => {
  const md = renderNotes(notes, [], { date: '2026-10-01T10:00:00Z', endedAt: '2026-10-01T10:00:00Z' });
  assert.match(md, /Meeting duration:\*\* 0 sec/);
  assert.doesNotMatch(md, /Speakers|Total words/);
});

test('Discord delivery passes the recorded end time to the rendered messages', async () => {
  const sent = [];
  await postNotes({
    client: { channels: { fetch: async () => ({ send: async (text) => sent.push(text) }) } },
    meeting: { channel_id: 'voice', channel_name: 'Crew', started_at: '2026-10-01T10:00:00Z', ended_at: '2026-10-01T10:45:00Z' },
    cfg: { summaryLanguage: 'nl' }, notes, talktime,
  });
  assert.match(sent.join('\n'), /\*\*Vergaderduur:\*\* 45 min/);
  assert.ok(sent.every((part) => part.length <= 1900));
});

test('groupActionItems groups by assignee with Unassigned bucket', () => {
  const g = groupActionItems(notes.actionItems);
  assert.deepEqual(g.get('Alice'), ['finish API', 'write tests']);
  assert.deepEqual(g.get('Unassigned'), ['book venue']);
});

test('renderNotes includes all sections and per-person tasks', () => {
  const md = renderNotes(notes, talktime, { channelName: 'general', date: '2026-06-04' });
  assert.match(md, /We discussed the launch/);
  assert.match(md, /Launch on Friday/);
  assert.match(md, /Who writes the post/);
  assert.match(md, /- \*\*Alice:\*\* finish API/);
  assert.match(md, /finish API/);
  assert.match(md, /Unassigned/);
  assert.match(md, /Alice.*75%/s);
  assert.match(md, /Meeting Notes — general · 4 June 2026/);
  assert.doesNotMatch(md, /\[ \]/);
});

test('Dutch notes use Dutch labels and a readable meeting date', () => {
  const md = renderNotes(notes, talktime, {
    channelName: 'Crew Voice 1', date: '2026-09-23T18:34:10.512Z', summaryLanguage: 'nl',
  });
  assert.match(md, /^# 📝 Notulen — Crew Voice 1 · 23 september 2026/m);
  assert.match(md, /## 💬 Onderwerpen/);
  assert.match(md, /## 🎯 Actiepunten/);
  assert.match(md, /\*\*Niet toegewezen:\*\* book venue/);
  assert.match(md, /120 woorden/);
  assert.doesNotMatch(md, /T18:34/);
});

test('every supported summary language has localized Discord labels and continuations', () => {
  const expected = {
    de: ['Besprechungsnotizen', 'Themen', 'Aufgaben', 'Nicht zugewiesen', 'Fortsetzung'],
    en: ['Meeting Notes', 'Topics', 'Action Items', 'Unassigned', 'continued'],
    es: ['Acta de reunión', 'Temas', 'Tareas', 'Sin asignar', 'continuación'],
    fr: ['Compte rendu', 'Sujets abordés', 'Actions à mener', 'Non attribué', 'suite'],
    it: ['Verbale della riunione', 'Argomenti', 'Azioni da svolgere', 'Non assegnato', 'continuazione'],
    pt: ['Ata da reunião', 'Tópicos', 'Ações pendentes', 'Não atribuído', 'continuação'],
    nl: ['Notulen', 'Onderwerpen', 'Actiepunten', 'Niet toegewezen', 'vervolg'],
    ru: ['Протокол встречи', 'Темы', 'Задачи', 'Не назначено', 'продолжение'],
    ja: ['会議メモ', '議題', 'アクション項目', '担当者未定', '続き'],
    zh: ['会议纪要', '议题', '待办事项', '未分配', '续'],
  };
  assert.deepEqual(Object.keys(expected).sort(), LANGUAGES.map(({ code }) => code).sort());

  const longNotes = {
    ...notes,
    topics: [{ title: 'Launch', points: Array.from({ length: 12 }, (_, i) => `Point ${i}: ${'details '.repeat(6)}`) }],
  };
  for (const [code, [title, topics, actions, unassigned, continued]] of Object.entries(expected)) {
    const meta = { channelName: 'Crew', date: '2026-09-23T18:34:10.512Z', summaryLanguage: code };
    const md = renderNotes(notes, talktime, meta);
    assert.ok(md.includes(`# 📝 ${title} — Crew · `), code);
    assert.ok(md.includes(`## 💬 ${topics}`), code);
    assert.ok(md.includes(`## 🎯 ${actions}`), code);
    assert.ok(md.includes(`**${unassigned}:**`), code);
    assert.ok(!md.includes('T18:34'), code);

    const parts = renderNotesChunks(longNotes, [], meta, 250);
    assert.ok(parts.every((part) => part.length <= 250), code);
    assert.ok(parts.some((part) => part.includes(`(${continued})`)), code);
  }
});

test('an unresolved summary language falls back to English labels', () => {
  const md = renderNotes(notes, [], { summaryLanguage: 'auto', date: '2026-09-23' });
  assert.match(md, /## 💬 Topics/);
  assert.match(md, /## 🎯 Action Items/);
});

test('long topics repeat their context when Discord messages split', () => {
  const longNotes = {
    tldr: 'We planned the event.',
    topics: [{ title: 'Event logistics', points: Array.from({ length: 8 }, (_, i) => `Point ${i + 1}: ${'details '.repeat(5).trim()}`) }],
    decisions: ['Proceed'], openQuestions: [], actionItems: [],
  };
  const parts = renderNotesChunks(longNotes, [], {
    channelName: 'Crew', date: '2026-09-23', summaryLanguage: 'nl',
  }, 180);
  assert.ok(parts.length > 1);
  assert.ok(parts.every((part) => part.length <= 180));
  assert.ok(parts.some((part) => part.includes('**Event logistics (vervolg)**')));
  assert.ok(parts.every((part) => !part.trimEnd().endsWith('## 💬 Onderwerpen')));
  for (let i = 1; i <= 8; i++) {
    assert.equal(parts.filter((part) => part.includes(`Point ${i}:`)).length, 1);
  }
});

test('topics without points and oversized lines remain deliverable', () => {
  const longNotes = {
    tldr: 'Short summary',
    topics: [{ title: 'Unresolved topic', points: [] }, { title: 'Details', points: ['Z'.repeat(2400)] }],
    decisions: [], openQuestions: [], actionItems: [],
  };
  const parts = renderNotesChunks(longNotes, [], { channelName: 'Crew', date: '2026-09-23' });
  assert.ok(parts.every((part) => part.length <= 1900));
  assert.ok(parts.some((part) => part.includes('**Unresolved topic**')));
  assert.equal(parts.join('').split('Z').length - 1, 2400);
});

test('chunk splits text under the limit on newlines', () => {
  const parts = chunk('a\nb\nc', 3);
  assert.ok(parts.every((p) => p.length <= 3));
  assert.equal(parts.join('\n'), 'a\nb\nc');
});

test('chunk hard-splits a single line longer than the limit', () => {
  const long = 'x'.repeat(25);
  const parts = chunk(long, 10);
  assert.ok(parts.every((p) => p.length <= 10));
  assert.equal(parts.join(''), long);
});

test('renderNotes omits empty optional sections but keeps Action Items', () => {
  const md = renderNotes(
    { tldr: 'hi', topics: [], decisions: [], openQuestions: [], actionItems: [] },
    [],
    { channelName: 'g', date: 'd' }
  );
  assert.doesNotMatch(md, /## 💬 Topics/);
  assert.doesNotMatch(md, /## ✅ Decisions/);
  assert.doesNotMatch(md, /## ❓ Open Questions/);
  assert.doesNotMatch(md, /## 🎙️ Talk Time/);
  assert.match(md, /## 🎯 Action Items/);
  assert.match(md, /_None_/);
});

test('chunk leaves short text as a single piece', () => {
  assert.deepEqual(chunk('short', 1900), ['short']);
});
