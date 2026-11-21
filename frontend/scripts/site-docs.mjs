// Writes site/guide.json from the in-app guide (src/lib/guide.ts), so the website's
// Documentation page always shows the same text as Talon itself. Runs with
// `npm run build` (Node strips the TypeScript types).
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const { GUIDE } = await import("../src/lib/guide.ts");
const out = fileURLToPath(new URL("../../site/guide.json", import.meta.url));
writeFileSync(out, JSON.stringify(GUIDE, null, 1) + "\n");
console.log(`site/guide.json: ${GUIDE.length} topics`);
