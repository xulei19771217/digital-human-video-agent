import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { z } from "zod";

export const ProfileSchema = z.object({
  voiceId: z.string().min(1),
  avatarId: z.string().min(1),
  language: z.literal("zh"),
  width: z.literal(720),
  height: z.literal(1280),
  fps: z.literal(30),
  outputDir: z.string().min(1),
  pexelsEnabled: z.boolean().default(false),
});

export type Profile = z.infer<typeof ProfileSchema>;

export async function loadProfile(path: string): Promise<Profile> {
  return ProfileSchema.parse(JSON.parse(await readFile(path, "utf8")));
}

export async function saveProfile(
  path: string,
  profile: Profile,
): Promise<void> {
  const value = ProfileSchema.parse(profile);
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporaryPath, path);
}
