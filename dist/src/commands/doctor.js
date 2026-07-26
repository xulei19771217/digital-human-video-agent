import { npxInvocation, runProcess } from "../util/process.js";
async function dependencyCheck(name, command, args, dependencies) {
    try {
        const result = await dependencies.run(command, args);
        const output = `${result.stdout}\n${result.stderr}`.trim();
        return {
            name,
            ok: result.code === 0,
            detail: output || `Exited with code ${result.code}`,
        };
    }
    catch (error) {
        return { name, ok: false, detail: error.message };
    }
}
async function hyperframesCheck(command, args, dependencies) {
    try {
        const result = await dependencies.run(command, args);
        const parsed = JSON.parse(result.stdout);
        const required = ["Version", "FFmpeg", "FFprobe", "Chrome", "whisper-cpp"];
        const failures = required.flatMap((name) => {
            const check = parsed.checks?.find((item) => item.name === name);
            return check?.ok ? [] : [check?.detail ?? `${name} is missing`];
        });
        return {
            name: "hyperframes",
            ok: result.code === 0 && failures.length === 0,
            detail: failures.length === 0
                ? "HyperFrames render and transcription dependencies are ready"
                : failures.join("; "),
        };
    }
    catch (error) {
        return {
            name: "hyperframes",
            ok: false,
            detail: `Invalid HyperFrames doctor output: ${error.message}`,
        };
    }
}
export async function runDoctor(credentials, dependencies) {
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
        hyperframesCheck(hyperframes.command, hyperframes.args, dependencies),
    ]);
    for (const [name, key, validator] of [
        ["fish", credentials.fishAudioApiKey, dependencies.validateFish],
        ["heygen", credentials.heygenApiKey, dependencies.validateHeygen],
    ]) {
        if (!key) {
            checks.push({ name, ok: false, detail: "Credential is not configured" });
            continue;
        }
        try {
            await validator(key);
            checks.push({ name, ok: true, detail: "Credential is valid" });
        }
        catch (error) {
            checks.push({ name, ok: false, detail: error.message });
        }
    }
    return { ready: checks.every((check) => check.ok), checks };
}
export function createDefaultDoctorDependencies() {
    async function validate(url, headers) {
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
