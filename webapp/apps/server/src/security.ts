import { createHash, randomBytes } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";

export const MIN_PASSWORD_LENGTH = 8;

export function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Tokens are high-entropy, so a plain SHA-256 is enough for lookup. */
export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** argon2id (the library default). */
export function hashPassword(password: string): Promise<string> {
  return hash(password);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

export function tempPassword(): string {
  return randomBytes(9).toString("base64url");
}
