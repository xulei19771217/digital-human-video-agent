import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createInterface } from "node:readline/promises";

import open from "open";
import { z } from "zod";

import type { Credentials } from "../config/credentials.js";
import { currentAppPaths } from "../config/paths.js";
import {
  type Profile,
  ProfileSchema,
  saveProfile as writeProfile,
} from "../config/profile.js";

export const SIGNUP_URLS = {
  fish: "https://fish.audio/app/api-keys/",
  heygen: "https://app.heygen.com/settings",
} as const;

export interface SetupDependencies {
  openUrl(url: string): Promise<unknown>;
  listFishVoices(
    apiKey: string,
  ): Promise<Array<{ id: string; title: string }>>;
  listHeygenAvatars(
    apiKey: string,
  ): Promise<Array<{ id: string; name: string }>>;
  promptSecret(label: string): Promise<string>;
  select(
    label: string,
    choices: Array<{ value: string; label: string }>,
  ): Promise<string>;
  promptOutputDir(): Promise<string>;
  saveCredentials(values: Record<string, string>): Promise<void>;
  saveProfile(profile: Profile): Promise<void>;
}

export async function runSetup(
  existing: Credentials,
  dependencies: SetupDependencies,
): Promise<Profile> {
  let fishKey = existing.fishAudioApiKey;
  if (!fishKey) {
    await dependencies.openUrl(SIGNUP_URLS.fish);
    fishKey = (await dependencies.promptSecret("Fish Audio API Key")).trim();
  }
  if (!fishKey) throw new Error("Fish Audio API Key is required");
  const voices = await dependencies.listFishVoices(fishKey);
  if (voices.length === 0) throw new Error("Fish Audio returned no voices");

  let heygenKey = existing.heygenApiKey;
  if (!heygenKey) {
    await dependencies.openUrl(SIGNUP_URLS.heygen);
    heygenKey = (await dependencies.promptSecret("HeyGen API Key")).trim();
  }
  if (!heygenKey) throw new Error("HeyGen API Key is required");
  const avatars = await dependencies.listHeygenAvatars(heygenKey);
  if (avatars.length === 0) throw new Error("HeyGen returned no avatars");

  const voiceId = await dependencies.select(
    "Default Fish Audio voice",
    voices.map((voice) => ({ value: voice.id, label: voice.title })),
  );
  const avatarId = await dependencies.select(
    "Default HeyGen avatar",
    avatars.map((avatar) => ({ value: avatar.id, label: avatar.name })),
  );
  const outputDir = await dependencies.promptOutputDir();
  const profile = ProfileSchema.parse({
    voiceId,
    avatarId,
    language: "zh",
    width: 720,
    height: 1280,
    fps: 30,
    outputDir,
    pexelsEnabled: Boolean(existing.pexelsApiKey),
  });

  await dependencies.saveCredentials({
    FISH_AUDIO_API_KEY: fishKey,
    HEYGEN_API_KEY: heygenKey,
    ...(existing.pexelsApiKey
      ? { PEXELS_API_KEY: existing.pexelsApiKey }
      : {}),
  });
  await dependencies.saveProfile(profile);
  return profile;
}

const FishVoicesSchema = z.object({
  items: z
    .array(
      z.object({
        _id: z.string(),
        title: z.string().catch("Untitled voice"),
      }),
    )
    .default([]),
});

const HeygenAvatarsSchema = z.object({
  data: z.object({
    avatars: z.array(
      z.object({
        avatar_id: z.string(),
        avatar_name: z.string().catch("Untitled avatar"),
      }),
    ),
  }),
});

async function fetchJson(
  url: string,
  headers: Record<string, string>,
): Promise<unknown> {
  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`Credential validation failed with HTTP ${response.status}`);
  }
  return await response.json();
}

export function createDefaultSetupDependencies(): SetupDependencies {
  const paths = currentAppPaths();
  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  async function select(
    label: string,
    choices: Array<{ value: string; label: string }>,
  ): Promise<string> {
    process.stdout.write(
      `${label}:\n${choices
        .map((choice, index) => `  ${index + 1}. ${choice.label}`)
        .join("\n")}\n`,
    );
    const answer = await readline.question("Choose a number: ");
    const selected = choices[Number(answer) - 1];
    if (!selected) throw new Error("Invalid selection");
    return selected.value;
  }

  return {
    openUrl: async (url) => await open(url),
    listFishVoices: async (apiKey) => {
      const parsed = FishVoicesSchema.parse(
        await fetchJson(
          "https://api.fish.audio/model?page_size=50&page_number=1",
          { Authorization: `Bearer ${apiKey}` },
        ),
      );
      return parsed.items.map((voice) => ({
        id: voice._id,
        title: voice.title,
      }));
    },
    listHeygenAvatars: async (apiKey) => {
      const parsed = HeygenAvatarsSchema.parse(
        await fetchJson("https://api.heygen.com/v2/avatars", {
          "X-Api-Key": apiKey,
        }),
      );
      return parsed.data.avatars.map((avatar) => ({
        id: avatar.avatar_id,
        name: avatar.avatar_name,
      }));
    },
    promptSecret: async (label) => await readline.question(`${label}: `),
    select,
    promptOutputDir: async () => {
      const answer = await readline.question(
        `Output directory [${paths.runsDir}]: `,
      );
      return answer.trim() || paths.runsDir;
    },
    saveCredentials: async (values) => {
      await mkdir(dirname(paths.credentialsPath), { recursive: true });
      const contents = Object.entries(values)
        .map(([key, value]) => `${key}=${value}`)
        .join("\n");
      await writeFile(paths.credentialsPath, `${contents}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
    },
    saveProfile: async (profile) => {
      await writeProfile(paths.profilePath, profile);
      readline.close();
    },
  };
}
