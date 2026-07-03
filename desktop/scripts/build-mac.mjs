import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(__dirname, "..");
const releaseDir = path.join(desktopDir, "release");
const productName = "InternAgentS";
const dmgBuildAttempts = Number.parseInt(process.env.INTERNAGENTS_DMG_BUILD_ATTEMPTS || "3", 10);
const dmgRetryDelayMs = Number.parseInt(process.env.INTERNAGENTS_DMG_RETRY_DELAY_MS || "15000", 10);

function normalizeArch(rawArch) {
  const arch = (rawArch || "").trim().toLowerCase();
  if (["arm64", "aarch64", "apple-silicon", "silicon"].includes(arch)) {
    return "arm64";
  }
  if (["x64", "x86_64", "amd64", "intel"].includes(arch)) {
    return "x64";
  }
  throw new Error(`Unsupported macOS desktop architecture: ${rawArch || "(empty)"}`);
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
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed`);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runWithRetries(command, args, attempts, delayMs) {
  const maxAttempts = Number.isFinite(attempts) && attempts > 0 ? attempts : 1;
  const baseDelayMs = Number.isFinite(delayMs) && delayMs > 0 ? delayMs : 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      run(command, args);
      return;
    } catch (error) {
      if (attempt >= maxAttempts) {
        throw error;
      }

      const waitMs = baseDelayMs * attempt;
      console.warn(
        `${command} ${args.join(" ")} failed on attempt ${attempt}/${maxAttempts}. ` +
          `Retrying in ${Math.round(waitMs / 1000)}s.`
      );
      console.warn(error);
      await sleep(waitMs);
    }
  }
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

async function findAppBundle(arch) {
  const preferredPaths = [
    path.join(releaseDir, `mac-${arch}`, `${productName}.app`),
    path.join(releaseDir, "mac", `${productName}.app`),
  ];

  for (const preferredPath of preferredPaths) {
    if (existsSync(preferredPath)) {
      return preferredPath;
    }
  }

  const candidates = [];
  await walk(releaseDir, (entryPath, entry) => {
    if (entry.isDirectory() && entry.name === `${productName}.app`) {
      candidates.push(entryPath);
    }
  });

  if (candidates.length === 1) {
    return candidates[0];
  }
  if (candidates.length > 1) {
    throw new Error(
      `Found multiple ${productName}.app bundles; set INTERNAGENTS_DESKTOP_ARCH or clean desktop/release.`
    );
  }
  throw new Error(`Unable to find ${productName}.app after building ${arch}.`);
}

async function buildDir(arch) {
  run("electron-builder", ["--mac", "dir", `--${arch}`]);
  return findAppBundle(arch);
}

function signApp(appPath) {
  run("codesign", ["--force", "--deep", "--sign", "-", appPath]);
}

async function buildDmg(arch, appPath) {
  await runWithRetries(
    "electron-builder",
    ["--mac", "dmg", `--${arch}`, "--prepackaged", appPath],
    dmgBuildAttempts,
    dmgRetryDelayMs
  );
}

async function main() {
  const mode = process.argv[2] || "--dmg";
  const arch = targetArch();

  if (!["--dir", "--dmg", "--sign-only"].includes(mode)) {
    throw new Error(`Unknown build mode: ${mode}`);
  }

  const appPath = mode === "--sign-only" ? await findAppBundle(arch) : await buildDir(arch);
  signApp(appPath);

  if (mode === "--dmg") {
    await buildDmg(arch, appPath);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
