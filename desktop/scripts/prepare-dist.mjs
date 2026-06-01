import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(__dirname, "..");
const rootDir = path.resolve(desktopDir, "..");
const uiDir = path.join(rootDir, "ui");
const desktopTemplateDir = path.join(desktopDir, "templates");
const distDir = path.join(rootDir, "dist-app");
const uiStandaloneDir = path.join(distDir, "ui-standalone");
const templateDir = path.join(distDir, "internagents-template");
const pythonRuntimeDir = path.join(distDir, "python-runtime");

const runtimeEntries = [
  ".env.example",
  "agent.py",
  "main.py",
  "internagent_resources.py",
  "ssh_backend.py",
  "dynamic_local_backend.py",
  "kb_sync_middleware.py",
  "mineru_middleware.py",
  "goal_middleware.py",
  "goal_state.py",
  "goal_tools.py",
  "internagent.resources.json",
  "internagent.resources.example.json",
  "langgraph.json",
  "langgraph.runtime.json",
  "pyproject.toml",
  "requirements.txt",
  "skills",
];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    stdio: "inherit",
    shell: false,
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed`);
  }
}

async function copyIfExists(source, destination, options = {}) {
  if (!existsSync(source)) {
    return;
  }
  await fs.cp(source, destination, {
    recursive: true,
    force: true,
    verbatimSymlinks: false,
    ...options,
  });
}

async function findServerDir(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  if (entries.some((entry) => entry.isFile() && entry.name === "server.js")) {
    return directory;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const result = await findServerDir(path.join(directory, entry.name));
    if (result) {
      return result;
    }
  }
  return null;
}

async function prepareUiStandalone() {
  run("npm", ["--prefix", uiDir, "run", "build"]);

  const standaloneSource = path.join(uiDir, ".next", "standalone");
  if (!existsSync(standaloneSource)) {
    throw new Error("Next standalone output is missing. Check ui/next.config.ts.");
  }

  await fs.cp(standaloneSource, uiStandaloneDir, {
    recursive: true,
    force: true,
    verbatimSymlinks: true,
  });

  const serverDir = await findServerDir(uiStandaloneDir);
  if (!serverDir) {
    throw new Error("Unable to find Next standalone server.js.");
  }

  await copyIfExists(path.join(uiDir, ".next", "static"), path.join(serverDir, ".next", "static"));
  await copyIfExists(path.join(uiDir, "public"), path.join(serverDir, "public"));
  await copyIfExists(
    path.join(uiStandaloneDir, "node_modules"),
    path.join(uiStandaloneDir, "standalone_node_modules"),
    { verbatimSymlinks: true }
  );
  await rewriteUiStandaloneNodeModuleSymlinks();
}

async function rewriteUiStandaloneNodeModuleSymlinks() {
  const nodeModulesDir = path.join(uiStandaloneDir, "node_modules");
  const standaloneNodeModulesDir = path.join(uiStandaloneDir, "standalone_node_modules");
  if (!existsSync(nodeModulesDir) || !existsSync(standaloneNodeModulesDir)) {
    return;
  }

  await walk(uiStandaloneDir, async (entryPath, entry) => {
    if (!entry.isSymbolicLink()) {
      return;
    }

    const linkTarget = await fs.readlink(entryPath);
    const absoluteTarget = path.isAbsolute(linkTarget)
      ? linkTarget
      : path.resolve(path.dirname(entryPath), linkTarget);
    const resolvedTarget = path.resolve(absoluteTarget);
    if (!resolvedTarget.startsWith(`${nodeModulesDir}${path.sep}`)) {
      return;
    }

    const bundledTarget = path.join(
      standaloneNodeModulesDir,
      path.relative(nodeModulesDir, resolvedTarget)
    );
    if (!existsSync(bundledTarget)) {
      return;
    }

    const relativeTarget = path.relative(path.dirname(entryPath), bundledTarget);
    await fs.rm(entryPath, { force: true });
    await fs.symlink(relativeTarget || path.basename(bundledTarget), entryPath);
  });
}

async function prepareRuntimeTemplate() {
  await fs.mkdir(templateDir, { recursive: true });
  for (const entry of runtimeEntries) {
    await copyIfExists(path.join(rootDir, entry), path.join(templateDir, entry));
  }
  await copyIfExists(
    path.join(desktopTemplateDir, "deepagent.config.json"),
    path.join(templateDir, "deepagent.config.json")
  );
}

async function preparePythonRuntime() {
  const explicitSource = process.env.INTERNAGENTS_PYTHON_RUNTIME_SOURCE;
  const pythonSource =
    explicitSource ||
    (existsSync(path.join(rootDir, ".conda"))
      ? path.join(rootDir, ".conda")
      : path.join(rootDir, ".venv"));

  if (!existsSync(pythonSource)) {
    throw new Error(
      "No Python runtime found. Set INTERNAGENTS_PYTHON_RUNTIME_SOURCE or create .conda/.venv."
    );
  }

  await fs.cp(pythonSource, pythonRuntimeDir, {
    recursive: true,
    force: true,
    verbatimSymlinks: false,
  });
  await rewriteRuntimeSymlinks(path.resolve(pythonSource));
  await normalizePythonLinks();
  await assertNoExternalRuntimeSymlinks();
}

async function relink(linkPath, targetName) {
  try {
    await fs.rm(linkPath, { force: true });
    await fs.symlink(targetName, linkPath);
  } catch (error) {
    throw new Error(`Unable to create ${linkPath} -> ${targetName}: ${error.message}`);
  }
}

async function normalizePythonLinks() {
  const binDir = path.join(pythonRuntimeDir, "bin");
  const python312 = path.join(binDir, "python3.12");
  const python311 = path.join(binDir, "python3.11");
  if (existsSync(python312)) {
    await relink(path.join(binDir, "python"), "python3.12");
    await relink(path.join(binDir, "python3"), "python3.12");
  } else if (existsSync(python311)) {
    await relink(path.join(binDir, "python"), "python3.11");
    await relink(path.join(binDir, "python3"), "python3.11");
  }
}

async function walk(directory, visit) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    await visit(fullPath, entry);
    if (entry.isDirectory()) {
      await walk(fullPath, visit);
    }
  }
}

async function rewriteRuntimeSymlinks(sourceRoot) {
  await walk(pythonRuntimeDir, async (entryPath, entry) => {
    if (!entry.isSymbolicLink()) {
      return;
    }

    const linkTarget = await fs.readlink(entryPath);
    const absoluteTarget = path.isAbsolute(linkTarget)
      ? linkTarget
      : path.resolve(path.dirname(entryPath), linkTarget);
    const resolvedTarget = path.resolve(absoluteTarget);
    if (!resolvedTarget.startsWith(`${sourceRoot}${path.sep}`)) {
      return;
    }

    const bundledTarget = path.join(
      pythonRuntimeDir,
      path.relative(sourceRoot, resolvedTarget)
    );
    if (!existsSync(bundledTarget)) {
      return;
    }

    const relativeTarget = path.relative(path.dirname(entryPath), bundledTarget);
    await fs.rm(entryPath, { force: true });
    await fs.symlink(relativeTarget || path.basename(bundledTarget), entryPath);
  });
}

async function assertNoExternalRuntimeSymlinks() {
  const bundledRoot = path.resolve(pythonRuntimeDir);
  await walk(pythonRuntimeDir, async (entryPath, entry) => {
    if (!entry.isSymbolicLink()) {
      return;
    }

    const linkTarget = await fs.readlink(entryPath);
    if (!path.isAbsolute(linkTarget)) {
      return;
    }

    const resolvedTarget = path.resolve(linkTarget);
    if (!resolvedTarget.startsWith(`${bundledRoot}${path.sep}`)) {
      throw new Error(
        `Bundled Python runtime contains an external symlink: ${entryPath} -> ${linkTarget}`
      );
    }
  });
}

async function main() {
  await fs.rm(distDir, { recursive: true, force: true });
  await fs.mkdir(distDir, { recursive: true });

  await prepareUiStandalone();
  await prepareRuntimeTemplate();
  await preparePythonRuntime();

  console.log(`Prepared desktop resources at ${distDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
