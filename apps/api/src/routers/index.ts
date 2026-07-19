import { router } from '../trpc.js';
import { authRouter } from './auth.js';
import { gymRouter } from './gym.js';
import { membersRouter } from './members.js';
import { importsRouter } from './imports.js';
import { equipmentRouter } from './equipment.js';
import { exercisesRouter } from './exercises.js';
import { programsRouter } from './programs.js';
import { loggingRouter } from './logging.js';
import { schedulingRouter } from './scheduling.js';
import { moneyRouter } from './money.js';
import { biRouter } from './bi.js';

export const appRouter = router({
  auth: authRouter,
  gym: gymRouter,
  members: membersRouter,
  imports: importsRouter,
  equipment: equipmentRouter,
  exercises: exercisesRouter,
  programs: programsRouter,
  logging: loggingRouter,
  scheduling: schedulingRouter,
  money: moneyRouter,
  bi: biRouter,
});

export type AppRouter = typeof appRouter;
