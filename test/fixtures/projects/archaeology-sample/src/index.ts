import { z } from "zod";
import fs from "fs-extra";

export const UserSchema = z.object({
  email: z.string().email(),
  displayName: z.string().min(1),
});

export type User = z.infer<typeof UserSchema>;

export async function readUser(path: string): Promise<User> {
  const raw = (await fs.readJson(path)) as unknown;
  return UserSchema.parse(raw);
}
