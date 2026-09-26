import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { Kit } from './models.js';
import { kitSchema, type Flashcard, type KitDocument, type Question } from './pipeline/types.js';
import { mergeRegeneratedCategory, regenerateKitSection } from './pipeline/generation.js';

export const kitEditingRouter = Router();

const category = z.enum(['technical', 'behavioural', 'system-design', 'company-fit']);
const questionOperation = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('edit'), id: z.string().min(1), prompt: z.string().trim().min(1).max(600).optional(), answer_outline: z.string().trim().min(1).max(1600).optional(), difficulty: z.number().int().min(1).max(3).optional() }).strict(),
  z.object({ operation: z.literal('move'), id: z.string().min(1), category }).strict(),
  z.object({ operation: z.literal('pin'), id: z.string().min(1), pinned: z.boolean() }).strict(),
  z.object({ operation: z.literal('delete'), id: z.string().min(1) }).strict(),
  z.object({ operation: z.literal('add'), prompt: z.string().trim().min(1).max(600), answer_outline: z.string().trim().min(1).max(1600), difficulty: z.number().int().min(1).max(3), category }).strict(),
  z.object({ operation: z.literal('reorder'), ids: z.array(z.string().min(1)).max(200) }).strict(),
]).refine((value) => value.operation !== 'edit' || value.prompt !== undefined || value.answer_outline !== undefined || value.difficulty !== undefined, 'Provide at least one field to edit.');
const flashcardOperation = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('edit'), id: z.string().min(1), front: z.string().trim().min(1).max(500).optional(), back: z.string().trim().min(1).max(1600).optional() }).strict(),
  z.object({ operation: z.literal('pin'), id: z.string().min(1), pinned: z.boolean() }).strict(),
  z.object({ operation: z.literal('delete'), id: z.string().min(1) }).strict(),
  z.object({ operation: z.literal('add'), front: z.string().trim().min(1).max(500), back: z.string().trim().min(1).max(1600) }).strict(),
]).refine((value) => value.operation !== 'edit' || value.front !== undefined || value.back !== undefined, 'Provide at least one field to edit.');
const regenerateRequest = z.object({ section: z.enum(['company_brief', 'questions', 'schedule']), category: category.optional() }).strict().refine((value) => (value.section === 'questions') === (value.category !== undefined), 'A category is required only when regenerating questions.');

class EditRequestError extends Error { constructor(readonly status: number, message: string) { super(message); } }

async function changeKitContent(kitId: string, userId: string, apply: (content: KitDocument, current: any) => { sourceGaps?: unknown[] } | void) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const current = await Kit.findOne({ _id: kitId, userId });
    if (!current) throw new EditRequestError(404, 'Preparation not found.');
    if (current.status !== 'ready' || !current.generatedKit) throw new EditRequestError(409, 'This kit is not ready to edit yet.');
    const content = kitSchema.parse(current.generatedKit);
    const extra = apply(content, current);
    const setFields: Record<string, unknown> = { generatedKit: content };
    if (extra?.sourceGaps) setFields.sourceGaps = extra.sourceGaps;
    const updated = await Kit.findOneAndUpdate(
      { _id: kitId, userId, __v: current.__v ?? 0 },
      { $set: setFields, $inc: { __v: 1 } },
      { new: true },
    ).select('title companyUrl jobDescription daysAvailable status generationProgress generationError sourceGaps generatedKit regeneration practiceProgress createdAt');
    if (updated) return updated;
  }
  throw new EditRequestError(409, 'The kit changed while saving. Please try that edit again.');
}

