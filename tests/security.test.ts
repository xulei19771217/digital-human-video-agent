import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import { redact } from "../src/security/redact.js";

const REPOSITORY_ROOT = join(import.meta.dirname, "..");
const INCLUDED_ROOTS = [
  ".github",
  "scripts",
  "skills",
  "src",
  "templates",
];
const INCLUDED_FILES = [
  ".env.example",
  ".gitignore",
  "LICENSE",
  "package.json",
  "README.md",
  "tsconfig.json",
  "vitest.config.ts",
];
const TEXT_EXTENSIONS = new Set([
  ".css",
  ".html",
  ".json",
  ".md",
  ".ts",
  ".txt",
  ".yaml",
  ".yml",
]);

async function walk(path: string): Promise<string[]> {
  const entries = await readdir(path, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map(async (entry) => {
        const child = join(path, entry.name);
        return entry.isDirectory() ? await walk(child) : [child];
      }),
    )
  ).flat();
}

describe("redact", () => {
  it("recursively removes credentials from keys and strings", () => {
    const source = {
      authorization: "Bearer fish-secret",
      headers: { "X-Api-Key": "heygen-secret" },
      url: "https://example.test?api_key=pexels-secret",
      nested: ["safe", { token: "abc123" }],
      note: "Sent Bearer embedded-secret upstream",
    };

    const serialized = JSON.stringify(redact(source));
    expect(serialized).not.toMatch(
      /fish-secret|heygen-secret|pexels-secret|abc123|embedded-secret/,
    );
    expect(serialized).toContain("safe");
  });
});

describe("public repository safety", () => {
  it("contains no user-specific content or committed credentials", async () => {
    const nestedFiles = (
      await Promise.all(
        INCLUDED_ROOTS.map(async (root) => {
          try {
            return await walk(join(REPOSITORY_ROOT, root));
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
            throw error;
          }
        }),
      )
    ).flat();
    const files = [
      ...nestedFiles.filter((path) => TEXT_EXTENSIONS.has(extname(path))),
      ...INCLUDED_FILES.map((path) => join(REPOSITORY_ROOT, path)),
    ];
    const productSpecificName = "Jom" + "bo";
    const forbidden = [
      new RegExp(productSpecificName, "i"),
      /(?:FISH_AUDIO|HEYGEN|PEXELS)_API_KEY[ \t]*=[ \t]*(?=\S)[^\r\n]+/,
      /[A-Z0-9._%+-]+@gmail\.com/i,
      /\bpassword["' ]*[:=]["' ]+[^<\s]+/i,
    ];

    for (const path of files) {
      const content = await readFile(path, "utf8");
      for (const pattern of forbidden) {
        expect(
          pattern.test(content),
          `${relative(REPOSITORY_ROOT, path)} matched ${pattern}`,
        ).toBe(false);
      }
    }
  });
});
