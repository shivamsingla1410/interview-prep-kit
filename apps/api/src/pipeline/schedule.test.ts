import assert from 'node:assert/strict';
import test from 'node:test';
import { allocateSchedule } from './schedule.js';
import type { Question, Requirement } from './types.js';

const requirements: Requirement[] = [
  { id: 'must-1', text: 'Design APIs', kind: 'technical', priority: 'must' },
  { id: 'must-2', text: 'Debug services', kind: 'technical', priority: 'must' },
  { id: 'nice-1', text: 'Know a framework', kind: 'technical', priority: 'nice' },
];
function question(id: string, requirementId: string, difficulty: 1 | 2 | 3): Question {
  return { id, requirement_ids: [requirementId], category: 'technical', prompt: `Question ${id}`, answer_outline: 'Explain the approach.', difficulty, origin: 'generated', edited: false, pinned: false };
}

test('schedule has exactly the requested consecutive days and assigns every question once', () => {
  const questions = [question('q1', 'must-1', 3), question('q2', 'must-2', 1), question('q3', 'nice-1', 2), question('q4', 'nice-1', 1)];
  const schedule = allocateSchedule(questions, requirements, 6);
  assert.equal(schedule.days_available, 6);
  assert.deepEqual(schedule.days.map((day) => day.day), [1, 2, 3, 4, 5, 6]);
  const assigned = schedule.days.flatMap((day) => day.question_ids);
  assert.deepEqual([...assigned].sort(), questions.map((item) => item.id).sort());
  assert.equal(new Set(assigned).size, questions.length);
  assert.ok(schedule.days.every((day) => Number.isInteger(day.minutes) && day.minutes >= 30));
  assert.deepEqual(schedule.days.slice(4).map((day) => day.question_ids), [[], []]);
});

test('schedule orders must-have and harder questions first before round-robin distribution', () => {
  const questions = [question('q-nice-hard', 'nice-1', 3), question('q-must-easy', 'must-2', 1), question('q-must-hard', 'must-1', 3), question('q-nice-easy', 'nice-1', 1)];
  const schedule = allocateSchedule(questions, requirements, 2);
  assert.equal(schedule.days[0].question_ids[0], 'q-must-hard');
  assert.equal(schedule.days[1].question_ids[0], 'q-must-easy');
  assert.deepEqual(schedule.days.map((day) => day.question_ids), [['q-must-hard', 'q-nice-hard'], ['q-must-easy', 'q-nice-easy']]);
});
