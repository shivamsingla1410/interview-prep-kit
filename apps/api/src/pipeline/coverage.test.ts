import assert from 'node:assert/strict';
import test from 'node:test';
import { findUncoveredRequirements } from './coverage.js';
import type { Question, Requirement } from './types.js';

const requirements: Requirement[] = [
  { id: 'r1', text: 'Build APIs', kind: 'technical', priority: 'must' },
  { id: 'r2', text: 'Mentor teammates', kind: 'behavioural', priority: 'must' },
  { id: 'r3', text: 'Use a framework', kind: 'technical', priority: 'nice' },
];
function linkedQuestion(id: string, requirementId: string): Question {
  return { id, requirement_ids: [requirementId], category: 'technical', prompt: 'How?', answer_outline: 'Explain.', difficulty: 2, origin: 'generated', edited: false, pinned: false };
}

test('coverage checker returns requirements with no linked question, in requirement order', () => {
  const questions = [linkedQuestion('q1', 'r3'), linkedQuestion('q2', 'r1')];
  assert.deepEqual(findUncoveredRequirements(requirements, questions).map((requirement) => requirement.id), ['r2']);
});

test('coverage checker ignores unknown question links and reports every genuinely uncovered requirement', () => {
  const questions = [linkedQuestion('q1', 'not-a-requirement')];
  assert.deepEqual(findUncoveredRequirements(requirements, questions).map((requirement) => requirement.id), ['r1', 'r2', 'r3']);
  assert.deepEqual(findUncoveredRequirements(requirements, []), requirements);
});
