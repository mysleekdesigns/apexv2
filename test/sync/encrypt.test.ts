import { describe, it, expect } from "vitest";
import {
  encrypt,
  decrypt,
  MAGIC,
  MAGIC_BYTES,
  PBKDF2_ITERATIONS,
  SALT_LEN,
  IV_LEN,
  TAG_LEN,
  KEY_LEN,
  PBKDF2_DIGEST,
} from "../../src/sync/encrypt.js";

const PASSPHRASE = "test-passphrase-xyz";
const PLAINTEXT = Buffer.from("Hello, APEX encrypted bundle world! 🔐");

describe("encrypt / decrypt — constants", () => {
  it("PBKDF2_ITERATIONS is at least 600_000", () => {
    expect(PBKDF2_ITERATIONS).toBeGreaterThanOrEqual(600_000);
  });

  it("PBKDF2_ITERATIONS is exactly 600_000", () => {
    expect(PBKDF2_ITERATIONS).toBe(600_000);
  });

  it("KEY_LEN is 32 (AES-256)", () => {
    expect(KEY_LEN).toBe(32);
  });

  it("SALT_LEN is 16", () => {
    expect(SALT_LEN).toBe(16);
  });

  it("IV_LEN is 12 (GCM nonce)", () => {
    expect(IV_LEN).toBe(12);
  });

  it("TAG_LEN is 16 (AES-GCM auth tag)", () => {
    expect(TAG_LEN).toBe(16);
  });

  it("magic is APEXBUN1", () => {
    expect(MAGIC).toBe("APEXBUN1");
    expect(MAGIC_BYTES.toString("ascii")).toBe("APEXBUN1");
    expect(MAGIC_BYTES.length).toBe(8);
  });

  it("PBKDF2_DIGEST is sha256", () => {
    expect(PBKDF2_DIGEST).toBe("sha256");
  });
});

describe("encrypt / decrypt — round-trip", () => {
  it("decrypt(encrypt(plaintext)) is byte-identical to plaintext", async () => {
    const cipherBlob = await encrypt(PLAINTEXT, PASSPHRASE);
    const recovered = await decrypt(cipherBlob, PASSPHRASE);
    expect(recovered.equals(PLAINTEXT)).toBe(true);
  });

  it("works with empty plaintext", async () => {
    const cipherBlob = await encrypt(Buffer.alloc(0), PASSPHRASE);
    const recovered = await decrypt(cipherBlob, PASSPHRASE);
    expect(recovered.length).toBe(0);
  });

  it("two encryptions of the same plaintext produce different ciphertexts (random IV+salt)", async () => {
    const c1 = await encrypt(PLAINTEXT, PASSPHRASE);
    const c2 = await encrypt(PLAINTEXT, PASSPHRASE);
    // They should differ (random salt + iv)
    expect(c1.equals(c2)).toBe(false);
  });
});

describe("encrypt / decrypt — wrong passphrase", () => {
  it("throws when decrypting with wrong passphrase", async () => {
    const cipherBlob = await encrypt(PLAINTEXT, PASSPHRASE);
    await expect(decrypt(cipherBlob, "wrong-passphrase")).rejects.toThrow(
      "bundle is corrupt or passphrase is wrong",
    );
  });

  it("throws when decrypting with empty passphrase", async () => {
    const cipherBlob = await encrypt(PLAINTEXT, PASSPHRASE);
    await expect(decrypt(cipherBlob, "")).rejects.toThrow(
      "bundle is corrupt or passphrase is wrong",
    );
  });
});

describe("encrypt / decrypt — tampered data", () => {
  it("throws when one ciphertext byte is flipped", async () => {
    const cipherBlob = await encrypt(PLAINTEXT, PASSPHRASE);
    // Ciphertext starts at offset 52; flip a byte in the middle
    const tampered = Buffer.from(cipherBlob);
    const midOffset = 52 + Math.floor((tampered.length - 52) / 2);
    tampered[midOffset] ^= 0xff;
    await expect(decrypt(tampered, PASSPHRASE)).rejects.toThrow(
      "bundle is corrupt or passphrase is wrong",
    );
  });

  it("throws when the auth tag is corrupted", async () => {
    const cipherBlob = await encrypt(PLAINTEXT, PASSPHRASE);
    const tampered = Buffer.from(cipherBlob);
    // Tag is at offset 36..52; flip the first tag byte
    tampered[36] ^= 0x01;
    await expect(decrypt(tampered, PASSPHRASE)).rejects.toThrow(
      "bundle is corrupt or passphrase is wrong",
    );
  });

  it("throws when salt is tampered", async () => {
    const cipherBlob = await encrypt(PLAINTEXT, PASSPHRASE);
    const tampered = Buffer.from(cipherBlob);
    // Salt is at offset 8..24
    tampered[8] ^= 0xff;
    await expect(decrypt(tampered, PASSPHRASE)).rejects.toThrow(
      "bundle is corrupt or passphrase is wrong",
    );
  });
});

describe("encrypt / decrypt — magic header", () => {
  it("rejects blob with wrong magic bytes", async () => {
    const cipherBlob = await encrypt(PLAINTEXT, PASSPHRASE);
    const badMagic = Buffer.from(cipherBlob);
    // Overwrite magic with garbage
    badMagic.write("BADMAGIC", 0, "ascii");
    await expect(decrypt(badMagic, PASSPHRASE)).rejects.toThrow(
      "bundle is corrupt or passphrase is wrong",
    );
  });

  it("rejects data that is too short to contain a valid header", async () => {
    const tooShort = Buffer.from("APEXBUN1");
    await expect(decrypt(tooShort, PASSPHRASE)).rejects.toThrow(
      "bundle is corrupt or passphrase is wrong",
    );
  });

  it("rejects completely empty buffer", async () => {
    await expect(decrypt(Buffer.alloc(0), PASSPHRASE)).rejects.toThrow(
      "bundle is corrupt or passphrase is wrong",
    );
  });
});
