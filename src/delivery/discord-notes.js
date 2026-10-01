/** Pure rendering functions: StructuredNotes + talk-time stats → Discord markdown. */

const LABELS = {
  en: {
    title: 'Meeting Notes', meeting: 'meeting', summary: 'TL;DR', topics: 'Topics',
    decisions: 'Decisions', questions: 'Open Questions', actions: 'Action Items',
    talktime: 'Talk Time', words: 'words', unassigned: 'Unassigned', none: 'None', continued: 'continued',
  },
  de: {
    title: 'Besprechungsnotizen', meeting: 'Besprechung', summary: 'Zusammenfassung', topics: 'Themen',
    decisions: 'Beschlüsse', questions: 'Offene Fragen', actions: 'Aufgaben',
    talktime: 'Redezeit', words: 'Wörter', unassigned: 'Nicht zugewiesen', none: 'Keine Angaben', continued: 'Fortsetzung',
  },
  es: {
    title: 'Acta de reunión', meeting: 'reunión', summary: 'Resumen', topics: 'Temas',
    decisions: 'Decisiones', questions: 'Preguntas abiertas', actions: 'Tareas',
    talktime: 'Tiempo de intervención', words: 'palabras', unassigned: 'Sin asignar', none: 'Sin datos', continued: 'continuación',
  },
  fr: {
    title: 'Compte rendu', meeting: 'réunion', summary: 'Résumé', topics: 'Sujets abordés',
    decisions: 'Décisions', questions: 'Questions ouvertes', actions: 'Actions à mener',
    talktime: 'Temps de parole', words: 'mots', unassigned: 'Non attribué', none: 'Aucun élément', continued: 'suite',
  },
  it: {
    title: 'Verbale della riunione', meeting: 'riunione', summary: 'Riepilogo', topics: 'Argomenti',
    decisions: 'Decisioni', questions: 'Domande aperte', actions: 'Azioni da svolgere',
    talktime: 'Tempo di parola', words: 'parole', unassigned: 'Non assegnato', none: 'Nessun elemento', continued: 'continuazione',
  },
  nl: {
    title: 'Notulen', meeting: 'vergadering', summary: 'Samenvatting', topics: 'Onderwerpen',
    decisions: 'Besluiten', questions: 'Open vragen', actions: 'Actiepunten',
    talktime: 'Spreektijd', words: 'woorden', unassigned: 'Niet toegewezen', none: 'Geen', continued: 'vervolg',
  },
  pt: {
    title: 'Ata da reunião', meeting: 'reunião', summary: 'Resumo', topics: 'Tópicos',
    decisions: 'Decisões', questions: 'Perguntas em aberto', actions: 'Ações pendentes',
    talktime: 'Tempo de fala', words: 'palavras', unassigned: 'Não atribuído', none: 'Nenhum item', continued: 'continuação',
  },
  ru: {
    title: 'Протокол встречи', meeting: 'встреча', summary: 'Краткое содержание', topics: 'Темы',
    decisions: 'Решения', questions: 'Открытые вопросы', actions: 'Задачи',
    talktime: 'Время выступления', words: 'слов', unassigned: 'Не назначено', none: 'Нет данных', continued: 'продолжение',
  },
  ja: {
    title: '会議メモ', meeting: '会議', summary: '要約', topics: '議題',
    decisions: '決定事項', questions: '未解決の質問', actions: 'アクション項目',
    talktime: '発言時間', words: '語', unassigned: '担当者未定', none: 'なし', continued: '続き',
  },
  zh: {
    title: '会议纪要', meeting: '会议', summary: '摘要', topics: '议题',
    decisions: '决定事项', questions: '待解答的问题', actions: '待办事项',
    talktime: '发言时长', words: '词', unassigned: '未分配', none: '暂无', continued: '续',
  },
};

