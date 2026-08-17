import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { User } from '../models/User.js';
import { ApiError } from './error.js';

export function signToken(user) {
  return jwt.sign({ sub: user._id.toString(), role: user.role }, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn,
  });
}

function readToken(req) {
  const header = req.headers.authorization ?? '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  return null;
}

export async function requireAuth(req, _res, next) {
  try {
    const token = readToken(req);
    if (!token) throw new ApiError(401, 'Authentication required.');

    let payload;
    try {
      payload = jwt.verify(token, env.jwtSecret);
    } catch {
      throw new ApiError(401, 'Invalid or expired token.');
    }

    const user = await User.findById(payload.sub);
    if (!user) throw new ApiError(401, 'Account no longer exists.');

    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

export async function optionalAuth(req, _res, next) {
  const token = readToken(req);
  if (!token) return next();
  try {
    const payload = jwt.verify(token, env.jwtSecret);
    req.user = await User.findById(payload.sub);
  } catch {
    // An unusable token is treated as anonymous rather than an error.
  }
  next();
}

export function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user) return next(new ApiError(401, 'Authentication required.'));
    if (!roles.includes(req.user.role)) {
      return next(new ApiError(403, 'You do not have permission to perform this action.'));
    }
    next();
  };
}
