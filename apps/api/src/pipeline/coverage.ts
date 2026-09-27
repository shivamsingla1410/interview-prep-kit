import type { Question, Requirement } from './types.js';

/** Return requirements that are not linked from any generated or user-authored question. */
export function findUncoveredRequirements(requirements: Requirement[], questions: Question[]): Requirement[] {
  const coveredIds = new Set(questions.flatMap((question) => question.requirement_ids));
  return requirements.filter((requirement) => !coveredIds.has(requirement.id));
}
