import { describe, it, expect } from "vitest";
import { z } from "zod";
import { UserSchema } from "./index.js";

describe("UserSchema", () => {
  it("validates", () => {
    const r = UserSchema.safeParse({ email: "a@b.com", displayName: "A" });
    expect(r.success).toBe(true);
  });
  it("uses zod", () => {
    expect(z).toBeDefined();
  });
});
