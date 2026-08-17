import { Router } from 'express';
import authRoutes from './auth.routes.js';
import problemRoutes from './problems.routes.js';
import submissionRoutes from './submissions.routes.js';
import leaderboardRoutes from './leaderboard.routes.js';
import contestRoutes from './contests.routes.js';
import adminRoutes from './admin.routes.js';

const router = Router();

router.get('/health', (_req, res) => {
  res.json({
    ok: true,
    uptimeSeconds: Math.round(process.uptime()),
  });
});

router.use('/auth', authRoutes);
router.use('/problems', problemRoutes);
router.use('/submissions', submissionRoutes);
router.use('/leaderboard', leaderboardRoutes);
router.use('/contests', contestRoutes);
router.use('/admin', adminRoutes);

export default router;