function applyQuestionOperation(questions: Question[], operation: z.infer<typeof questionOperation>) {
  if (operation.operation === 'add') {
    questions.push({ id: `q-${randomUUID()}`, requirement_ids: [], category: operation.category, prompt: operation.prompt, answer_outline: operation.answer_outline, difficulty: operation.difficulty, origin: 'manual', edited: false, pinned: true });
    return;
  }
  if (operation.operation === 'reorder') {
    const byId = new Map(questions.map((question) => [question.id, question]));
    const reordered = operation.ids.flatMap((id) => { const question = byId.get(id); if (!question) return []; byId.delete(id); return [question]; });
    questions.splice(0, questions.length, ...reordered, ...byId.values());
    return;
  }
  const index = questions.findIndex((question) => question.id === operation.id);
  if (index < 0) throw new EditRequestError(404, 'Question not found.');
  if (operation.operation === 'delete') { questions.splice(index, 1); return; }
  if (operation.operation === 'pin') { questions[index].pinned = operation.pinned; return; }
  if (operation.operation === 'move') { questions[index].category = operation.category; questions[index].edited = true; return; }
  questions[index] = { ...questions[index], ...(operation.prompt !== undefined ? { prompt: operation.prompt } : {}), ...(operation.answer_outline !== undefined ? { answer_outline: operation.answer_outline } : {}), ...(operation.difficulty !== undefined ? { difficulty: operation.difficulty } : {}), edited: true };
}

function applyFlashcardOperation(flashcards: Flashcard[], operation: z.infer<typeof flashcardOperation>) {
  if (operation.operation === 'add') {
    flashcards.push({ id: `f-${randomUUID()}`, front: operation.front, back: operation.back, requirement_ids: [], origin: 'manual', edited: false, pinned: true });
    return;
  }
  const index = flashcards.findIndex((flashcard) => flashcard.id === operation.id);
  if (index < 0) throw new EditRequestError(404, 'Flashcard not found.');
  if (operation.operation === 'delete') { flashcards.splice(index, 1); return; }
  if (operation.operation === 'pin') { flashcards[index].pinned = operation.pinned; return; }
  flashcards[index] = { ...flashcards[index], ...(operation.front !== undefined ? { front: operation.front } : {}), ...(operation.back !== undefined ? { back: operation.back } : {}), edited: true };
}

function reconcileQuestionReferences(content: KitDocument) {
  const questionIds = new Set(content.questions.map((question) => question.id));
  content.schedule.days = content.schedule.days.map((day) => ({ ...day, question_ids: day.question_ids.filter((id) => questionIds.has(id)) }));
  content.coverage.uncovered_requirement_ids = content.role.requirements.filter((requirement) => !content.questions.some((question) => question.requirement_ids.includes(requirement.id))).map((requirement) => requirement.id);
}

function ownerId(req: any) { return req.session.userId as string; }
function requireSession(req: any, res: any) {
  if (!req.session.userId) { res.status(401).json({ error: 'UNAUTHENTICATED', message: 'Please sign in.' }); return false; }
  return true;
}
function sendError(res: any, error: unknown) {
  if (error instanceof EditRequestError) return res.status(error.status).json({ error: 'KIT_EDIT_ERROR', message: error.message });
  if (error instanceof z.ZodError) return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'The submitted kit content is invalid.', fields: error.flatten().fieldErrors });
  throw error;
}

kitEditingRouter.patch('/:id/questions', async (req, res, next) => {
  if (!requireSession(req, res)) return;
  const parsed = questionOperation.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Check the question details.', fields: parsed.error.flatten().fieldErrors });
  try { res.json({ kit: await changeKitContent(req.params.id, ownerId(req), (content) => { applyQuestionOperation(content.questions, parsed.data); reconcileQuestionReferences(content); }) }); }
  catch (error) { try { sendError(res, error); } catch (unexpected) { next(unexpected); } }
});

kitEditingRouter.patch('/:id/flashcards', async (req, res, next) => {
  if (!requireSession(req, res)) return;
  const parsed = flashcardOperation.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Check the flashcard details.', fields: parsed.error.flatten().fieldErrors });
  try { res.json({ kit: await changeKitContent(req.params.id, ownerId(req), (content) => { applyFlashcardOperation(content.flashcards, parsed.data); }) }); }
  catch (error) { try { sendError(res, error); } catch (unexpected) { next(unexpected); } }
});

