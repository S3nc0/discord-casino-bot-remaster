import { parseDuration } from './duration.ts';
import {
  DEFAULT_REWARD,
  MAX_CHOICE_LEN,
  MAX_EXPLANATION_LEN,
  MAX_MINUTES,
  MAX_QUESTIONS,
  MAX_QUESTION_LEN,
} from './pay.ts';

export interface ParsedQuestion {
  question: string;
  /** `choices[0]` is the correct answer. */
  choices: string[];
  explanation: string;
  reward: number;
  /** Open time in minutes, or null for the default / no limit. */
  minutes: number | null;
}

type Field = 'question' | 'right' | 'wrong' | 'explanation' | 'reward' | 'minutes';
const HEADINGS: [Field, string[]][] = [
  ['question', ['問題']],
  ['right', ['正解']],
  ['wrong', ['不正解']],
  ['explanation', ['解説']],
  ['reward', ['報酬']],
  ['minutes', ['期限', '時間']],
];

function heading(line: string): { field: Field; value: string } | null {
  const m = /^[「［[]?\s*([^:：]{1,4})\s*[」］\]]?\s*[:：]\s*(.*)$/.exec(line);
  if (!m) return null;
  const label = (m[1] as string).trim();
  for (const [field, names] of HEADINGS) {
    if (names.includes(label)) return { field, value: (m[2] as string).trim() };
  }
  return null;
}

export interface BulkResult {
  questions: ParsedQuestion[];
  errors: string[];
}

/**
 * Parse pasted quiz text. Blocks are separated by `---`, lines starting with `#` are comments.
 * Each block has `問題:`, `正解:`, three `不正解:` and optional `解説:`, `報酬:`, `期限:`.
 * Errors are collected for the whole text so an import is all-or-nothing.
 */
export function parseBulk(text: string): BulkResult {
  const errors: string[] = [];
  const questions: ParsedQuestion[] = [];
  const blocks: { lines: { no: number; text: string }[] }[] = [{ lines: [] }];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (line === '---') {
      blocks.push({ lines: [] });
      return;
    }
    if (line === '' || line.startsWith('#')) return;
    (blocks[blocks.length - 1] as { lines: { no: number; text: string }[] }).lines.push({
      no: i + 1,
      text: line,
    });
  });
  const used = blocks.filter((b) => b.lines.length > 0);
  used.forEach((block, idx) => {
    const n = idx + 1;
    const q: ParsedQuestion = {
      question: '',
      choices: [],
      explanation: '',
      reward: DEFAULT_REWARD,
      minutes: null,
    };
    const wrong: string[] = [];
    let right = '';
    let current: Field | null = null;
    let start = true;
    for (const { text: line } of block.lines) {
      const h = heading(line);
      if (h) {
        current = h.field;
        start = false;
        switch (h.field) {
          case 'question':
            q.question = h.value;
            break;
          case 'right':
            right = h.value;
            break;
          case 'wrong':
            wrong.push(h.value);
            break;
          case 'explanation':
            q.explanation = h.value;
            break;
          case 'reward': {
            const v = Number(h.value.normalize('NFKC').replace(/[,\s]/g, ''));
            if (!Number.isInteger(v) || v < 1)
              errors.push(`${n}問目: 「報酬:」は1以上の整数にしてください。`);
            else q.reward = v;
            break;
          }
          case 'minutes': {
            const v = parseDuration(h.value);
            if (v === null || v < 1 || v > MAX_MINUTES)
              errors.push(`${n}問目: 「期限:」の形式が正しくありません。`);
            else q.minutes = v;
            break;
          }
        }
      } else if (current === 'question') q.question += `\n${line}`;
      else if (current === 'explanation') q.explanation += `\n${line}`;
      else if (start) {
        const lineNo = block.lines.find((l) => l.text === line)?.no ?? 0;
        errors.push(`${n}問目: ${lineNo}行目: 「問題:」「正解:」などの見出しで始めてください。`);
      } else errors.push(`${n}問目: 見出しのない行があります。`);
    }
    if (q.question === '') errors.push(`${n}問目: 「問題:」がありません。`);
    else if ([...q.question].length > MAX_QUESTION_LEN)
      errors.push(`${n}問目: 問題が長すぎます（${MAX_QUESTION_LEN}文字まで）。`);
    if (right === '') errors.push(`${n}問目: 「正解:」がありません。`);
    if (wrong.length !== 3)
      errors.push(`${n}問目: 「不正解:」は3つ必要です（いま${wrong.length}つ）。`);
    q.choices = [right, ...wrong].filter((c) => c !== '');
    if (q.choices.some((c) => [...c].length > MAX_CHOICE_LEN))
      errors.push(`${n}問目: 選択肢が長すぎます（${MAX_CHOICE_LEN}文字まで）。`);
    if (new Set(q.choices).size !== q.choices.length)
      errors.push(`${n}問目: 同じ選択肢があります。`);
    if ([...q.explanation].length > MAX_EXPLANATION_LEN)
      errors.push(`${n}問目: 解説が長すぎます（${MAX_EXPLANATION_LEN}文字まで）。`);
    questions.push(q);
  });
  if (used.length === 0) errors.push('問題が見つかりません。');
  if (used.length > MAX_QUESTIONS) errors.push(`一度に取り込めるのは${MAX_QUESTIONS}問までです。`);
  const seen = new Set<string>();
  for (const q of questions) {
    if (q.question !== '' && seen.has(q.question))
      errors.push(`同じ問題が重複しています: ${q.question.slice(0, 20)}`);
    seen.add(q.question);
  }
  return { questions, errors };
}
