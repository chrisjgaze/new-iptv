import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const dist = path.join(root, "dist");
const tizen = path.join(root, "tizen");

// adjust if your config.xml is elsewhere
const configSrc = path.join(root, "tizen", "config.xml");
const iconSrc = path.join(root, "tizen", "icon.png");

if (!fs.existsSync(dist)) {
  console.error("ERROR: dist/ not found — nothing to sync");
  process.exit(1);
}

function rmKeepConfig(folder) {
  if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
  for (const name of fs.readdirSync(folder)) {
    if (name === "config.xml" || name === "icon.png") continue;
    fs.rmSync(path.join(folder, name), { recursive: true, force: true });
  }
}

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

rmKeepConfig(tizen);

// ensure config/icon exist (optional safety)
if (fs.existsSync(configSrc))
  fs.copyFileSync(configSrc, path.join(tizen, "config.xml"));
if (fs.existsSync(iconSrc))
  fs.copyFileSync(iconSrc, path.join(tizen, "icon.png"));

copyDir(dist, tizen);

console.log("Synced dist -> tizen web root");
