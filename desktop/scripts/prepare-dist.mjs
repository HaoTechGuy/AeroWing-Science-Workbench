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
const standaloneDependencyRoots = ["pdf-parse"];
const backendWheelhouseDirName = "backend-wheelhouse";
const backendCliArchiveName = "internagents-backend-cli.tar.gz";
const backendWheelhouseTargets = [
  {
    pythonVersion: "3.12",
    abi: "cp312",
    platforms: ["manylinux_2_28_x86_64", "manylinux2014_x86_64"],
  },
  {
    pythonVersion: "3.11",
    abi: "cp311",
    platforms: ["manylinux_2_28_x86_64", "manylinux2014_x86_64"],
  },
];
const backendSourceDistributions = new Set(["forbiddenfruit"]);
const canCreatePortableSymlinks = process.platform !== "win32";
const standaloneCopyLinkOptions = {
  verbatimSymlinks: canCreatePortableSymlinks,
  dereference: !canCreatePortableSymlinks,
};

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
  "internagents_backend_cli.py",
  "internagent.resources.json",
  "internagent.resources.example.json",
  "langgraph.json",
  "langgraph.runtime.json",
  "pyproject.toml",
  "requirements.txt",
  "skills",
];

function commandForPlatform(command, args) {
  if (command === "npm" && process.env.npm_execpath) {
    return {
      executable: process.execPath,
      args: [process.env.npm_execpath, ...args],
    };
  }

  return {
    executable: command,
    args,
  };
}