kitEditingRouter.patch('/:id/company-brief', async (req, res, next) => {
  if (!requireSession(req, res)) return;
  const parsed = z.object({ summary: z.string().trim().min(1).max(2000), what_they_do: z.string().trim().min(1).max(2000) }).strict().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'The company brief cannot be empty.', fields: parsed.error.flatten().fieldErrors });
  try {
    res.json({ kit: await changeKitContent(req.params.id, ownerId(req), (content) => {
      content.company_brief = { ...content.company_brief, ...parsed.data, edited: true };
    }) });
  } catch (error) { try { sendError(res, error); } catch (unexpected) { next(unexpected); } }
});

kitEditingRouter.post('/:id/regenerate', async (req, res, next) => {
  if (!requireSession(req, res)) return;
  const parsed = regenerateRequest.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Choose a section to regenerate.', fields: parsed.error.flatten().fieldErrors });
  try {
    const current = await Kit.findOne({ _id: req.params.id, userId: ownerId(req) });
    if (!current) return res.status(404).json({ error: 'NOT_FOUND', message: 'Preparation not found.' });
    if (current.status !== 'ready' || !current.generatedKit) return res.status(409).json({ error: 'NOT_READY', message: 'This kit is not ready to regenerate yet.' });
    if (current.regeneration?.status === 'generating') return res.status(409).json({ error: 'REGENERATION_IN_PROGRESS', message: 'A section is already being regenerated.' });
    const claimed = await Kit.findOneAndUpdate(
      { _id: current.id, userId: ownerId(req), __v: current.__v ?? 0, status: 'ready', 'regeneration.status': { $ne: 'generating' } },
      { $set: { regeneration: { status: 'generating', section: parsed.data.section, category: parsed.data.category || '', progress: 'Starting section regeneration', error: '' } }, $inc: { __v: 1 } },
      { new: true },
    );
    if (!claimed) return res.status(409).json({ error: 'KIT_CHANGED', message: 'The kit changed while regeneration was starting. Please retry.' });
    const generatedKit = kitSchema.parse(claimed.generatedKit);
    res.status(202).json({ kit: claimed });
    const input = { section: parsed.data.section, ...(parsed.data.category ? { category: parsed.data.category } : {}), title: claimed.title, companyUrl: claimed.companyUrl, jobDescription: claimed.jobDescription, daysAvailable: claimed.daysAvailable, generatedKit } as const;
    void regenerateKitSection(input, (progress) => {
      void Kit.updateOne({ _id: claimed.id, userId: ownerId(req), 'regeneration.status': 'generating' }, { $set: { 'regeneration.progress': progress } }).catch((error) => console.error('Could not persist regeneration progress:', error));
    }).then(async (result) => {
      await changeKitContent(claimed.id, ownerId(req), (content) => {
        if (result.section === 'questions') { content.questions = mergeRegeneratedCategory(content.questions, result.questions, result.category); reconcileQuestionReferences(content); }
        else if (result.section === 'company_brief') {
          content.company_brief = result.companyBrief;
          content.source.pages_used = result.sourcePages;
          return { sourceGaps: result.sourceGaps };
        } else content.schedule = result.schedule;
      });
      await Kit.updateOne({ _id: claimed.id, userId: ownerId(req), 'regeneration.status': 'generating' }, { $set: { regeneration: { status: 'idle', section: '', category: '', progress: 'Section regenerated', error: '' } } });
    }).catch(async (error: unknown) => {
      const message = error instanceof Error ? error.message : 'Section regeneration failed.';
      await Kit.updateOne({ _id: claimed.id, userId: ownerId(req), 'regeneration.status': 'generating' }, { $set: { 'regeneration.status': 'failed', 'regeneration.progress': 'Regeneration stopped', 'regeneration.error': message.slice(0, 500) } }).catch((persistError) => console.error('Could not persist regeneration failure:', persistError));
    });
  } catch (error) { next(error); }
});
