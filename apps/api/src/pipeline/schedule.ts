import type { Question, Requirement } from './types.js';

/** Deterministically distribute every question over exactly the requested number of days. */
export function allocateSchedule(questions: Question[], requirements: Requirement[], days: number) {
  const mustIds = new Set(requirements.filter((requirement) => requirement.priority === 'must').map((requirement) => requirement.id));
  const sorted = [...questions].sort((a, b) =>
    Number(b.requirement_ids.some((id) => mustIds.has(id))) - Number(a.requirement_ids.some((id) => mustIds.has(id))) ||
    b.difficulty - a.difficulty || a.id.localeCompare(b.id),
  );
  const bins = Array.from({ length: days }, () => [] as Question[]);
  sorted.forEach((question, index) => bins[index % days].push(question));
  return {
    days_available: days,
    days: bins.map((items, index) => ({
      day: index + 1,
      focus: items.length ? [...new Set(items.map((item) => item.category.replace('-', ' ')))].join(' + ') : index === days - 1 ? 'Review and confidence check' : 'Review core requirements',
      question_ids: items.map((item) => item.id),
      minutes: Math.max(30, items.reduce((sum, item) => sum + 20 + item.difficulty * 10, 0)),
    })),
  };
}
