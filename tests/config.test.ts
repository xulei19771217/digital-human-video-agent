import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { loadCredentials } from "../src/config/credentials.js";
import { resolveAppPaths } from "../src/config/paths.js";
import { loadProfile, saveProfile } from "../src/config/profile.js";
import { SIGNUP_URLS, runSetup } from "../src/commands/setup.js";

describe("configuration", () => {
  it("uses process environment before project and user env files", async () => {
    const root = await mkdtemp(join(tmpdir(), "video-agent-"));
    await writeFile(join(root, ".env"), "FISH_AUDIO_API_KEY=project\n");
    const userEnv = join(root, "user.env");
    await writeFile(
      userEnv,
      "FISH_AUDIO_API_KEY=user\nHEYGEN_API_KEY=heygen\n",
    );

    const value = await loadCredentials({
      processEnv: { FISH_AUDIO_API_KEY: "process" },
      projectEnvPath: join(root, ".env"),
      userEnvPath: userEnv,
    });

    expect(value).toEqual({
      fishAudioApiKey: "process",
      heygenApiKey: "heygen",
      pexelsApiKey: undefined,
    });
  });

  it("uses platform-specific configuration roots", () => {
    expect(resolveAppPaths({ APPDATA: "C:\\Data" }, "win32").configDir).toBe(
      "C:\\Data\\digital-human-video-agent",
    );
    expect(
      resolveAppPaths(
        { XDG_CONFIG_HOME: "/cfg", HOME: "/home/a" },
        "linux",
      ).configDir,
    ).toBe("/cfg/digital-human-video-agent");
    expect(resolveAppPaths({ HOME: "/Users/a" }, "darwin").configDir).toBe(
      "/Users/a/Library/Application Support/digital-human-video-agent",
    );
  });

  it("round-trips a validated non-secret profile", async () => {
    const root = await mkdtemp(join(tmpdir(), "video-agent-profile-"));
    const path = join(root, "profile.json");
    const profile = {
      voiceId: "voice-3",
      avatarId: "avatar-middle",
      language: "zh" as const,
      width: 720 as const,
      height: 1280 as const,
      fps: 30 as const,
      outputDir: join(root, "runs"),
      pexelsEnabled: false,
    };

    await saveProfile(path, profile);

    expect(await loadProfile(path)).toEqual(profile);
    expect(await readFile(path, "utf8")).not.toContain("API_KEY");
  });

  it("opens official pages for missing keys and validates before saving", async () => {
    const openUrl = vi.fn(async () => undefined);
    const saveCredentials = vi.fn(async () => undefined);
    const saveSelectedProfile = vi.fn(async () => undefined);
    const secrets = ["fish-key", "heygen-key"];

    await runSetup(
      {
        fishAudioApiKey: undefined,
        heygenApiKey: undefined,
        pexelsApiKey: undefined,
      },
      {
        openUrl,
        listFishVoices: vi.fn(async () => [{ id: "voice-3", title: "少年3" }]),
        listHeygenAvatars: vi.fn(async () => [
          { id: "avatar-middle", name: "Middle" },
        ]),
        promptSecret: vi.fn(async () => secrets.shift() ?? ""),
        select: vi.fn(async (_label, choices) => choices[0]!.value),
        promptOutputDir: vi.fn(async () => "C:\\video-agent\\runs"),
        saveCredentials,
        saveProfile: saveSelectedProfile,
      },
    );

    expect(openUrl).toHaveBeenNthCalledWith(1, SIGNUP_URLS.fish);
    expect(openUrl).toHaveBeenNthCalledWith(2, SIGNUP_URLS.heygen);
    expect(saveCredentials).toHaveBeenCalledWith({
      FISH_AUDIO_API_KEY: "fish-key",
      HEYGEN_API_KEY: "heygen-key",
    });
    expect(saveSelectedProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        voiceId: "voice-3",
        avatarId: "avatar-middle",
      }),
    );
  });
});