const STATS_LABELS = {
  en: ['Meeting duration', 'Speakers', 'Total words'],
  de: ['Besprechungsdauer', 'Sprecher', 'Wörter insgesamt'],
  es: ['Duración de la reunión', 'Hablantes', 'Total de palabras'],
  fr: ['Durée de la réunion', 'Intervenants', 'Nombre total de mots'],
  it: ['Durata della riunione', 'Oratori', 'Parole totali'],
  nl: ['Vergaderduur', 'Sprekers', 'Totaal woorden'],
  pt: ['Duração da reunião', 'Oradores', 'Total de palavras'],
  ru: ['Длительность встречи', 'Выступающие', 'Всего слов'],
  ja: ['会議時間', '発言者数', '総語数'],
  zh: ['会议时长', '发言人数', '总词数'],
};

// Use localized units, including hours for long meetings.
function duration(ms, lang) {
  const seconds = Math.floor(ms / 1000);
  const units = [[Math.floor(seconds / 3600), 'hour'], [Math.floor(seconds / 60) % 60, 'minute'], [seconds % 60, 'second']];
  return units.filter(([value, unit]) => value || (seconds === 0 && unit === 'second'))
    .map(([value, unit]) => new Intl.NumberFormat(lang, { style: 'unit', unit, unitDisplay: 'short' }).format(value))
    .join(' ');
}

function language(meta) {
  return Object.hasOwn(LABELS, meta?.summaryLanguage) ? meta.summaryLanguage : 'en';
}

function meetingDate(value, lang) {
  const isoDate = /^\d{4}-\d{2}-\d{2}/.exec(value || '')?.[0];
  if (!isoDate) return value || '';
  const date = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : lang, {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  }).format(date);
}

/** Group action items by assignee, preserving insertion order. */
export function groupActionItems(actionItems) {
  const groups = new Map();
  for (const item of actionItems) {
    const key = item.assignee || 'Unassigned';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item.task);
  }
  return groups;
}

function sectionsFor(notes, talktime, meta = {}) {
  const lang = language(meta);
  const label = LABELS[lang];
  const date = meetingDate(meta.date, lang);
  const title = `# 📝 ${label.title} — ${meta.channelName || label.meeting}${date ? ` · ${date}` : ''}`;
  const sections = [{ heading: title, lines: [] }];
  sections.push({ heading: `## 📌 ${label.summary}`, lines: [notes.tldr || `_${label.none}_`] });

  if (notes.topics?.length) {
    const lines = [];
    for (const topic of notes.topics) {
      if (lines.length) lines.push('');
      lines.push(`**${topic.title}**`);
      for (const point of topic.points || []) lines.push(`- ${point}`);
    }
    sections.push({ heading: `## 💬 ${label.topics}`, lines, hasTopics: true });
  }
  if (notes.decisions?.length) {
    sections.push({ heading: `## ✅ ${label.decisions}`, lines: notes.decisions.map((d) => `- ${d}`) });
  }
  if (notes.openQuestions?.length) {
    sections.push({ heading: `## ❓ ${label.questions}`, lines: notes.openQuestions.map((q) => `- ${q}`) });
  }

  const actions = [];
  for (const [who, tasks] of groupActionItems(notes.actionItems || [])) {
    if (actions.length) actions.push('');
    const assignee = who === 'Unassigned' ? label.unassigned : who;
    for (const task of tasks) actions.push(`- **${assignee}:** ${task}`);
  }
  sections.push({ heading: `## 🎯 ${label.actions}`, lines: actions.length ? actions : [`_${label.none}_`] });

  const elapsed = Date.parse(meta.endedAt) - Date.parse(meta.date);
  const hasDuration = Number.isFinite(elapsed) && elapsed >= 0;
  if (talktime?.length || hasDuration) {
    const [meetingDuration, speakers, totalWords] = STATS_LABELS[lang];
    const lines = [];
    if (hasDuration) lines.push(`- **${meetingDuration}:** ${duration(elapsed, lang)}`);
    if (talktime?.length) {
      lines.push(`- **${speakers}:** ${talktime.length}`);
      lines.push(`- **${totalWords}:** ${talktime.reduce((sum, s) => sum + s.words, 0)}`);
      lines.push('');
      lines.push(...talktime.map((s) => {
        const time = Number.isFinite(s.ms) && s.ms >= 0 ? `${duration(s.ms, lang)} · ` : '';
        return `- ${s.displayName}: ${s.pct}% (${time}${s.words} ${label.words})`;
      }));
    }
    sections.push({ heading: `## 🎙️ ${label.talktime}`, lines });
  }
  return sections;
}

