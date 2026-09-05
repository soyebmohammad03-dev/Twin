import bcrypt from 'bcryptjs';

// bcryptjs (pure JS, no native build step) rather than argon2 — chosen
// for Phase 1 install reliability across environments. bcrypt is still
// an accepted choice; argon2id is the recommended upgrade before
// production (see docs/architecture.md).
const SALT_ROUNDS = 12;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
