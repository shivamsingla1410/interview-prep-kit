import { z } from 'zod';

export const requirementSchema = z.object({
  id: z.string().min(1), text: z.string().min(1),
  kind: z.enum(['technical', 'behavioural', 'domain']),
  priority: z.enum(['must', 'nice']),
});
const questionCategorySchema = z.enum(['technical', 'behavioural', 'system-design', 'company-fit']);
export const questionSchema = z.object({
  id: z.string().min(1), requirement_ids: z.array(z.string()),
  category: questionCategorySchema,
  prompt: z.string().min(1), answer_outline: z.string().min(1), difficulty: z.number().int().min(1).max(3),
  origin: z.enum(['generated', 'manual']).default('generated'), edited: z.boolean().default(false), pinned: z.boolean().default(false),
});
export const flashcardSchema = z.object({
  id: z.string().min(1), front: z.string().min(1), back: z.string().min(1), requirement_ids: z.array(z.string()),
  origin: z.enum(['generated', 'manual']).default('generated'), edited: z.boolean().default(false), pinned: z.boolean().default(false),
});
export const companyBriefSchema = z.object({
  summary: z.string(), what_they_do: z.string(), sources: z.array(z.string()), edited: z.boolean().default(false),
});
export const kitSchema = z.object({
  source: z.object({ company: z.string(), company_url: z.string(), role: z.string(), location: z.string(), jd_chars: z.number().int(), researched_at: z.string(), pages_used: z.array(z.string()) }),
  company_brief: companyBriefSchema,
  role: z.object({ title: z.string(), seniority: z.string(), responsibilities: z.array(z.string()), requirements: z.array(requirementSchema) }),
  questions: z.array(questionSchema),
  flashcards: z.array(flashcardSchema),
  schedule: z.object({ days_available: z.number().int().min(1).max(60), days: z.array(z.object({ day: z.number().int(), focus: z.string(), question_ids: z.array(z.string()), minutes: z.number().int() })) }),
  coverage: z.object({ uncovered_requirement_ids: z.array(z.string()), passes: z.number().int().min(1) }),
}).superRefine((kit, context) => {
  const requirementIds = new Set(kit.role.requirements.map((requirement) => requirement.id));
  const questionIds = new Set(kit.questions.map((question) => question.id));
  if (kit.schedule.days.length !== kit.schedule.days_available) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['schedule', 'days'], message: 'Schedule must contain exactly days_available entries.' });
  }
  kit.schedule.days.forEach((day, index) => {
    if (day.day !== index + 1) context.addIssue({ code: z.ZodIssueCode.custom, path: ['schedule', 'days', index, 'day'], message: 'Schedule days must be numbered consecutively from 1.' });
    day.question_ids.forEach((id, questionIndex) => {
      if (!questionIds.has(id)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['schedule', 'days', index, 'question_ids', questionIndex], message: `Schedule references unknown question id: ${id}.` });
    });
  });
  kit.questions.forEach((question, questionIndex) => {
    question.requirement_ids.forEach((id, requirementIndex) => {
      if (!requirementIds.has(id)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['questions', questionIndex, 'requirement_ids', requirementIndex], message: `Question references unknown requirement id: ${id}.` });
    });
  });
  kit.coverage.uncovered_requirement_ids.forEach((id, index) => {
    if (!requirementIds.has(id)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['coverage', 'uncovered_requirement_ids', index], message: `Coverage references unknown requirement id: ${id}.` });
  });
});
export type Requirement = z.infer<typeof requirementSchema>;
export type Question = z.infer<typeof questionSchema>;
export type Flashcard = z.infer<typeof flashcardSchema>;
export type CompanyBrief = z.infer<typeof companyBriefSchema>;
export type KitDocument = z.infer<typeof kitSchema>;

export type SourceGap = { source: string; reason: string };
export type Research = { pages: Array<{ url: string; text: string }>; pagesUsed: string[]; gaps: SourceGap[]; companyName: string };
