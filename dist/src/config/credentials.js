import { readFile } from "node:fs/promises";
import { parse } from "dotenv";
async function readEnvFile(path) {
    try {
        return parse(await readFile(path, "utf8"));
    }
    catch (error) {
        if (error.code === "ENOENT") {
            return {};
        }
        throw error;
    }
}
function nonEmpty(value) {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
}
export async function loadCredentials(sources) {
    const user = await readEnvFile(sources.userEnvPath);
    const project = await readEnvFile(sources.projectEnvPath);
    const merged = { ...user, ...project, ...sources.processEnv };
    return {
        fishAudioApiKey: nonEmpty(merged.FISH_AUDIO_API_KEY),
        heygenApiKey: nonEmpty(merged.HEYGEN_API_KEY),
        pexelsApiKey: nonEmpty(merged.PEXELS_API_KEY),
    };
}
