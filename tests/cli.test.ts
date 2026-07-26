import { describe, expect, it } from "vitest";

import { main } from "../src/cli.js";

describe("CLI", () => {
  it("returns zero for help without contacting providers", async () => {
    expect(await main(["node", "video-agent", "--help"])).toBe(0);
  });
});
