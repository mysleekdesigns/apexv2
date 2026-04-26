/**
 * encrypt.ts — AES-256-GCM encryption with PBKDF2-derived key.
 *
 * Binary wire format (little-endian where applicable):
 *
 *   Offset  Length  Field
 *   ------  ------  -----
 *   0       8       magic = "APEXBUN1" (ASCII)
 *   8       16      salt  (random, for PBKDF2)
 *   24      12      iv    (random, AES-GCM nonce)
 *   36      16      tag   (AES-GCM authentication tag)
 *   52      N       ciphertext
 *
 * Key derivation: PBKDF2 / SHA-256 / 600_000 iterations / 32-byte output.
 * No external dependencies — stdlib crypto only.
 */

import crypto from "node:crypto";
import { promisify } from "node:util";

const pbkdf2 = promisify(crypto.pbkdf2);

// ---- Constants (exportable for test assertions) ----

export const MAGIC = "APEXBUN1";
export const MAGIC_BYTES = Buffer.from(MAGIC, "ascii"); // 8 bytes
export const SALT_LEN = 16;
export const IV_LEN = 12;
export const TAG_LEN = 16;
export const KEY_LEN = 32;
export const PBKDF2_ITERATIONS = 600_000;
export const PBKDF2_DIGEST = "sha256";

// Offsets
const OFF_MAGIC = 0;
const OFF_SALT = 8;
const OFF_IV = 24;
const OFF_TAG = 36;
const OFF_CIPHER = 52;

/**
 * Derive a 32-byte AES key from a passphrase + salt via PBKDF2.
 */
async function deriveKey(passphrase: string, salt: Buffer): Promise<Buffer> {
  return pbkdf2(passphrase, salt, PBKDF2_ITERATIONS, KEY_LEN, PBKDF2_DIGEST);
}

/**
 * Encrypt `plaintext` with `passphrase`. Returns the formatted binary blob.
 */
export async function encrypt(plaintext: Buffer, passphrase: string): Promise<Buffer> {
  const salt = crypto.randomBytes(SALT_LEN);
  const iv = crypto.randomBytes(IV_LEN);
  const key = await deriveKey(passphrase, salt);

  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  // Assemble: magic | salt | iv | tag | ciphertext
  return Buffer.concat([MAGIC_BYTES, salt, iv, tag, encrypted]);
}

/**
 * Decrypt `data` (produced by `encrypt`) with `passphrase`.
 * Throws with a safe message on any authentication or format failure.
 */
export async function decrypt(data: Buffer, passphrase: string): Promise<Buffer> {
  // Minimum length check
  if (data.length < OFF_CIPHER) {
    throw new Error("bundle is corrupt or passphrase is wrong");
  }

  // Verify magic
  const magic = data.subarray(OFF_MAGIC, OFF_SALT);
  if (!magic.equals(MAGIC_BYTES)) {
    throw new Error("bundle is corrupt or passphrase is wrong");
  }

  const salt = data.subarray(OFF_SALT, OFF_IV);
  const iv = data.subarray(OFF_IV, OFF_TAG);
  const tag = data.subarray(OFF_TAG, OFF_CIPHER);
  const ciphertext = data.subarray(OFF_CIPHER);

  const key = await deriveKey(passphrase, salt);

  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted;
  } catch {
    // AES-GCM auth tag mismatch or other crypto error
    throw new Error("bundle is corrupt or passphrase is wrong");
  }
}
