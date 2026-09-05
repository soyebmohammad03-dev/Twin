import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import {
  serializerCompiler,
  validatorCompiler,
  jsonSchemaTransform,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { createDatabase, type Database } from '@twin/db';
import { env } from './config/env.js';
import { registerHealthRoutes } from './modules/health/health.routes.js';
import { registerAuthRoutes } from './modules/auth/auth.routes.js';
import { registerMemoryRoutes } from './modules/memories/memories.routes.js';
import { registerEntityRoutes } from './modules/entities/entities.routes.js';
import { registerIngestionRoutes } from './modules/ingestion/ingestion.routes.js';
import { registerRetrievalRoutes } from './modules/retrieval/retrieval.routes.js';
import { registerGraphRoutes } from './modules/graph/graph.routes.js';
import { registerContextRoutes } from './modules/context/context.routes.js';
import { registerReasoningRoutes } from './modules/context/reasoning.routes.js';
import { registerPersonalModelRoutes } from './modules/personalModel/personalModel.routes.js';
import { registerInsightsRoutes } from './modules/insights/insights.routes.js';
import { registerChatRoutes } from './modules/chat/chat.routes.js';
import { registerDecisionRoutes } from './modules/decisions/decisions.routes.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: Database;
  }
}

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: true,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(cors, { origin: env.CORS_ORIGIN, credentials: true });
  await app.register(cookie);
  await app.register(jwt, {
    secret: env.JWT_ACCESS_SECRET,
  });

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Twin API',
        description:
          'Phase 1 foundation. Auth is real (bcrypt + JWT + rotating refresh tokens) but not production-hardened — see docs/architecture.md.',
        version: '0.1.0',
      },
    },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });

  // Constructing the pool does not connect eagerly — see packages/db/src/client.ts.
  const { db, pool } = createDatabase(env.DATABASE_URL);
  app.decorate('db', db);
  app.addHook('onClose', async () => {
    await pool.end();
  });

  await app.register(registerHealthRoutes, { prefix: '/health' });
  await app.register(registerAuthRoutes, { prefix: '/auth' });
  await app.register(registerMemoryRoutes, { prefix: '/memories' });
  await app.register(registerEntityRoutes, { prefix: '/entities' });
  await app.register(registerIngestionRoutes, { prefix: '/ingestion' });
  await app.register(registerRetrievalRoutes, { prefix: '/search' });
  await app.register(registerGraphRoutes, { prefix: '/graph' });
  await app.register(registerContextRoutes, { prefix: '/context' });
  await app.register(registerReasoningRoutes, { prefix: '/reason' });
  await app.register(registerPersonalModelRoutes, { prefix: '/twin' });
  await app.register(registerInsightsRoutes, { prefix: '/insights' });
  await app.register(registerChatRoutes, { prefix: '/chat' });
  await app.register(registerDecisionRoutes, { prefix: '/decisions' });

  // Unexpected errors (e.g. the database being unreachable) must never
  // leak internals — query text, stack traces, connection strings —
  // to the client. Full detail still goes to the server log.
  app.setErrorHandler((error: FastifyError, request, reply) => {
    request.log.error(error);
    const statusCode = error.statusCode && error.statusCode < 500 ? error.statusCode : 500;
    reply.code(statusCode).send({
      error: statusCode === 500 ? 'internal_error' : error.name || 'error',
      message: statusCode === 500 ? 'Something went wrong. Please try again.' : error.message,
    });
  });

  return app;
}
