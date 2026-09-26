import { readdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

const root = process.argv[2] ?? "release-assets";
const repository = process.env.GITHUB_REPOSITORY;
const tag = process.env.RELEASE_TAG;
if (!repository || !tag) throw new Error("GITHUB_REPOSITORY and RELEASE_TAG are required");
const config = JSON.parse(await readFile("src-tauri/tauri.conf.json", "utf8"));
if (tag.replace(/^v/, "") !== config.version) {
  throw new Error(`Release tag ${tag} does not match desktop version ${config.version}`);
}

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  }));
  return files.flat();
}

const files = await filesUnder(root);
const appImage = files.find((path) => /\.appimage$/i.test(path));
const windowsSetup = files.find((path) => /\.exe$/i.test(path));
if (!appImage || !windowsSetup) throw new Error("Both the signed AppImage and Windows NSIS installer are required");

async function platformEntry(installer) {
  const signature = `${installer}.sig`;
  if (!files.includes(signature)) throw new Error(`Missing update signature: ${signature}`);
  const assetName = basename(installer);
  return {
    url: `https://github.com/${repository}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(assetName)}`,
    signature: (await readFile(signature, "utf8")).trim(),
  };
}

const manifest = {
  version: tag.replace(/^v/, ""),
  notes: `Counterlock ${tag}`,
  pub_date: new Date().toISOString(),
  platforms: {
    "linux-x86_64": await platformEntry(appImage),
    "windows-x86_64": await platformEntry(windowsSetup),
  },
};
await writeFile(join(root, "latest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
