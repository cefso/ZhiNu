import { buildApp } from './app.js';
import { env } from './env.js';
import { ensureSchema } from './schema.js';

const app = await buildApp();

try {
  await ensureSchema();
  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  app.log.info(`织女 API listening on :${env.PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