function run(command, args, options = {}) {
  const resolved = commandForPlatform(command, args);
  const result = spawnSync(resolved.executable, resolved.args, {
    cwd: rootDir,
    stdio: "inherit",
    shell: false,
    ...options,
  });
  if (result.status !== 0) {
    if (result.error) {
      throw new Error(
        `${resolved.executable} ${resolved.args.join(" ")} failed: ${result.error.message}`
      );
    }
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
    ...standaloneCopyLinkOptions,
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
    standaloneCopyLinkOptions
  );
  await rewriteUiStandaloneNodeModuleSymlinks();
  await copyMissingStandalonePackageDependencies();
  await linkStandalonePackageDependencies();
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

async function readJsonIfExists(filePath) {
  if (!existsSync(filePath)) {
    return null;
  }
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function listPackageNames(nodeModulesDir) {
  const names = [];
  const entries = await fs.readdir(nodeModulesDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    if (entry.name.startsWith("@")) {
      const scopedEntries = await fs.readdir(path.join(nodeModulesDir, entry.name), {
        withFileTypes: true,
      });
      for (const scopedEntry of scopedEntries) {
        if (scopedEntry.isDirectory()) {
          names.push(`${entry.name}/${scopedEntry.name}`);
        }
      }
      continue;
    }
    names.push(entry.name);
  }
  return names;
}

function packagePath(nodeModulesDir, packageName) {
  return path.join(nodeModulesDir, ...packageName.split("/"));
}

function dependencyNames(manifest) {
  return new Set([
    ...Object.keys(manifest.dependencies || {}),
    ...Object.keys(manifest.optionalDependencies || {}),
  ]);
}

async function ensureDirectoryLink(linkPath, targetPath) {
  let existing = null;
  try {
    existing = await fs.lstat(linkPath);
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
  if (existing) {
    return;
  }

  await fs.mkdir(path.dirname(linkPath), { recursive: true });
  if (process.platform === "win32") {
    await fs.symlink(path.resolve(targetPath), linkPath, "junction");
    return;
  }

  const relativeTarget = path.relative(path.dirname(linkPath), targetPath);
  await fs.symlink(relativeTarget || ".", linkPath, "dir");
}

async function linkStandalonePackageDependencies() {
  const standaloneNodeModulesDir = path.join(uiStandaloneDir, "standalone_node_modules");
  if (!existsSync(standaloneNodeModulesDir)) {
    return;
  }

  const packageNames = await listPackageNames(standaloneNodeModulesDir);
  const packagePaths = new Map(
    packageNames.map((packageName) => [
      packageName,
      packagePath(standaloneNodeModulesDir, packageName),
    ])
  );

  for (const packageName of packageNames) {
    const currentPackagePath = packagePaths.get(packageName);
    const manifest = await readJsonIfExists(path.join(currentPackagePath, "package.json"));
    if (!manifest) {
      continue;
    }

    for (const dependencyName of dependencyNames(manifest)) {
      const dependencyPath = packagePaths.get(dependencyName);
      if (!dependencyPath || dependencyPath === currentPackagePath) {
        continue;
      }

      await ensureDirectoryLink(
        packagePath(path.join(currentPackagePath, "node_modules"), dependencyName),
        dependencyPath
      );
    }
  }
}

async function ensureStandalonePackage(packageName, sourceNodeModulesDir, targetNodeModulesDir) {
  const targetPath = packagePath(targetNodeModulesDir, packageName);
  const sourcePath = packagePath(sourceNodeModulesDir, packageName);
  if (!existsSync(sourcePath)) {
    return false;
  }

  const isPartialPackage =
    existsSync(targetPath) &&
    !existsSync(path.join(targetPath, "package.json")) &&
    existsSync(path.join(sourcePath, "package.json"));
  if (existsSync(targetPath) && !isPartialPackage) {
    return true;
  }

  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.cp(sourcePath, targetPath, {
    recursive: true,
    force: true,
    verbatimSymlinks: false,
  });
  return true;
}

async function copyMissingStandalonePackageDependencies() {
  const standaloneNodeModulesDir = path.join(uiStandaloneDir, "standalone_node_modules");
  const sourceNodeModulesDir = path.join(uiDir, "node_modules");
  if (!existsSync(standaloneNodeModulesDir) || !existsSync(sourceNodeModulesDir)) {
    return;
  }

  const packageNames = [...standaloneDependencyRoots];
  const queuedPackageNames = new Set(packageNames);
  for (let index = 0; index < packageNames.length; index += 1) {
    const packageName = packageNames[index];
    const available = await ensureStandalonePackage(
      packageName,
      sourceNodeModulesDir,
      standaloneNodeModulesDir
    );
    if (!available) {
      continue;
    }

    const manifest = await readJsonIfExists(
      path.join(packagePath(standaloneNodeModulesDir, packageName), "package.json")
    );
    if (!manifest) {
      continue;
    }

    for (const dependencyName of dependencyNames(manifest)) {
      if (queuedPackageNames.has(dependencyName)) {
        continue;
      }

      const availableDependency = await ensureStandalonePackage(
        dependencyName,
        sourceNodeModulesDir,
        standaloneNodeModulesDir
      );
      if (availableDependency) {
        packageNames.push(dependencyName);
        queuedPackageNames.add(dependencyName);
      }
    }
  }
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

function pythonBuildBinary() {
  const explicitPython = process.env.INTERNAGENTS_PYTHON_BIN;
  if (explicitPython) {
    return explicitPython;
  }

  const explicitRuntime = process.env.INTERNAGENTS_PYTHON_RUNTIME_SOURCE;
  const candidates =
    process.platform === "win32"
      ? [
          explicitRuntime ? path.join(explicitRuntime, "venv", "Scripts", "python.exe") : "",
          explicitRuntime ? path.join(explicitRuntime, ".venv", "Scripts", "python.exe") : "",
          explicitRuntime ? path.join(explicitRuntime, "Scripts", "python.exe") : "",
          explicitRuntime ? path.join(explicitRuntime, "python.exe") : "",
          path.join(rootDir, ".venv", "Scripts", "python.exe"),
          path.join(rootDir, ".conda", "python.exe"),
          "python",
        ].filter(Boolean)
      : [
          explicitRuntime ? path.join(explicitRuntime, "venv", "bin", "python") : "",
          explicitRuntime ? path.join(explicitRuntime, ".venv", "bin", "python") : "",
          explicitRuntime ? path.join(explicitRuntime, "bin", "python") : "",
          path.join(rootDir, ".venv", "bin", "python"),
          path.join(rootDir, ".conda", "bin", "python"),
          "python3",
        ].filter(Boolean);

  for (const candidate of candidates) {
    if (!candidate.includes(path.sep) || existsSync(candidate)) {
      return candidate;
    }
  }
  return process.platform === "win32" ? "python" : "python3";
}

function projectDependencyRequirements(pythonBin) {
  const script = [
    "import pathlib, subprocess, sys, tomllib",
    "data = tomllib.loads(pathlib.Path('pyproject.toml').read_text())",
    "build = data.get('build-system', {}).get('requires', [])",
    "frozen = subprocess.check_output([sys.executable, '-m', 'pip', 'freeze', '--exclude-editable'], text=True)",
    "deps = ['pip==25.3', *build, *frozen.splitlines()]",
    "for dep in deps:",
    "    dep = dep.strip()",
    "    if dep and ' @ file://' not in dep:",
    "        print(dep)",
  ].join("\n");
  const result = spawnSync(pythonBin, ["-c", script], {
    cwd: rootDir,
    encoding: "utf8",
    shell: false,
  });
  if (result.status !== 0) {
    throw new Error(
      `Unable to read backend dependencies from pyproject.toml: ${
        result.stderr || result.stdout
      }`
    );
  }
  return Array.from(
    new Set(
      result.stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
    )
  );
}

function requirementName(requirement) {
  return (
    requirement
      .trim()
      .match(/^([A-Za-z0-9_.-]+)/)?.[1]
      ?.toLowerCase()
      .replace(/_/g, "-") || ""
  );
}

async function prepareBackendWheelhouse() {
  const pythonBin = pythonBuildBinary();
  const wheelhouseDir = path.join(templateDir, backendWheelhouseDirName);
  const requirementsPath = path.join(distDir, "backend-wheelhouse-requirements.txt");
  const sourceRequirementsPath = path.join(
    distDir,
    "backend-wheelhouse-source-requirements.txt"
  );
  const requirements = projectDependencyRequirements(pythonBin);
  const sourceRequirements = requirements.filter((requirement) =>
    backendSourceDistributions.has(requirementName(requirement))
  );
  const binaryRequirements = requirements.filter(
    (requirement) => !backendSourceDistributions.has(requirementName(requirement))
  );

  await fs.rm(wheelhouseDir, { recursive: true, force: true });
  await fs.mkdir(wheelhouseDir, { recursive: true });
  await fs.writeFile(requirementsPath, `${binaryRequirements.join("\n")}\n`);
  await fs.writeFile(sourceRequirementsPath, `${sourceRequirements.join("\n")}\n`);

  for (const target of backendWheelhouseTargets) {
    const platformArgs = target.platforms.flatMap((platform) => [
      "--platform",
      platform,
    ]);
    run(pythonBin, [
      "-m",
      "pip",
      "download",
      "--dest",
      wheelhouseDir,
      "--no-deps",
      "--only-binary=:all:",
      ...platformArgs,
      "--implementation",
      "cp",
      "--python-version",
      target.pythonVersion,
      "--abi",
      target.abi,
      "-r",
      requirementsPath,
    ]);
  }
  if (sourceRequirements.length > 0) {
    run(pythonBin, [
      "-m",
      "pip",
      "download",
      "--dest",
      wheelhouseDir,
      "--no-deps",
      "-r",
      sourceRequirementsPath,
    ]);
  }
}

async function prepareBackendCliArchive() {
  const archivePath = path.join(templateDir, backendCliArchiveName);
  const temporaryArchivePath = path.join(distDir, backendCliArchiveName);

  await fs.rm(archivePath, { force: true });
  await fs.rm(temporaryArchivePath, { force: true });
  run("tar", ["-czf", temporaryArchivePath, "-C", templateDir, "."]);
  await fs.cp(temporaryArchivePath, archivePath, {
    force: true,
    verbatimSymlinks: false,
  });
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
  await validatePythonRuntime();
  if (process.platform !== "win32") {
    await rewriteRuntimeSymlinks(path.resolve(pythonSource));
    await normalizePythonLinks();
    await assertNoExternalRuntimeSymlinks();
  }
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

async function validatePythonRuntime() {
  const candidates =
    process.platform === "win32"
      ? [
          path.join(pythonRuntimeDir, "venv", "Scripts", "pythonw.exe"),
          path.join(pythonRuntimeDir, "venv", "Scripts", "python.exe"),
          path.join(pythonRuntimeDir, ".venv", "Scripts", "pythonw.exe"),
          path.join(pythonRuntimeDir, ".venv", "Scripts", "python.exe"),
          path.join(pythonRuntimeDir, "pythonw.exe"),
          path.join(pythonRuntimeDir, "python.exe"),
          path.join(pythonRuntimeDir, "Scripts", "pythonw.exe"),
          path.join(pythonRuntimeDir, "Scripts", "python.exe"),
          path.join(pythonRuntimeDir, "bin", "pythonw.exe"),
          path.join(pythonRuntimeDir, "bin", "python.exe"),
        ]
      : [
          path.join(pythonRuntimeDir, "venv", "bin", "python"),
          path.join(pythonRuntimeDir, ".venv", "bin", "python"),
          path.join(pythonRuntimeDir, "bin", "python3.12"),
          path.join(pythonRuntimeDir, "bin", "python3.11"),
          path.join(pythonRuntimeDir, "bin", "python3"),
          path.join(pythonRuntimeDir, "bin", "python"),
        ];

  if (candidates.some((candidate) => existsSync(candidate))) {
    return;
  }

  throw new Error(
    `Python runtime at ${pythonRuntimeDir} does not contain a usable Python executable.`
  );
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
  await prepareBackendWheelhouse();
  await prepareBackendCliArchive();
  await preparePythonRuntime();

  console.log(`Prepared desktop resources at ${distDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
