import express, { NextFunction, Request, Response } from 'express';
import session from 'express-session';
import MongoStore from 'connect-mongo';
import cors from 'cors';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { resolve } from 'node:path';
import { authRouter } from './auth.js';
import { Kit } from './models.js';
import { z } from 'zod';
import { generateKit } from './pipeline/generation.js';
import { kitEditingRouter } from './kit-editing.js';
import { kitPracticeRouter } from './kit-practice.js';

dotenv.config({ path: resolve(__dirname, '../../../.env') });

declare module 'express-session' { interface SessionData { userId?: string } }

export const app = express();
const webOrigin = process.env.WEB_ORIGIN || 'http://localhost:3000';
app.set('trust proxy', 1);
app.use(cors({ origin: webOrigin, credentials: true }));
app.use(express.json({ limit: '1mb' }));
export const sessionStore = MongoStore.create({ mongoUrl: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/trao-prep', collectionName: 'sessions', ttl: 60 * 60 * 24 * 7 });
app.use(session({
  name: 'trao.sid', secret: process.env.SESSION_SECRET || 'local-development-only-secret-change-me',
  resave: false, saveUninitialized: false,
  store: sessionStore,
  cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 7 * 24 * 60 * 60 * 1000 },
}));
app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
app.use('/api/auth', authRouter);
app.use('/api/kits', kitEditingRouter);
app.use('/api/kits', kitPracticeRouter);

app.get('/api/kits', async (req, res, next) => {
  if (!req.session.userId) return res.status(401).json({ error: 'UNAUTHENTICATED', message: 'Please sign in.' });
  try { res.json({ kits: await Kit.find({ userId: req.session.userId }).sort({ createdAt: -1 }).select('title companyUrl daysAvailable status generationProgress generationError createdAt') }); }
  catch (error) { next(error); }
});

const createKitSchema = z.object({
  title: z.string().trim().min(2, 'Enter a role title').max(120, 'Role title must be 120 characters or fewer'),
  companyUrl: z.string().trim().url('Enter a valid company website').max(2048).refine((value) => {
    try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; }
  }, 'Website must start with http or https'),
  jobDescription: z.string().trim().min(20, 'Paste at least 20 characters from the job description').max(30000, 'Job description must be 30,000 characters or fewer'),
  daysAvailable: z.number().int('Choose a whole number of days').min(1, 'Choose at least 1 day').max(60, 'Choose 60 days or fewer'),
});

app.post('/api/kits', async (req, res, next) => {
  if (!req.session.userId) return res.status(401).json({ error: 'UNAUTHENTICATED', message: 'Please sign in.' });
  const parsed = createKitSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Check the role title, company website, and job description.', fields: parsed.error.flatten().fieldErrors });
  try {
    const kit = await Kit.create({ userId: req.session.userId, ...parsed.data, status: 'generating', generationProgress: 'Queued for research' });
    res.status(202).json({ kit: { id: kit.id, status: kit.status, generationProgress: kit.generationProgress } });
    void generateKit(parsed.data, (message) => { void Kit.updateOne({ _id: kit.id, status: 'generating' }, { $set: { generationProgress: message } }).catch((error) => console.error('Could not persist generation progress:', error)); })
      .then(({ kit: generatedKit, sourceGaps }) => Kit.updateOne({ _id: kit.id, status: 'generating' }, { $set: { generatedKit, sourceGaps, status: 'ready', generationProgress: 'Preparation kit ready' } }))
      .catch(async (error: unknown) => {
        const message = error instanceof Error ? error.message : 'Kit generation failed. Please try again.';
        try { await Kit.updateOne({ _id: kit.id, status: 'generating' }, { $set: { status: 'failed', generationError: message.slice(0, 500), generationProgress: 'Generation stopped' } }); }
        catch (persistError) { console.error('Could not persist generation failure:', persistError); }
      });
  } catch (error) { next(error); }
});

app.get('/api/kits/:id', async (req, res, next) => {
  if (!req.session.userId) return res.status(401).json({ error: 'UNAUTHENTICATED', message: 'Please sign in.' });
  try {
    const kit = await Kit.findOne({ _id: req.params.id, userId: req.session.userId }).select('title companyUrl jobDescription daysAvailable status generationProgress generationError sourceGaps generatedKit regeneration practiceProgress createdAt');
    if (!kit) return res.status(404).json({ error: 'NOT_FOUND', message: 'Preparation not found.' });
    res.json({ kit });
  } catch (error) { next(error); }
});

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error(error);
  res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.' });
});

export async function connectDatabase() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/trao-prep');
}
