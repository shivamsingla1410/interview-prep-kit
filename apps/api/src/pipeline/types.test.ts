import assert from 'node:assert/strict';
import test from 'node:test';
import { kitSchema } from './types.js';

const appendixAKit = {
  source: { company: 'Example Co', company_url: 'https://example.test', role: 'Engineer', location: 'Remote', jd_chars: 100, researched_at: '2026-09-27T00:00:00.000Z', pages_used: ['https://example.test/about'] },
  company_brief: { summary: 'A company.', what_they_do: 'Builds tools.', sources: ['https://example.test/about'] },
  role: { title: 'Engineer', seniority: 'Mid-level', responsibilities: ['Build APIs'], requirements: [{ id: 'r1', text: 'Build APIs', kind: 'technical', priority: 'must' }] },
  questions: [{ id: 'q1', requirement_ids: ['r1'], category: 'technical', prompt: 'How would you design an API?', answer_outline: 'Discuss constraints and trade-offs.', difficulty: 2 }],
  flashcards: [{ id: 'f1', front: 'What is an API?', back: 'A defined interface.', requirement_ids: ['r1'] }],
  schedule: { days_available: 1, days: [{ day: 1, focus: 'technical', question_ids: ['q1'], minutes: 60 }] },
  coverage: { uncovered_requirement_ids: [], passes: 2 },
};

test('Appendix A kit fields and allowed values validate, with editor provenance defaults', () => {
  const parsed = kitSchema.parse(appendixAKit);
  assert.deepEqual(Object.keys(parsed).sort(), ['company_brief', 'coverage', 'flashcards', 'questions', 'role', 'schedule', 'source']);
  assert.equal(parsed.questions[0].origin, 'generated');
  assert.equal(parsed.questions[0].edited, false);
  assert.equal(parsed.flashcards[0].pinned, false);
});

test('Appendix A validator rejects misspelled required fields, invalid enums, and non-integer values', () => {
  const misspelled = structuredClone(appendixAKit);
  (misspelled.source as Record<string, unknown>).company_url = undefined;
  (misspelled.source as Record<string, unknown>).companyUrl = 'https://example.test';
  assert.equal(kitSchema.safeParse(misspelled).success, false);

  const invalid = structuredClone(appendixAKit);
  (invalid.questions[0] as Record<string, unknown>).difficulty = 4;
  (invalid.role.requirements[0] as Record<string, unknown>).priority = 'critical';
  (invalid.schedule.days[0] as Record<string, unknown>).minutes = 30.5;
  assert.equal(kitSchema.safeParse(invalid).success, false);
});

test('Appendix A validator rejects wrong schedule length and dangling IDs', () => {
  const invalid = structuredClone(appendixAKit);
  invalid.schedule.days[0].question_ids = ['missing-question'];
  invalid.questions[0].requirement_ids = ['missing-requirement'];
  assert.equal(kitSchema.safeParse(invalid).success, false);

  const wrongDayCount = structuredClone(appendixAKit);
  wrongDayCount.schedule.days_available = 2;
  assert.equal(kitSchema.safeParse(wrongDayCount).success, false);
});
