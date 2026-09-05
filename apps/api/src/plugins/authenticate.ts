import type { FastifyReply, FastifyRequest } from 'fastify';

interface AccessTokenPayload {
  sub: string;
}

/**
 * Shared preHandler for every route that requires a signed-in user.
 * Verifies the JWT access token; on failure, sends 401 and short-
 * circuits the request (Fastify preHandlers that call reply.send()
 * stop the handler chain).
 */
export async function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    await request.jwtVerify();
  } catch {
    reply.code(401).send({ error: 'unauthorized', message: 'Invalid or missing access token.' });
  }
}

/** Reads the authenticated user's id — only valid after `authenticate` has run. */
export function getAuthenticatedUserId(request: FastifyRequest): string {
  return (request.user as AccessTokenPayload).sub;
}
