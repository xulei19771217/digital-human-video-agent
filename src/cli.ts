#!/usr/bin/env node
import { pathToFileURL } from "node:url";

import { Command, CommanderError } from "commander";

export async function main(argv: string[]): Promise<number> {
  const program = new Command()
    .name("video-agent")
    .description("Turn a script into a digital-human video publishing pack")
    .exitOverride()
    .showHelpAfterError();

  program.command("setup").description("Configure providers and defaults");
  program.command("doctor").description("Check local readiness");
  program.command("run").argument("<script>", "Markdown script path");
  program.command("status").argument("[job-id]");
  program.command("resume").argument("<job-id>");

  try {
    await program.parseAsync(argv);
    return 0;
  } catch (error) {
    if (error instanceof CommanderError) {
      return error.exitCode;
    }
    throw error;
  }
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  process.exitCode = await main(process.argv);
}
