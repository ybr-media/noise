// Copies the engine's variant matrix into the app so a deployment whose root is
// this directory still ships the config the API routes read.
import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = dirname(dirname(fileURLToPath(import.meta.url)));
const source = join(appDir, "..", "config");
const target = join(appDir, "config");

if (!existsSync(source)) {
  console.log("No engine config beside the app; using the copy already in place.");
  process.exit(0);
}

mkdirSync(target, { recursive: true });
for (const name of readdirSync(source).filter((entry) => entry.endsWith(".yaml"))) {
  copyFileSync(join(source, name), join(target, name));
  console.log(`staged config/${name}`);
}
