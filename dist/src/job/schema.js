import { z } from "zod";
export const StageStatusSchema = z.enum([
    "pending",
    "running",
    "completed",
    "failed",
    "unknown",
]);
export const ArtifactSchema = z.object({
    path: z.string(),
    sha256: z.string(),
    mediaType: z.string(),
});
export const StageRecordSchema = z.object({
    status: StageStatusSchema,
    paid: z.boolean(),
    inputHash: z.string().optional(),
    providerTaskId: z.string().optional(),
    artifacts: z.array(ArtifactSchema),
    metadata: z.record(z.string(), z.unknown()),
    startedAt: z.string().datetime().optional(),
    completedAt: z.string().datetime().optional(),
    error: z.string().optional(),
});
const ProfileSnapshotSchema = z.object({
    voiceId: z.string(),
    avatarId: z.string(),
    language: z.literal("zh"),
    width: z.literal(720),
    height: z.literal(1280),
    fps: z.literal(30),
});
const JobParametersSchema = z.object({
    speed: z.number().min(0.5).max(2),
    mediaDir: z.string().optional(),
    pexelsEnabled: z.boolean(),
    mock: z.boolean(),
});
const JobStagesSchema = z.object({
    voice: StageRecordSchema,
    avatar: StageRecordSchema,
    media: StageRecordSchema,
    captions: StageRecordSchema,
    package: StageRecordSchema,
    publish: StageRecordSchema,
});
export const JobSchema = z.object({
    schemaVersion: z.literal(1),
    id: z.string().regex(/^\d{8}T\d{6}Z-[a-f0-9]{8}$/),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    scriptPath: z.string(),
    scriptHash: z.string(),
    profile: ProfileSnapshotSchema,
    parameters: JobParametersSchema,
    stages: JobStagesSchema,
});
