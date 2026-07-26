import { readFile } from "node:fs/promises";

import { parse } from "dotenv";

export interface Credentials {
  fishAudioApiKey: string | undefined;
  heygenApiKey: string | undefined;
  pexelsApiKey: string | undefined;
}

interface CredentialSources {
  processEnv: NodeJS.ProcessEnv;
  projectEnvPath: string;
  userEnvPath: string;
}

async function readEnvFile(path: string): Promise<Record<string, string>> {
  try {
    return parse(await readFile(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export async function loadCredentials(
  sources: CredentialSources,
): Promise<Credentials> {
  const user = await readEnvFile(sources.userEnvPath);
  const project = await readEnvFile(sources.projectEnvPath);
  const merged = { ...user, ...project, ...sources.processEnv };

  return {
    fishAudioApiKey: nonEmpty(merged.FISH_AUDIO_API_KEY),
    heygenApiKey: nonEmpty(merged.HEYGEN_API_KEY),
    pexelsApiKey: nonEmpty(merged.PEXELS_API_KEY),
  };
}
