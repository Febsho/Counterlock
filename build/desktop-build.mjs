import { spawnSync } from "node:child_process";

const result = spawnSync(process.execPath, ["node_modules/@tauri-apps/cli/tauri.js", "build", ...process.argv.slice(2)], {
  stdio: "inherit",
  env: { ...process.env, ...(process.platform === "linux" ? { NO_STRIP: "1" } : {}) },
});
process.exit(result.status ?? 1);
