import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
function canonicalize(value) {
    if (Array.isArray(value)) {
        return value.map(canonicalize);
    }
    if (value && typeof value === "object") {
        return Object.fromEntries(Object.entries(value)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, child]) => [key, canonicalize(child)]));
    }
    return value;
}
export function stableHash(value) {
    return createHash("sha256")
        .update(JSON.stringify(canonicalize(value)))
        .digest("hex");
}
export async function sha256File(path) {
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(path)) {
        hash.update(chunk);
    }
    return hash.digest("hex");
}
