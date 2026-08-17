import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { env, isProduction } from './config/env.js';
import routes from './routes/index.js';
import { logger } from './utils/logger.js';
import { notFound, errorHandler } from './middleware/error.js';

export function createApp() {
  const app = express();

  // Behind Nginx the client IP arrives in X-Forwarded-For; rate limiting needs it.
  app.set('trust proxy', 1);

  app.use(
    helmet({
      // The SPA is same-origin and ships no inline scripts, but Vite emits an
      // inline module preload; a hand-rolled CSP here would break the build for
      // no benefit over the header Nginx sets in the deploy config.
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    })
  );
  app.use(
    cors({
      origin: env.clientOrigin.split(',').map((o) => o.trim()),
      credentials: true,
    })
  );
  app.use(compression());
  app.use(express.json({ limit: '1mb' }));
  app.use(morgan(isProduction ? 'combined' : 'dev'));

  app.use(
    '/api',
    rateLimit({
      windowMs: 60 * 1000,
      limit: 300,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
    })
  );

  app.use('/api', routes);

  /* ---------------------------- static SPA (opt-in) --------------------------- */

  if (env.serveClient) {
    const indexHtml = path.join(env.clientDistDir, 'index.html');

    if (!fs.existsSync(indexHtml)) {
      logger.warn(
        `SERVE_CLIENT=true but no build found at ${env.clientDistDir} — run "npm run build". Serving the API only.`
      );
    } else {
      // Hashed asset filenames are safe to cache hard; index.html must not be,
      // or a deploy leaves browsers pinned to the previous bundle.
      app.use(
        express.static(env.clientDistDir, {
          index: false,
          maxAge: '1y',
          setHeaders: (res, filePath) => {
            if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache');
          },
        })
      );

      app.get(/^\/(?!api\/).*/, (_req, res) => {
        res.setHeader('Cache-Control', 'no-cache');
        res.sendFile(indexHtml);
      });

      logger.info(`serving client build from ${env.clientDistDir}`);
    }
  }

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
