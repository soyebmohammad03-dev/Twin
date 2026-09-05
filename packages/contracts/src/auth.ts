import { z } from 'zod';

/**
 * Auth contracts shared between apps/api and any consuming client
 * (apps/web today; a generated Swift client from the API's OpenAPI
 * document for iOS in a later phase). Zod schemas here are the single
 * source of truth — the API validates against them at runtime and the
 * inferred types are what clients should treat as the request/response
 * shape.
 */

export const signUpRequestSchema = z.object({
  fullName: z.string().trim().min(1, 'Full name is required.').max(120),
  email: z.string().trim().email('Enter a valid email address.'),
  password: z.string().min(8, 'Password must be at least 8 characters.').max(128),
  handle: z
    .string()
    .trim()
    .min(3)
    .max(32)
    .regex(/^[a-z0-9_]+$/i, 'Handle may only contain letters, numbers, and underscores.')
    .optional(),
});
export type SignUpRequest = z.infer<typeof signUpRequestSchema>;

export const signInRequestSchema = z.object({
  email: z.string().trim().email('Enter a valid email address.'),
  password: z.string().min(1, 'Password is required.'),
});
export type SignInRequest = z.infer<typeof signInRequestSchema>;

export const refreshRequestSchema = z.object({
  // Optional in the body because web clients may present it via an
  // httpOnly cookie instead; native clients send it explicitly.
  refreshToken: z.string().min(1).optional(),
});
export type RefreshRequest = z.infer<typeof refreshRequestSchema>;

export const userDtoSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  fullName: z.string(),
  displayName: z.string(),
  handle: z.string(),
  createdAt: z.string(),
});
export type UserDto = z.infer<typeof userDtoSchema>;

export const authSessionResponseSchema = z.object({
  user: userDtoSchema,
  accessToken: z.string(),
  accessTokenExpiresAt: z.string(),
  // Also returned in the body (in addition to the httpOnly cookie set
  // for web) so native clients without cookie storage can persist it
  // in the iOS Keychain.
  refreshToken: z.string(),
});
export type AuthSessionResponse = z.infer<typeof authSessionResponseSchema>;

export const errorResponseSchema = z.object({
  error: z.string(),
  message: z.string(),
});
export type ErrorResponse = z.infer<typeof errorResponseSchema>;
