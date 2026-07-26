import { posix, win32 } from "node:path";

export interface AppPaths {
  configDir: string;
  credentialsPath: string;
  profilePath: string;
  runsDir: string;
}

export function resolveAppPaths(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): AppPaths {
  if (platform === "win32") {
    if (!env.APPDATA) {
      throw new Error("APPDATA is required to resolve the configuration path");
    }
    const configDir = win32.join(env.APPDATA, "digital-human-video-agent");
    return {
      configDir,
      credentialsPath: win32.join(configDir, "credentials.env"),
      profilePath: win32.join(configDir, "profile.json"),
      runsDir: win32.join(configDir, "runs"),
    };
  }

  if (!env.HOME && !env.XDG_CONFIG_HOME) {
    throw new Error("HOME is required to resolve the configuration path");
  }

  const base =
    platform === "darwin"
      ? posix.join(env.HOME!, "Library", "Application Support")
      : env.XDG_CONFIG_HOME ?? posix.join(env.HOME!, ".config");
  const configDir = posix.join(base, "digital-human-video-agent");
  return {
    configDir,
    credentialsPath: posix.join(configDir, "credentials.env"),
    profilePath: posix.join(configDir, "profile.json"),
    runsDir: posix.join(configDir, "runs"),
  };
}

export function currentAppPaths(): AppPaths {
  return resolveAppPaths(process.env, process.platform);
}
