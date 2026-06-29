import { LibSQLStore, LibSQLVector } from '@mastra/libsql';
import { getEnv } from '../config/env.js';

const env = getEnv();

export const storage = new LibSQLStore({
  id: 'mastra-storage',
  url: `file:${env.DB_PATH}`,
});

export const vector = new LibSQLVector({
  id: 'architect-vector',
  url: `file:${env.DB_PATH}`,
});
