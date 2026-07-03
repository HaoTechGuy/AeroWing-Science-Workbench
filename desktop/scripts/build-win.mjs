import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(__dirname, "..");
const releaseDir = path.join(desktopDir, "release");
const productName = "InternAgentS";

function normalizeArch(rawArch) {
  const arch = (rawArch || "").trim().toLowerCase();
  if (["x64", "x86_64", "amd64"].includes(arch)) {
    return "x64";
  }
  if (["arm64", "aarch64"].includes(arch)) {
    return "arm64";
  }
  throw new Error(`Unsupported Windows desktop architecture: ${rawArch || "(empty)"}`);
}

function targetArch() {
  return normalizeArch(
    process.env.INTERNAGENTS_DESKTOP_ARCH ||
      process.env.npm_config_arch ||
      process.arch
  );
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: desktopDir,
    stdio: "inherit",
    shell: false,
  });
  if (result.status !== 0) {
    if (result.error) {
      throw new Error(`${command} ${args.join(" ")} failed: ${result.error.message}`);
    }
    throw new Error(`${command} ${args.join(" ")} failed`);
  }
}

function runElectronBuilder(args) {
  run(process.execPath, [
    path.join(desktopDir, "node_modules", "electron-builder", "cli.js"),
    ...args,
  ]);
}

async function walk(directory, visit) {
  let entries = [];
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") {
      return;
    }
    throw error;
  }

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    await visit(fullPath, entry);
    if (entry.isDirectory()) {
      await walk(fullPath, visit);
    }
  }
}

async function assertWindowsArtifact(target, arch) {
  const expectedExtensions = target === "nsis" ? [".exe"] : [".zip"];
  const matches = [];
  await walk(releaseDir, (entryPath, entry) => {
    if (!entry.isFile()) {
      return;
    }
    const name = path.basename(entryPath);
    if (
      name.startsWith(`${productName}-`) &&
      name.includes(`-${arch}`) &&
      expectedExtensions.includes(path.extname(name).toLowerCase())
    ) {
      matches.push(entryPath);
    }
  });

  if (matches.length === 0) {
    throw new Error(`Unable to find Windows ${target} artifact for ${arch}.`);
  }
}

async function buildTargets(targets, arch) {
  runElectronBuilder(["--win", ...targets, `--${arch}`]);
  for (const target of targets) {
    if (target !== "dir") {
      await assertWindowsArtifact(target, arch);
    }
  }
}

async function main() {
  const modes = process.argv.slice(2);
  const targets = modes.length > 0 ? modes : ["--nsis"];
  const arch = targetArch();
  const supportedTargets = new Map([
    ["--dir", "dir"],
    ["--nsis", "nsis"],
    ["--zip", "zip"],
  ]);

  const requestedTargets = [];
  for (const mode of targets) {
    const target = supportedTargets.get(mode);
    if (!target) {
      throw new Error(`Unknown build mode: ${mode}`);
    }
    requestedTargets.push(target);
  }
  await buildTargets(requestedTargets, arch);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
