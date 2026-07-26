import { copyFile, mkdir, readdir, writeFile, } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { z } from "zod";
import { stableHash, sha256File } from "../job/hash.js";
import { requireOk } from "../util/http.js";
const ALLOWED_EXTENSIONS = new Set([
    ".mp4",
    ".mov",
    ".jpg",
    ".jpeg",
    ".png",
    ".webp",
]);
const PexelsResponseSchema = z.object({
    videos: z.array(z.object({
        id: z.number(),
        width: z.number(),
        height: z.number(),
        url: z.string().url(),
        user: z.object({ name: z.string() }),
        video_files: z.array(z.object({
            width: z.number().nullable(),
            height: z.number().nullable(),
            link: z.string().url(),
            file_type: z.string(),
        })),
    })),
});
async function defaultSearchPexels(query, apiKey) {
    const endpoint = `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&orientation=portrait&per_page=10`;
    const response = await fetch(endpoint, {
        headers: { Authorization: apiKey },
    });
    await requireOk(response, "Pexels video search");
    const parsed = PexelsResponseSchema.parse(await response.json());
    return parsed.videos.flatMap((video) => {
        const file = video.video_files
            .filter((item) => item.file_type === "video/mp4" &&
            item.width !== null &&
            item.height !== null &&
            item.height >= item.width)
            .sort((left, right) => Math.abs((left.width ?? 0) - 720) -
            Math.abs((right.width ?? 0) - 720))[0];
        if (!file || file.width === null || file.height === null)
            return [];
        return [
            {
                id: String(video.id),
                width: file.width,
                height: file.height,
                downloadUrl: file.link,
                sourceUrl: video.url,
                author: video.user.name,
            },
        ];
    });
}
async function defaultDownload(url) {
    const response = await fetch(url);
    await requireOk(response, "Pexels media download");
    return Buffer.from(await response.arrayBuffer());
}
async function localFiles(localDir) {
    try {
        const entries = await readdir(localDir, { withFileTypes: true });
        return entries
            .filter((entry) => entry.isFile() &&
            ALLOWED_EXTENSIONS.has(extname(entry.name).toLowerCase()))
            .map((entry) => join(localDir, entry.name))
            .sort();
    }
    catch (error) {
        if (error.code === "ENOENT")
            return [];
        throw error;
    }
}
export class MediaProvider {
    dependencies;
    stage = "media";
    paid = false;
    constructor(dependencies = {
        searchPexels: defaultSearchPexels,
        download: defaultDownload,
        now: () => new Date(),
    }) {
        this.dependencies = dependencies;
    }
    async inputHash(input) {
        const files = await localFiles(input.localDir);
        return stableHash({
            local: await Promise.all(files.map(async (path) => ({
                name: basename(path),
                sha256: await sha256File(path),
            }))),
            queries: input.queries,
            pexelsEnabled: input.pexelsEnabled,
            hasPexelsKey: Boolean(input.pexelsApiKey),
        });
    }
    async resolve(input) {
        await mkdir(input.outputDir, { recursive: true });
        const accessedAt = this.dependencies.now().toISOString().slice(0, 10);
        const files = await localFiles(input.localDir);
        if (files.length > 0) {
            const items = await Promise.all(files.map(async (sourcePath) => {
                const localPath = join(input.outputDir, basename(sourcePath));
                await copyFile(sourcePath, localPath);
                return {
                    localPath,
                    sourceType: "local",
                    licenseNote: "User-provided local media; user is responsible for rights",
                    accessedAt,
                    sha256: await sha256File(localPath),
                };
            }));
            return { mode: "local", items };
        }
        if (input.pexelsEnabled && input.pexelsApiKey) {
            try {
                for (const query of input.queries) {
                    const candidates = await this.dependencies.searchPexels(query, input.pexelsApiKey);
                    const selected = candidates.find((candidate) => candidate.height >= candidate.width);
                    if (!selected)
                        continue;
                    const video = await this.dependencies.download(selected.downloadUrl);
                    if (video.byteLength === 0)
                        continue;
                    const localPath = join(input.outputDir, `pexels-${selected.id}.mp4`);
                    await writeFile(localPath, video);
                    return {
                        mode: "external",
                        items: [
                            {
                                localPath,
                                sourceType: "pexels",
                                sourceUrl: selected.sourceUrl,
                                author: selected.author,
                                licenseNote: "Pexels license; verify current terms before publishing",
                                accessedAt,
                                sha256: await sha256File(localPath),
                            },
                        ],
                    };
                }
            }
            catch {
                return {
                    mode: "graphics",
                    items: [],
                    reason: "No licensed media resolved",
                };
            }
        }
        return {
            mode: "graphics",
            items: [],
            reason: "No licensed media resolved",
        };
    }
    async execute(input, _context) {
        const manifest = await this.resolve(input);
        const manifestPath = join(input.outputDir, "media-manifest.json");
        await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
        return {
            artifacts: [
                ...manifest.items.map((item) => ({
                    path: item.localPath,
                    sha256: item.sha256,
                    mediaType: extname(item.localPath).toLowerCase() === ".mp4"
                        ? "video/mp4"
                        : "image",
                })),
                {
                    path: manifestPath,
                    sha256: await sha256File(manifestPath),
                    mediaType: "application/json",
                },
            ],
            metadata: { manifest },
        };
    }
}
