import type { Credentials } from "../config/credentials.js";
import { npxInvocation, runProcess } from "../util/process.js";

export interface DoctorCheck {
  name: "node" | "ffmpeg" | "ffprobe" | "hyperframes" | "fish" | "heygen";
  ok: boolean;
  detail: string;
}

export interface DoctorReport {
  ready: boolean;
  checks: DoctorCheck[];
}

export interface DoctorDependencies {
  run(
    command: string,
    args: string[],
  ): Promise<{ code: number; stdout: string; stderr: string }>;
  validateFish(apiKey: string): Promise<void>;
  validateHeygen(apiKey: string): Promise<void>;
}

async function dependencyCheck(
  name: DoctorCheck["name"],
  command: string,
  args: string[],
  dependencies: DoctorDependencies,
): Promise<DoctorCheck> {
  try {
    const result = await dependencies.run(command, args);
    const output = `${result.stdout}\n${result.stderr}`.trim();
    return {
      name,
      ok: result.code === 0,
      detail: output || `Exited with code ${result.code}`,
    };
  } catch (error) {
    return { name, ok: false, detail: (error as Error).message };
  }
}

async function hyperframesCheck(
  command: string,
  args: string[],
  dependencies: DoctorDependencies,
): Promise<DoctorCheck> {
  try {
    const result = await dependencies.run(command, args);
    const parsed = JSON.parse(result.stdout) as {
      checks?: Array<{ name?: string; ok?: boolean; detail?: string }>;
    };
    const required = ["Version", "FFmpeg", "FFprobe", "Chrome", "whisper-cpp"];
    const failures = required.flatMap((name) => {
      const check = parsed.checks?.find((item) => item.name === name);
      return check?.ok ? [] : [check?.detail ?? `${name} is missing`];
    });
    return {
      name: "hyperframes",
      ok: result.code === 0 && failures.length === 0,
      detail:
        failures.length === 0
          ? "HyperFrames render and transcription dependencies are ready"
          : failures.join("; "),
    };
  } catch (error) {
    return {
      name: "hyperframes",
      ok: false,
      detail: `Invalid HyperFrames doctor output: ${(error as Error).message}`,
    };
  }
}

export async function runDoctor(
  credentials: Credentials,
  dependencies: DoctorDependencies,
): Promise<DoctorReport> {
  const hyperframes = npxInvocation([
    "--yes",
    "hyperframes@0.7.71",
    "doctor",
    "--json",
  ]);
  const checks = await Promise.all([
    dependencyCheck("node", process.execPath, ["--version"], dependencies),
    dependencyCheck("ffmpeg", "ffmpeg", ["-version"], dependencies),
    dependencyCheck("ffprobe", "ffprobe", ["-version"], dependencies),
    hyperframesCheck(
      hyperframes.command,
      hyperframes.args,
      dependencies,
    ),
  ]);

  for (const [name, key, validator] of [
    ["fish", credentials.fishAudioApiKey, dependencies.validateFish],
    ["heygen", credentials.heygenApiKey, dependencies.validateHeygen],
  ] as const) {
    if (!key) {
      checks.push({ name, ok: false, detail: "Credential is not configured" });
      continue;
    }
    try {
      await validator(key);
      checks.push({ name, ok: true, detail: "Credential is valid" });
    } catch (error) {
      checks.push({ name, ok: false, detail: (error as Error).message });
    }
  }

  return { ready: checks.every((check) => check.ok), checks };
}

export function createDefaultDoctorDependencies(): DoctorDependencies {
  async function validate(url: string, headers: Record<string, string>) {
    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(`Credential validation failed with HTTP ${response.status}`);
    }
  }

  return {
    run: runProcess,
    validateFish: async (apiKey) => {
      await validate("https://api.fish.audio/wallet/self/api-credit", {
        Authorization: `Bearer ${apiKey}`,
      });
    },
    validateHeygen: async (apiKey) => {
      await validate("https://api.heygen.com/v2/avatars", {
        "X-Api-Key": apiKey,
      });
    },
  };
}