/** Render complete notes, also used by Markdown export. */
export function renderNotes(notes, talktime, meta = {}) {
  return sectionsFor(notes, talktime, meta)
    .map(({ heading, lines }) => [heading, ...lines].join('\n'))
    .join('\n\n');
}

/** Split Discord messages while repeating section and topic context on continuation. */
export function renderNotesChunks(notes, talktime, meta = {}, limit = 1900) {
  const continued = LABELS[language(meta)].continued;
  const sections = sectionsFor(notes, talktime, meta);
  const out = [];
  let current = '';
  const flush = () => { if (current) { out.push(current); current = ''; } };
  const fits = (text) => current.length + (current ? 1 : 0) + text.length <= limit;
  const add = (text) => { current += (current ? '\n' : '') + text; };

  for (const section of sections) {
    if (!section.lines.length) {
      if (section.heading.length > limit) return chunk(renderNotes(notes, talktime, meta), limit);
      if (!fits(section.heading)) flush();
      add(section.heading);
      continue;
    }

    let sectionStarted = false;
    let sectionInCurrent = false;
    let topic = null;
    let topicStarted = false;
    let topicInCurrent = false;
    let pendingBlank = current !== '';

    for (let i = 0; i < section.lines.length; i++) {
      const rawLine = section.lines[i];
      if (!rawLine) { pendingBlank = true; continue; }
      if (section.hasTopics && /^\*\*.*\*\*$/.test(rawLine)) {
        const next = section.lines.slice(i + 1).find(Boolean);
        topic = next && !/^\*\*.*\*\*$/.test(next) ? rawLine : null;
        topicStarted = false;
        topicInCurrent = false;
        pendingBlank = true;
        if (topic) continue;
      }

      let remaining = rawLine;
      do {
        const prefix = [];
        if (!sectionInCurrent) prefix.push(sectionStarted ? `${section.heading} (${continued})` : section.heading);
        if (topic && !topicInCurrent) {
          prefix.push(topicStarted ? `${topic.slice(0, -2)} (${continued})**` : topic);
        }
        const spacer = pendingBlank && current ? '\n' : '';
        const preamble = prefix.length ? `${spacer}${prefix.join('\n')}\n` : spacer;
        const room = limit - current.length - (current ? 1 : 0) - preamble.length;
        if (room <= 0) {
          if (!current) return chunk(renderNotes(notes, talktime, meta), limit);
          flush();
          sectionInCurrent = false;
          topicInCurrent = false;
          pendingBlank = false;
          continue;
        }
        if (remaining.length > room && current) {
          flush();
          sectionInCurrent = false;
          topicInCurrent = false;
          pendingBlank = false;
          continue;
        }

        if (spacer) add('');
        for (const line of prefix) add(line);
        const lastSpace = remaining.lastIndexOf(' ', room);
        const take = remaining.length <= room ? remaining.length : lastSpace > 0 ? lastSpace : room;
        add(remaining.slice(0, take));
        remaining = remaining.slice(take).trimStart();
        sectionStarted = sectionInCurrent = true;
        if (topic) topicStarted = topicInCurrent = true;
        pendingBlank = false;
        if (remaining) {
          flush();
          sectionInCurrent = false;
          topicInCurrent = false;
        }
      } while (remaining);
    }
  }
  flush();
  return out;
}

/** Split arbitrary text for Discord's 2000-character message cap. */
export function chunk(text, limit = 1900) {
  if (text.length <= limit) return [text];
  const out = [];
  let cur = '';
  const pushCur = () => { if (cur) { out.push(cur); cur = ''; } };
  for (const rawLine of text.split('\n')) {
    const segments = rawLine.length > limit ? rawLine.match(new RegExp(`.{1,${limit}}`, 'g')) : [rawLine];
    for (const line of segments) {
      if (cur.length + line.length + 1 > limit) {
        pushCur();
        cur = line;
      } else {
        cur = cur ? `${cur}\n${line}` : line;
      }
    }
  }
  pushCur();
  return out;
}
