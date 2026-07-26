export type StageName =
  | "voice"
  | "avatar"
  | "media"
  | "captions"
  | "package"
  | "publish";

export interface Artifact {
  path: string;
  sha256: string;
  mediaType: string;
}

export interface ProviderContext {
  jobId: string;
  runDir: string;
  signal?: AbortSignal;
}

export interface StageResult {
  artifacts: Artifact[];
  providerTaskId?: string;
  metadata: Record<string, unknown>;
}

export interface StageProvider<TInput> {
  readonly stage: StageName;
  readonly paid: boolean;
  inputHash(input: TInput): Promise<string>;
  execute(input: TInput, context: ProviderContext): Promise<StageResult>;
  recover?(
    providerTaskId: string,
    input: TInput,
    context: ProviderContext,
  ): Promise<StageResult>;
}
