import { ZodError } from 'zod';
import { isProduction } from '../config/env.js';
import { logger } from '../utils/logger.js';

export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export function notFound(_req, _res, next) {
  next(new ApiError(404, 'Route not found.'));
}

// eslint-disable-next-line no-unused-vars -- Express identifies error handlers by arity.
export function errorHandler(err, _req, res, _next) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: 'Validation failed.',
      details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }

  if (err instanceof ApiError) {
    return res.status(err.status).json({ error: err.message, details: err.details });
  }

  // Duplicate key on a unique index (handle, email, slug, flag pair).
  if (err?.code === 11000) {
    const field = Object.keys(err.keyPattern ?? {})[0] ?? 'value';
    return res.status(409).json({ error: `That ${field} is already taken.` });
  }

  if (err?.name === 'ValidationError') {
    return res.status(400).json({
      error: 'Validation failed.',
      details: Object.values(err.errors).map((e) => ({ path: e.path, message: e.message })),
    });
  }

  if (err?.name === 'CastError') {
    return res.status(400).json({ error: `Malformed ${err.path}.` });
  }

  logger.error('unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error.',
    ...(isProduction ? {} : { stack: err?.stack }),
  });
}
