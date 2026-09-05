import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  signUpRequestSchema,
  signInRequestSchema,
  refreshRequestSchema,
  authSessionResponseSchema,
  userDtoSchema,
  errorResponseSchema,
  type UserDto,
} from '@twin/contracts';
import { createAuthService, AuthError, type UserRow } from './auth.service.js';
import { ACCESS_TOKEN_TTL_SECONDS } from './tokens.js';
import { env } from '../../config/env.js';
import { authenticate, getAuthenticatedUserId } from '../../plugins/authenticate.js';

const REFRESH_COOKIE = 'twin_refresh_token';

function toUserDto(user: UserRow): UserDto {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    displayName: user.displayName,
    handle: user.handle,
    createdAt: user.createdAt.toISOString(),
  };
}

export async function registerAuthRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>();
  const authService = createAuthService(app.db);

  function setRefreshCookie(reply: FastifyReply, token: string, expiresAt: Date) {
    reply.setCookie(REFRESH_COOKIE, token, {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/auth',
      expires: expiresAt,
    });
  }

  async function issueSession(user: UserRow, request: FastifyRequest, reply: FastifyReply) {
    const { refreshToken, expiresAt } = await authService.createSession(user.id, {
      userAgent: request.headers['user-agent'],
      ipAddress: request.ip,
    });
    setRefreshCookie(reply, refreshToken, expiresAt);

    const accessToken = await reply.jwtSign({ sub: user.id }, { expiresIn: ACCESS_TOKEN_TTL_SECONDS });

    return {
      user: toUserDto(user),
      accessToken,
      accessTokenExpiresAt: new Date(Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000).toISOString(),
      refreshToken,
    };
  }

  function handleAuthError(err: unknown, request: FastifyRequest, reply: FastifyReply) {
    if (err instanceof AuthError) {
      reply.code(err.statusCode);
      return { error: 'auth_error', message: err.message };
    }
    // Anything else (e.g. the database being unreachable) is unexpected —
    // log the real cause, but never leak query text/internals to the client.
    request.log.error(err);
    reply.code(500);
    return { error: 'internal_error', message: 'Something went wrong. Please try again.' };
  }

  server.post(
    '/signup',
    {
      schema: {
        body: signUpRequestSchema,
        response: { 201: authSessionResponseSchema, 409: errorResponseSchema },
      },
    },
    async (request, reply) => {
      try {
        const user = await authService.signUp(request.body);
        const session = await issueSession(user, request, reply);
        reply.code(201);
        return session;
      } catch (err) {
        return handleAuthError(err, request, reply);
      }
    },
  );

  server.post(
    '/login',
    {
      schema: {
        body: signInRequestSchema,
        response: { 200: authSessionResponseSchema, 401: errorResponseSchema },
      },
    },
    async (request, reply) => {
      try {
        const user = await authService.verifyCredentials(request.body.email, request.body.password);
        return await issueSession(user, request, reply);
      } catch (err) {
        return handleAuthError(err, request, reply);
      }
    },
  );

  server.post(
    '/refresh',
    {
      schema: {
        body: refreshRequestSchema,
        response: { 200: authSessionResponseSchema, 401: errorResponseSchema },
      },
    },
    async (request, reply) => {
      const presented = request.body.refreshToken ?? request.cookies[REFRESH_COOKIE];
      if (!presented) {
        reply.code(401);
        return { error: 'missing_refresh_token', message: 'No refresh token provided.' };
      }

      try {
        const { user, refreshToken, expiresAt } = await authService.rotateSession(presented, {
          userAgent: request.headers['user-agent'],
          ipAddress: request.ip,
        });
        setRefreshCookie(reply, refreshToken, expiresAt);
        const accessToken = await reply.jwtSign({ sub: user.id }, { expiresIn: ACCESS_TOKEN_TTL_SECONDS });
        return {
          user: toUserDto(user),
          accessToken,
          accessTokenExpiresAt: new Date(Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000).toISOString(),
          refreshToken,
        };
      } catch (err) {
        return handleAuthError(err, request, reply);
      }
    },
  );

  server.post(
    '/logout',
    { schema: { body: refreshRequestSchema.optional() } },
    async (request, reply) => {
      const presented = request.body?.refreshToken ?? request.cookies[REFRESH_COOKIE];
      if (presented) {
        await authService.revokeSession(presented);
      }
      reply.clearCookie(REFRESH_COOKIE, { path: '/auth' });
      reply.code(204);
    },
  );

  server.get(
    '/me',
    {
      preHandler: authenticate,
      schema: { response: { 200: userDtoSchema, 401: errorResponseSchema } },
    },
    async (request, reply) => {
      const user = await authService.getUserById(getAuthenticatedUserId(request));
      if (!user) {
        reply.code(401);
        return { error: 'unauthorized', message: 'User no longer exists.' };
      }
      return toUserDto(user);
    },
  );
}
