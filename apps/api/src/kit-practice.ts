import { Router } from 'express';
import { z } from 'zod';
import { Kit } from './models.js';

export const kitPracticeRouter = Router();

const confidenceSchema = z.object({ confidence: z.enum(['low', 'medium', 'high']) }).strict();
class PracticeRequestError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

kitPracticeRouter.patch('/:kitId/practice/:flashcardId', async (req, res, next) => {
  if (!req.session.userId) return res.status(401).json({ error: 'UNAUTHENTICATED', message: 'Please sign in.' });
  const parsed = confidenceSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Choose a confidence level: low, medium, or high.' });

  try {
    for (let attempt = 0; attempt < 8; attempt++) {
      const current = await Kit.findOne({ _id: req.params.kitId, userId: req.session.userId })
        .select('title companyUrl jobDescription daysAvailable status generationProgress generationError sourceGaps generatedKit regeneration practiceProgress createdAt __v');
      if (!current) throw new PracticeRequestError(404, 'NOT_FOUND', 'Preparation not found.');
      if (current.status !== 'ready' || !current.generatedKit) throw new PracticeRequestError(409, 'NOT_READY', 'Practice is available after kit generation finishes.');
      const flashcards = Array.isArray(current.generatedKit.flashcards) ? current.generatedKit.flashcards : [];
      if (!flashcards.some((card: { id?: string }) => card.id === req.params.flashcardId)) throw new PracticeRequestError(404, 'FLASHCARD_NOT_FOUND', 'Flashcard not found in this preparation.');

      const progress = current.practiceProgress && typeof current.practiceProgress === 'object' && !Array.isArray(current.practiceProgress)
        ? current.practiceProgress as Record<string, { confidence?: 'low' | 'medium' | 'high'; attempts?: number; firstPracticedAt?: string; lastPracticedAt?: string }>
        : {};
      const previous = progress[req.params.flashcardId];
      const now = new Date().toISOString();
      const updatedProgress = {
        ...progress,
        [req.params.flashcardId]: {
          confidence: parsed.data.confidence,
          attempts: (previous?.attempts || 0) + 1,
          firstPracticedAt: previous?.firstPracticedAt || now,
          lastPracticedAt: now,
        },
      };
      const updated = await Kit.findOneAndUpdate(
        { _id: current.id, userId: req.session.userId, __v: current.__v ?? 0 },
        { $set: { practiceProgress: updatedProgress }, $inc: { __v: 1 } },
        { new: true },
      ).select('title companyUrl jobDescription daysAvailable status generationProgress generationError sourceGaps generatedKit regeneration practiceProgress createdAt');
      if (updated) return res.json({ kit: updated });
    }
    return res.status(409).json({ error: 'KIT_CHANGED', message: 'Practice progress changed at the same time. Please save your confidence again.' });
  } catch (error) {
    if (error instanceof PracticeRequestError) return res.status(error.status).json({ error: error.code, message: error.message });
    next(error);
  }
});
