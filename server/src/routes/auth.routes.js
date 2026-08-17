import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { User } from '../models/User.js';
import { ApiError } from '../middleware/error.js';
import { validate } from '../middleware/validate.js';
import { requireAuth, signToken } from '../middleware/auth.js';

const router = Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts. Try again later.' },
});

const registerSchema = z.object({
  handle: z
    .string()
    .min(3)
    .max(32)
    .regex(/^[a-zA-Z0-9_]+$/, 'Handle may only contain letters, numbers and underscores.'),
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters.').max(128),
});

/**
 * Sign in with either a handle or an email address.
 *
 * `identifier` is the field the client sends; `email` is accepted as an alias so
 * an older client (or a curl example from the README) keeps working.
 */
const loginSchema = z
  .object({
    identifier: z.string().trim().min(1).max(254).optional(),
    email: z.string().trim().min(1).max(254).optional(),
    password: z.string().min(1),
  })
  .transform((data) => ({ ...data, identifier: data.identifier || data.email }))
  .refine((data) => Boolean(data.identifier), {
    message: 'Enter your handle or email address.',
    path: ['identifier'],
  });

router.post('/register', authLimiter, validate(registerSchema), async (req, res, next) => {
  try {
    const { handle, email, password } = req.body;

    const clash = await User.findOne({ $or: [{ email }, { handle }] });
    if (clash) {
      throw new ApiError(409, 'An account with that email or handle already exists.');
    }

    const user = new User({ handle, email });
    await user.setPassword(password);
    await user.save();

    res.status(201).json({ token: signToken(user), user: user.toPublic() });
  } catch (err) {
    next(err);
  }
});

router.post('/login', authLimiter, validate(loginSchema), async (req, res, next) => {
  try {
    const { identifier, password } = req.body;

    // Handles are case-sensitive as stored but matched case-insensitively here,
    // anchored so a handle cannot be smuggled in as a regex.
    const handlePattern = new RegExp(`^${identifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
    const user = await User.findOne({
      $or: [{ email: identifier.toLowerCase() }, { handle: handlePattern }],
    }).select('+passwordHash');

    // Same response for an unknown account and a wrong password — don't leak which.
    if (!user || !(await user.verifyPassword(password))) {
      throw new ApiError(401, 'Invalid credentials.');
    }

    res.json({ token: signToken(user), user: user.toPublic() });
  } catch (err) {
    next(err);
  }
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user.toPublic() });
});

export default router;
