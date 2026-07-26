import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { stableHash, sha256File } from "../job/hash.js";
import { AmbiguousPaidRequestError } from "../job/engine.js";
import { requireOk } from "../util/http.js";
import { runProcess } from "../util/process.js";
const API_BASE = "https://api.heygen.com";
const UPLOAD_ENDPOINT = "https://upload.heygen.com/v1/asset";
const RETRY_DELAYS_MS = [2_000, 4_000, 8_000, 15_000, 15_000];
const HeyGenInputSchema = z.object({
    title: z.string().trim().min(1),
    avatarId: z.string().trim().min(1),
    audioPath: z.string().min(1),
    outputPath: z.string().min(1),
    width: z.literal(720),
    height: z.literal(1280),
});
const AvatarListSchema = z.object({
    data: z.object({
        avatars: z.array(z.object({
            avatar_id: z.string(),
            avatar_name: z.string().catch("Untitled avatar"),
        })),
    }),
});
const UploadSchema = z.object({
    code: z.literal(100),
    data: z.object({
        id: z.string().min(1),
        url: z.string().url(),
    }),
});
const GenerateSchema = z.object({
    data: z.object({ video_id: z.string().min(1) }),
});
const StatusSchema = z.object({
    data: z.object({
        status: z.string(),
        video_url: z.string().url().optional(),
        error: z.unknown().optional(),
    }),
});
async function defaultProbeVideo(path) {
    const result = await runProcess("ffprobe", [
        "-v",
        "error",
        "-show_entries",
        "stream=codec_type,width,height",
        "-of",
        "json",
        path,
    ]);
    if (result.code !== 0) {
        throw new Error(`FFprobe rejected HeyGen video: ${result.stderr.trim()}`);
    }
    return z
        .object({
        streams: z.array(z.object({
            codec_type: z.string().optional(),
            width: z.number().optional(),
            height: z.number().optional(),
        })),
    })
        .parse(JSON.parse(result.stdout));
}
function defaultDependencies(persistProviderTaskId) {
    return {
        fetcher: fetch,
        persistProviderTaskId,
        sleep: async (milliseconds) => await new Promise((resolve) => setTimeout(resolve, milliseconds)),
        probeVideo: defaultProbeVideo,
        maxPolls: 120,
    };
}
export class HeyGenProvider {
    apiKey;
    stage = "avatar";
    paid = true;
    dependencies;
    constructor(apiKey, dependencies) {
        this.apiKey = apiKey;
        if (!apiKey.trim())
            throw new Error("HeyGen API Key is required");
        this.dependencies =
            typeof dependencies === "function"
                ? defaultDependencies(dependencies)
                : dependencies;
    }
    headers() {
        return { "X-Api-Key": this.apiKey };
    }
    async validate() {
        await this.listAvatars();
    }
    async listAvatars() {
        const endpoint = `${API_BASE}/v2/avatars`;
        const response = await this.dependencies.fetcher(endpoint, {
            method: "GET",
            headers: this.headers(),
        });
        await requireOk(response, endpoint);
        const parsed = AvatarListSchema.parse(await response.json());
        return parsed.data.avatars.map((avatar) => ({
            id: avatar.avatar_id,
            name: avatar.avatar_name,
        }));
    }
    async inputHash(input) {
        const value = HeyGenInputSchema.parse(input);
        return stableHash({
            avatarId: value.avatarId,
            audioSha256: await sha256File(value.audioPath),
            width: value.width,
            height: value.height,
            style: "normal",
            scale: 1,
            background: "#1D1A17",
        });
    }
    async retryFetch(endpoint, init) {
        let lastError;
        for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
            try {
                return await this.dependencies.fetcher(endpoint, init);
            }
            catch (error) {
                lastError = error;
                const delay = RETRY_DELAYS_MS[attempt];
                if (delay === undefined)
                    break;
                await this.dependencies.sleep(delay);
            }
        }
        throw lastError;
    }
    async uploadAudio(audioPath) {
        const audio = await readFile(audioPath);
        if (audio.byteLength === 0)
            throw new Error("HeyGen input audio is empty");
        const response = await this.retryFetch(UPLOAD_ENDPOINT, {
            method: "POST",
            headers: {
                ...this.headers(),
                "Content-Type": "audio/mpeg",
            },
            body: audio,
        });
        await requireOk(response, UPLOAD_ENDPOINT);
        return UploadSchema.parse(await response.json()).data.id;
    }
    async generate(input, audioAssetId) {
        const endpoint = `${API_BASE}/v2/video/generate`;
        let response;
        try {
            response = await this.dependencies.fetcher(endpoint, {
                method: "POST",
                headers: {
                    ...this.headers(),
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    title: input.title,
                    caption: false,
                    dimension: { width: input.width, height: input.height },
                    video_inputs: [
                        {
                            character: {
                                type: "avatar",
                                avatar_id: input.avatarId,
                                avatar_style: "normal",
                                scale: 1,
                            },
                            voice: {
                                type: "audio",
                                audio_asset_id: audioAssetId,
                            },
                            background: {
                                type: "color",
                                value: "#1D1A17",
                            },
                        },
                    ],
                }),
            });
        }
        catch (error) {
            throw new AmbiguousPaidRequestError(`HeyGen generation outcome is unknown: ${error.message}`);
        }
        await requireOk(response, endpoint);
        return GenerateSchema.parse(await response.json()).data.video_id;
    }
    async waitForVideo(providerTaskId) {
        const endpoint = `${API_BASE}/v1/video_status.get?video_id=${encodeURIComponent(providerTaskId)}`;
        const maxPolls = this.dependencies.maxPolls ?? 120;
        for (let poll = 0; poll < maxPolls; poll += 1) {
            const response = await this.retryFetch(endpoint, {
                method: "GET",
                headers: this.headers(),
            });
            await requireOk(response, endpoint);
            const status = StatusSchema.parse(await response.json()).data;
            if (status.status === "completed") {
                if (!status.video_url) {
                    throw new Error("HeyGen completed without a video URL");
                }
                return status.video_url;
            }
            if (status.status === "failed") {
                throw new Error(`HeyGen task ${providerTaskId} failed: ${JSON.stringify(status.error ?? "unknown")}`);
            }
            await this.dependencies.sleep(5_000);
        }
        throw new Error(`HeyGen task ${providerTaskId} is still processing`);
    }
    async downloadAndValidate(videoUrl, outputPath) {
        const response = await this.retryFetch(videoUrl);
        await requireOk(response, "HeyGen video download");
        const video = Buffer.from(await response.arrayBuffer());
        if (video.byteLength === 0)
            throw new Error("HeyGen video is empty");
        await mkdir(dirname(outputPath), { recursive: true });
        const temporary = `${outputPath}.partial`;
        await writeFile(temporary, video);
        await rename(temporary, outputPath);
        const probe = await this.dependencies.probeVideo(outputPath);
        if (!probe.streams.some((stream) => stream.codec_type === "video")) {
            throw new Error("HeyGen output has no video stream");
        }
    }
    async finish(providerTaskId, input) {
        const videoUrl = await this.waitForVideo(providerTaskId);
        await this.downloadAndValidate(videoUrl, input.outputPath);
        return {
            artifacts: [
                {
                    path: input.outputPath,
                    sha256: await sha256File(input.outputPath),
                    mediaType: "video/mp4",
                },
            ],
            providerTaskId,
            metadata: {
                provider: "heygen",
                avatarId: input.avatarId,
                width: input.width,
                height: input.height,
            },
        };
    }
    async execute(rawInput, _context) {
        const input = HeyGenInputSchema.parse(rawInput);
        const audioAssetId = await this.uploadAudio(input.audioPath);
        const providerTaskId = await this.generate(input, audioAssetId);
        await this.dependencies.persistProviderTaskId(providerTaskId);
        return await this.finish(providerTaskId, input);
    }
    async recover(providerTaskId, rawInput, _context) {
        const input = HeyGenInputSchema.parse(rawInput);
        return await this.finish(providerTaskId, input);
    }
}
