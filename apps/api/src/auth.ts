import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { User } from './models.js';

export const registerSchema = z.object({
  fullName: z.string().trim().min(2, 'Enter your full name').max(80, 'Name must be 80 characters or fewer'),
  email: z.string().trim().email('Enter a valid email address').max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(8, 'Use at least 8 characters').max(72, 'Password must be 72 characters or fewer'),
});
export const loginSchema = z.object({
  email: z.string().trim().email('Enter a valid email address').max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(1, 'Enter your password').max(72),
});

export const authRouter = Router();
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false });
authRouter.use(authLimiter);

authRouter.post('/register', async (req, res, next) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Check the highlighted fields.', fields: parsed.error.flatten().fieldErrors });
  try {
    const { fullName, email, password } = parsed.data;
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await User.create({ fullName, email, passwordHash });
    req.session.regenerate((error) => {
      if (error) return next(error);
      req.session.userId = user.id;
      req.session.save((saveError) => saveError ? next(saveError) : res.status(201).json({ user: { id: user.id, fullName: user.fullName, email: user.email } }));
    });
  } catch (error: any) {
    if (error?.code === 11000) return res.status(409).json({ error: 'EMAIL_IN_USE', message: 'An account with this email already exists.' });
    next(error);
  }
});

authRouter.post('/login', async (req, res, next) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Check the highlighted fields.', fields: parsed.error.flatten().fieldErrors });
  try {
    const user = await User.findOne({ email: parsed.data.email }).select('+passwordHash');
    if (!user || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) return res.status(401).json({ error: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect.' });
    req.session.regenerate((error) => {
      if (error) return next(error);
      req.session.userId = user.id;
      req.session.save((saveError) => saveError ? next(saveError) : res.json({ user: { id: user.id, fullName: user.fullName, email: user.email } }));
    });
  } catch (error) { next(error); }
});

authRouter.post('/logout', (req, res, next) => {
  req.session.destroy((error) => {
    if (error) return next(error);
    res.clearCookie('trao.sid', { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });
    res.status(204).end();
  });
});

authRouter.get('/me', async (req, res, next) => {
  if (!req.session.userId) return res.status(401).json({ error: 'UNAUTHENTICATED', message: 'Please sign in.' });
  try {
    const user = await User.findById(req.session.userId).select('fullName email');
    if (!user) return req.session.destroy(() => res.status(401).json({ error: 'UNAUTHENTICATED', message: 'Please sign in.' }));
    res.json({ user: { id: user.id, fullName: user.fullName, email: user.email } });
  } catch (error) { next(error); }
});
