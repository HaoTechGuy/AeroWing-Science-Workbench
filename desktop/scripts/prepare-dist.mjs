import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(__dirname, "..");
const rootDir = path.resolve(desktopDir, "..");
const uiDir = path.join(rootDir, "ui");
const desktopTemplateDir = path.join(desktopDir, "templates");
const desktopDistDir = path.join(rootDir, "dist-app");
const remoteDistDir = path.join(rootDir, "dist-remote");
let distDir = desktopDistDir;
let uiStandaloneDir = path.join(distDir, "ui-standalone");
let templateDir = path.join(distDir, "internagents-template");
let pythonRuntimeDir = path.join(distDir, "python-runtime");
let officeToolsDir = path.join(distDir, "office-tools");
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
const backendLinuxWheelhouseExcludedRequirements = new Set(["pywin32"]);
const backendRuntimeBinaryRequirements = ["httptools>=0.5.0", "uvloop>=0.18.0"];
const officePythonImportChecks = [
  ["defusedxml", "defusedxml"],
  ["lxml.etree", "lxml"],
  ["pandas", "pandas"],
  ["openpyxl", "openpyxl"],
  ["markitdown", "markitdown[pptx]"],
];
const canCreatePortableSymlinks = process.platform !== "win32";
const standaloneCopyLinkOptions = {
  verbatimSymlinks: canCreatePortableSymlinks,
  dereference: !canCreatePortableSymlinks,
};

function configureDistDirectories(nextDistDir, templateDirectoryName) {
  distDir = nextDistDir;
  uiStandaloneDir = path.join(distDir, "ui-standalone");
  templateDir = path.join(distDir, templateDirectoryName);
  pythonRuntimeDir = path.join(distDir, "python-runtime");
  officeToolsDir = path.join(distDir, "office-tools");
}

// Keep this as an explicit runtime allowlist. Development-only docs such as
// AGENTS.md, README.md, and docs/ stay in Git but out of packaged apps.
// Bundled imported skills are copied separately from .internagents/imported-skills.
const runtimeEntries = [
  ".env.example",
  "agent.py",
  "main.py",
  "internagents",
  "internagent.resources.json",
  "internagent.resources.example.json",
  "langgraph.json",
  "langgraph.runtime.json",
  "pyproject.toml",
  "requirements.txt",
  "skills",
];
// Developer-only skills can stay in Git, but should not ship to user runtimes.
const runtimeSkillExcludedDirectories = new Set(["codex"]);

function shouldCopyRuntimeSkill(source) {
  const skillsRoot = path.join(rootDir, "skills");
  const relativePath = path.relative(skillsRoot, source);
  if (!relativePath) {
    return true;
  }

  const [topLevelDirectory] = relativePath.split(path.sep);
  return !runtimeSkillExcludedDirectories.has(topLevelDirectory);
}

function runtimeCopyOptions(entry) {
  if (entry === "internagents") {
    return {
      filter: (source) => {
        const name = path.basename(source);
        return name !== "__pycache__" && !name.endsWith(".pyc");
      },
    };
  }

  if (entry === "skills") {
    return {
      filter: (source) => shouldCopyRuntimeSkill(source),
    };
  }

  return {};
}

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

function executableName(name) {
  return process.platform === "win32" ? `${name}.exe` : name;
}

function findExecutableOnPath(command) {
  const lookupCommand = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(lookupCommand, [command], {
    encoding: "utf8",
    shell: false,
  });
  if (result.status !== 0) {
    return "";
  }
  return (
    result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) || ""
  );
}

function findNamedExecutable(directory, names) {
  if (!existsSync(directory)) {
    return "";
  }

  const stack = [directory];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (
        (entry.isFile() || entry.isSymbolicLink()) &&
        names.has(entry.name.toLowerCase())
      ) {
        return entryPath;
      }
      if (entry.isDirectory()) {
        stack.push(entryPath);
      }
    }
  }
  return "";
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
        `${resolved.executable} ${resolved.args.join(" ")} failed: ${
          result.error.message
        }`
      );
    }
    throw new Error(`${command} ${args.join(" ")} failed`);
  }
}

async function copyIfExists(source, destination, options = {}) {
  if (!existsSync(source)) {
    return;
  }
  await fs.mkdir(path.dirname(destination), { recursive: true });
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
    throw new Error(
      "Next standalone output is missing. Check ui/next.config.ts."
    );
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

  await copyIfExists(
    path.join(uiDir, ".next", "static"),
    path.join(serverDir, ".next", "static")
  );
  await copyIfExists(
    path.join(uiDir, "public"),
    path.join(serverDir, "public")
  );
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
  const standaloneNodeModulesDir = path.join(
    uiStandaloneDir,
    "standalone_node_modules"
  );
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

    const relativeTarget = path.relative(
      path.dirname(entryPath),
      bundledTarget
    );
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
      const scopedEntries = await fs.readdir(
        path.join(nodeModulesDir, entry.name),
        {
          withFileTypes: true,
        }
      );
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
  const standaloneNodeModulesDir = path.join(
    uiStandaloneDir,
    "standalone_node_modules"
  );
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
    const manifest = await readJsonIfExists(
      path.join(currentPackagePath, "package.json")
    );
    if (!manifest) {
      continue;
    }

    for (const dependencyName of dependencyNames(manifest)) {
      const dependencyPath = packagePaths.get(dependencyName);
      if (!dependencyPath || dependencyPath === currentPackagePath) {
        continue;
      }

      await ensureDirectoryLink(
        packagePath(
          path.join(currentPackagePath, "node_modules"),
          dependencyName
        ),
        dependencyPath
      );
    }
  }
}

async function ensureStandalonePackage(
  packageName,
  sourceNodeModulesDir,
  targetNodeModulesDir
) {
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
  const standaloneNodeModulesDir = path.join(
    uiStandaloneDir,
    "standalone_node_modules"
  );
  const sourceNodeModulesDir = path.join(uiDir, "node_modules");
  if (
    !existsSync(standaloneNodeModulesDir) ||
    !existsSync(sourceNodeModulesDir)
  ) {
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
      path.join(
        packagePath(standaloneNodeModulesDir, packageName),
        "package.json"
      )
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
    await copyIfExists(
      path.join(rootDir, entry),
      path.join(templateDir, entry),
      runtimeCopyOptions(entry)
    );
  }
  await copyIfExists(
    path.join(desktopTemplateDir, "deepagent.config.json"),
    path.join(templateDir, "deepagent.config.json")
  );
  await prepareBundledImportedSkills();
}

async function prepareBundledImportedSkills() {
  const sourceRoot = path.join(rootDir, ".internagents", "imported-skills");
  const destinationRoot = path.join(templateDir, ".internagents", "imported-skills");
  if (!existsSync(sourceRoot)) {
    return;
  }

  const entries = await fs.readdir(sourceRoot, { withFileTypes: true });
  let copied = 0;
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const sourcePath = path.join(sourceRoot, entry.name);
    if (!existsSync(path.join(sourcePath, "SKILL.md"))) {
      continue;
    }

    const destinationPath = path.join(destinationRoot, entry.name);
    await fs.rm(destinationPath, { recursive: true, force: true });
    await copyIfExists(sourcePath, destinationPath, {
      dereference: true,
    });
    copied += 1;
  }

  if (copied > 0) {
    console.log(`Bundled ${copied} imported skill(s).`);
  }
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
          explicitRuntime
            ? path.join(explicitRuntime, "venv", "Scripts", "python.exe")
            : "",
          explicitRuntime
            ? path.join(explicitRuntime, ".venv", "Scripts", "python.exe")
            : "",
          explicitRuntime
            ? path.join(explicitRuntime, "Scripts", "python.exe")
            : "",
          explicitRuntime ? path.join(explicitRuntime, "python.exe") : "",
          path.join(rootDir, ".venv", "Scripts", "python.exe"),
          path.join(rootDir, ".conda", "python.exe"),
          "python",
        ].filter(Boolean)
      : [
          explicitRuntime
            ? path.join(explicitRuntime, "venv", "bin", "python")
            : "",
          explicitRuntime
            ? path.join(explicitRuntime, ".venv", "bin", "python")
            : "",
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
    "import pathlib, re, subprocess, sys, tomllib",
    "data = tomllib.loads(pathlib.Path('pyproject.toml').read_text())",
    "build = []",
    "for dep in data.get('build-system', {}).get('requires', []):",
    "    name = dep.split('>=', 1)[0].split('==', 1)[0].strip().lower().replace('_', '-')",
    "    if name == 'setuptools':",
    "        build.append('setuptools==82.0.1')",
    "    elif name == 'wheel':",
    "        build.append('wheel==0.47.0')",
    "    else:",
    "        build.append(dep)",
    "frozen = subprocess.check_output([sys.executable, '-m', 'pip', 'freeze', '--exclude-editable'], text=True)",
    "deps = ['pip==25.3', *build, *frozen.splitlines()]",
    "for dep in deps:",
    "    dep = dep.strip()",
    "    if dep and ' @ file://' not in dep:",
    "        match = re.match(r'^([A-Za-z0-9_.-]+)==', dep)",
    "        name = match.group(1).lower().replace('_', '-') if match else ''",
    "        if name == 'numpy':",
    "            dep = 'numpy>=2.0,<2.5'",
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
  const requirementsPath = path.join(
    distDir,
    "backend-wheelhouse-requirements.txt"
  );
  const sourceRequirementsPath = path.join(
    distDir,
    "backend-wheelhouse-source-requirements.txt"
  );
  const requirements = projectDependencyRequirements(pythonBin).filter(
    (requirement) =>
      !backendLinuxWheelhouseExcludedRequirements.has(
        requirementName(requirement)
      )
  );
  const sourceRequirements = requirements.filter((requirement) =>
    backendSourceDistributions.has(requirementName(requirement))
  );
  const binaryRequirements = requirements.filter(
    (requirement) =>
      !backendSourceDistributions.has(requirementName(requirement))
  );
  for (const requirement of backendRuntimeBinaryRequirements) {
    if (
      !binaryRequirements.some(
        (item) => requirementName(item) === requirementName(requirement)
      )
    ) {
      binaryRequirements.push(requirement);
    }
  }

  await fs.rm(wheelhouseDir, { recursive: true, force: true });
  await fs.mkdir(wheelhouseDir, { recursive: true });
  await fs.writeFile(requirementsPath, `${binaryRequirements.join("\n")}\n`);
  await fs.writeFile(
    sourceRequirementsPath,
    `${sourceRequirements.join("\n")}\n`
  );

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

async function prepareBackendCliArchive(options = {}) {
  const archivePath =
    options.archivePath || path.join(templateDir, backendCliArchiveName);
  const temporaryArchivePath = path.join(
    distDir,
    `.tmp-${backendCliArchiveName}`
  );

  await fs.rm(archivePath, { force: true });
  await fs.rm(temporaryArchivePath, { force: true });
  run("tar", ["-czf", temporaryArchivePath, "-C", templateDir, "."]);
  await fs.cp(temporaryArchivePath, archivePath, {
    force: true,
    verbatimSymlinks: false,
  });
  await fs.rm(temporaryArchivePath, { force: true });
  return archivePath;
}

async function copyExecutable(source, destination) {
  const realSource = await fs.realpath(source);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.cp(realSource, destination, {
    recursive: true,
    force: true,
    verbatimSymlinks: false,
  });
  if (process.platform !== "win32") {
    await fs.chmod(destination, 0o755).catch(() => undefined);
  }
}

function validateExecutable(command, args, env = process.env) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    env,
    shell: false,
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed: ${
        result.error?.message || result.stderr || result.stdout
      }`
    );
  }
}

async function preparePandocBinary() {
  const source =
    process.env.INTERNAGENTS_PANDOC_BIN || findExecutableOnPath("pandoc");
  if (!source || !existsSync(source)) {
    throw new Error(
      "Office attachment packaging requires pandoc. Set INTERNAGENTS_PANDOC_BIN or install pandoc on the build machine."
    );
  }

  const destination = path.join(officeToolsDir, "bin", executableName("pandoc"));
  await copyExecutable(source, destination);
  validateExecutable(destination, ["--version"]);
  console.log(`Bundled pandoc at ${path.relative(distDir, destination)}.`);
}

function libreOfficeSourceCandidates() {
  return uniquePaths([
    process.env.INTERNAGENTS_LIBREOFFICE_RUNTIME_SOURCE,
    process.platform === "darwin" ? "/Applications/LibreOffice.app" : "",
  ]);
}

async function prepareLibreOfficeRuntime() {
  const destinationRoot = path.join(officeToolsDir, "libreoffice");
  const source = libreOfficeSourceCandidates().find((candidate) =>
    existsSync(candidate)
  );

  if (!source) {
    if (process.env.INTERNAGENTS_SKIP_LIBREOFFICE_RUNTIME === "1") {
      await fs.mkdir(destinationRoot, { recursive: true });
      await fs.writeFile(
        path.join(destinationRoot, "README.txt"),
        [
          "LibreOffice runtime was intentionally not bundled.",
          "Legacy .doc/.xls/.ppt conversion is disabled for this package.",
        ].join("\n")
      );
      console.warn(
        "LibreOffice runtime was skipped; legacy .doc/.xls/.ppt conversion will be unavailable in packaged apps."
      );
      return;
    }
    throw new Error(
      "Office attachment packaging requires LibreOffice for legacy .doc/.xls/.ppt conversion. Set INTERNAGENTS_LIBREOFFICE_RUNTIME_SOURCE or INTERNAGENTS_SKIP_LIBREOFFICE_RUNTIME=1."
    );
  }

  const stat = statSync(source);
  const destination = stat.isDirectory()
    ? path.join(destinationRoot, path.basename(source))
    : path.join(destinationRoot, "bin", path.basename(source));
  await fs.mkdir(destinationRoot, { recursive: true });
  await fs.cp(await fs.realpath(source), destination, {
    recursive: stat.isDirectory(),
    force: true,
    verbatimSymlinks: false,
  });

  const soffice = findNamedExecutable(
    destinationRoot,
    new Set([executableName("soffice").toLowerCase()])
  );
  if (!soffice) {
    throw new Error(
      `LibreOffice runtime source ${source} did not contain a soffice executable.`
    );
  }

  validateExecutable(soffice, ["--version"], {
    ...process.env,
    SAL_USE_VCLPLUGIN: "svp",
  });
  console.log(`Bundled LibreOffice at ${path.relative(distDir, soffice)}.`);
}

async function prepareOfficeTools() {
  await fs.rm(officeToolsDir, { recursive: true, force: true });
  await fs.mkdir(officeToolsDir, { recursive: true });
  await preparePandocBinary();
  await prepareLibreOfficeRuntime();
}

function uniquePaths(paths) {
  const seen = new Set();
  return paths.filter((candidate) => {
    if (!candidate) {
      return false;
    }
    const key =
      process.platform === "win32" ? candidate.toLowerCase() : candidate;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function isDirectory(candidate) {
  try {
    return statSync(candidate).isDirectory();
  } catch {
    return false;
  }
}

function existingDirectories(paths) {
  return uniquePaths(paths).filter(isDirectory);
}

function bundledWindowsBasePythonCandidates(runtimeDir) {
  if (process.platform !== "win32") {
    return [];
  }

  const candidates = [
    path.join(
      runtimeDir,
      "python",
      "cpython-3.12-windows-x86_64-none",
      "python.exe"
    ),
    path.join(
      runtimeDir,
      "python",
      "cpython-3.11-windows-x86_64-none",
      "python.exe"
    ),
    path.join(runtimeDir, "python", "python.exe"),
  ];
  const pythonRoot = path.join(runtimeDir, "python");

  try {
    for (const entry of readdirSync(pythonRoot, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        candidates.push(path.join(pythonRoot, entry.name, "python.exe"));
      }
    }
  } catch {
    // A copied conda-style runtime may not have a managed-python directory.
  }

  return uniquePaths(candidates);
}

function pythonRuntimeCandidates(runtimeDir) {
  return process.platform === "win32"
    ? [
        ...bundledWindowsBasePythonCandidates(runtimeDir),
        path.join(runtimeDir, "python.exe"),
        path.join(runtimeDir, "pythonw.exe"),
        path.join(runtimeDir, "Scripts", "python.exe"),
        path.join(runtimeDir, "Scripts", "pythonw.exe"),
        path.join(runtimeDir, "bin", "python.exe"),
        path.join(runtimeDir, "bin", "pythonw.exe"),
        path.join(runtimeDir, "venv", "Scripts", "python.exe"),
        path.join(runtimeDir, "venv", "Scripts", "pythonw.exe"),
        path.join(runtimeDir, ".venv", "Scripts", "python.exe"),
        path.join(runtimeDir, ".venv", "Scripts", "pythonw.exe"),
      ]
    : [
        path.join(runtimeDir, "venv", "bin", "python"),
        path.join(runtimeDir, ".venv", "bin", "python"),
        path.join(runtimeDir, "bin", "python3.12"),
        path.join(runtimeDir, "bin", "python3.11"),
        path.join(runtimeDir, "bin", "python3"),
        path.join(runtimeDir, "bin", "python"),
      ];
}

function runtimeSitePackages(runtimeDir) {
  return process.platform === "win32"
    ? existingDirectories([
        path.join(runtimeDir, "venv", "Lib", "site-packages"),
        path.join(runtimeDir, ".venv", "Lib", "site-packages"),
        path.join(runtimeDir, "Lib", "site-packages"),
      ])
    : existingDirectories([
        path.join(runtimeDir, "venv", "lib", "python3.12", "site-packages"),
        path.join(runtimeDir, "venv", "lib", "python3.11", "site-packages"),
        path.join(runtimeDir, ".venv", "lib", "python3.12", "site-packages"),
        path.join(runtimeDir, ".venv", "lib", "python3.11", "site-packages"),
      ]);
}

function envPathKey(env) {
  return Object.keys(env).find((key) => key.toLowerCase() === "path") || "PATH";
}

function pythonRuntimeEnv(runtimeDir, baseEnv = process.env) {
  const env = {
    PYTHONDONTWRITEBYTECODE: "1",
    PYTHONNOUSERSITE: "1",
    PYTHONUTF8: "1",
  };
  const sitePackages = runtimeSitePackages(runtimeDir);

  if (sitePackages.length > 0) {
    env.PYTHONPATH = uniquePaths([
      ...sitePackages,
      baseEnv.PYTHONPATH || "",
    ]).join(path.delimiter);
  }

  if (process.platform === "win32") {
    const basePythonDirs = existingDirectories(
      bundledWindowsBasePythonCandidates(runtimeDir).map((candidate) =>
        path.dirname(candidate)
      )
    );
    const dllDirs = existingDirectories(
      basePythonDirs.map((directory) => path.join(directory, "DLLs"))
    );
    const pathKey = envPathKey(baseEnv);
    const pathValue = uniquePaths([
      ...basePythonDirs,
      ...dllDirs,
      baseEnv[pathKey] || "",
    ]).join(path.delimiter);
    if (pathValue) {
      env[pathKey] = pathValue;
    }
  }

  return env;
}

function isInsidePath(childPath, parentPath) {
  const relative = path.relative(
    path.resolve(parentPath),
    path.resolve(childPath)
  );
  return (
    relative === "" ||
    Boolean(relative && !relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

function readPyvenvHome(pyvenvPath) {
  if (!existsSync(pyvenvPath)) {
    return "";
  }

  for (const line of readFileSync(pyvenvPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*home\s*=\s*(.+?)\s*$/);
    if (match) {
      return match[1];
    }
  }
  return "";
}

function isPortablePythonCandidate(candidate, runtimeDir) {
  if (process.platform !== "win32") {
    return true;
  }

  const resolvedCandidate = path.resolve(candidate);
  for (const venvDir of [
    path.join(runtimeDir, "venv"),
    path.join(runtimeDir, ".venv"),
  ]) {
    const scriptsDir = path.join(venvDir, "Scripts");
    if (!isInsidePath(resolvedCandidate, scriptsDir)) {
      continue;
    }

    const home = readPyvenvHome(path.join(venvDir, "pyvenv.cfg"));
    if (home && path.isAbsolute(home) && !isInsidePath(home, runtimeDir)) {
      return false;
    }
  }

  return true;
}

function pythonSmokeTest(candidate, runtimeDir) {
  const script = [
    "import sys",
    "required = " + JSON.stringify(officePythonImportChecks),
    "missing = []",
    "for module_name, package_name in required:",
    "    try:",
    "        __import__(module_name)",
    "    except Exception as exc:",
    "        missing.append(f'{package_name} ({module_name}): {exc}')",
    "try:",
    "    import langgraph_cli",
    "except Exception as exc:",
    "    missing.append(f'langgraph-cli[inmem] (langgraph_cli): {exc}')",
    "if sys.version_info < (3, 11):",
    "    missing.append('Python >= 3.11 is required')",
    "if missing:",
    "    raise SystemExit('Missing bundled Python runtime dependency:\\n- ' + '\\n- '.join(missing))",
  ].join("\n");
  const result = spawnSync(
    candidate,
    ["-c", script],
    {
      cwd: rootDir,
      encoding: "utf8",
      env: {
        ...process.env,
        ...pythonRuntimeEnv(runtimeDir, process.env),
      },
      shell: false,
      windowsHide: true,
    }
  );

  return {
    ok: result.status === 0,
    message:
      result.error?.message ||
      result.stderr?.trim() ||
      result.stdout?.trim() ||
      `exit status ${result.status}`,
  };
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
  if (process.platform !== "win32") {
    await rewriteRuntimeSymlinks(path.resolve(pythonSource));
    await materializeExternalPythonSymlinks();
    await normalizePythonLinks();
    await assertNoExternalRuntimeSymlinks();
  }
  await validatePythonRuntime();
}

async function relink(linkPath, targetName) {
  try {
    await fs.rm(linkPath, { force: true });
    await fs.symlink(targetName, linkPath);
  } catch (error) {
    throw new Error(
      `Unable to create ${linkPath} -> ${targetName}: ${error.message}`
    );
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
  const attempts = [];
  for (const candidate of uniquePaths(pythonRuntimeCandidates(pythonRuntimeDir))) {
    if (!existsSync(candidate)) {
      continue;
    }

    const relativeCandidate = path.relative(pythonRuntimeDir, candidate);
    if (!isPortablePythonCandidate(candidate, pythonRuntimeDir)) {
      attempts.push(
        `${relativeCandidate}: skipped because pyvenv.cfg points outside the bundled runtime`
      );
      continue;
    }

    const result = pythonSmokeTest(candidate, pythonRuntimeDir);
    if (result.ok) {
      console.log(`Validated Python runtime with ${relativeCandidate}.`);
      return;
    }

    attempts.push(`${relativeCandidate}: ${result.message}`);
  }

  throw new Error(
    [
      `Python runtime at ${pythonRuntimeDir} does not contain a usable bundled Python executable.`,
      ...attempts.map((attempt) => `- ${attempt}`),
    ].join("\n")
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

async function pruneWindowsUiStandalone() {
  if (process.platform !== "win32") {
    return;
  }

  let removedFiles = 0;
  let removedBytes = 0;
  await walk(uiStandaloneDir, async (entryPath, entry) => {
    if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".map") {
      return;
    }

    const stat = await fs.stat(entryPath);
    await fs.rm(entryPath, { force: true });
    removedFiles += 1;
    removedBytes += stat.size;
  });

  console.log(
    `Pruned ${removedFiles} UI source map files from Windows package (${formatBytes(
      removedBytes
    )}).`
  );
}

async function pruneWindowsPythonRuntime() {
  if (process.platform !== "win32") {
    return;
  }

  let removedFiles = 0;
  let removedBytes = 0;
  const pycacheDirs = [];
  await walk(pythonRuntimeDir, async (entryPath, entry) => {
    if (entry.isDirectory() && entry.name === "__pycache__") {
      pycacheDirs.push(entryPath);
      return;
    }

    if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".pyc") {
      return;
    }

    const stat = await fs.stat(entryPath);
    await fs.rm(entryPath, { force: true });
    removedFiles += 1;
    removedBytes += stat.size;
  });

  for (const directory of pycacheDirs.sort(
    (left, right) => right.length - left.length
  )) {
    await fs.rm(directory, { recursive: true, force: true });
  }

  console.log(
    `Pruned ${removedFiles} Python bytecode files from Windows package (${formatBytes(
      removedBytes
    )}).`
  );
}

function formatBytes(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
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

    const relativeTarget = path.relative(
      path.dirname(entryPath),
      bundledTarget
    );
    await fs.rm(entryPath, { force: true });
    await fs.symlink(relativeTarget || path.basename(bundledTarget), entryPath);
  });
}

async function materializeExternalPythonSymlinks() {
  const binDir = path.join(pythonRuntimeDir, "bin");
  const bundledRoot = path.resolve(pythonRuntimeDir);
  await walk(binDir, async (entryPath, entry) => {
    if (!entry.isSymbolicLink()) {
      return;
    }

    const name = path.basename(entryPath);
    if (!/^python(?:\d+(?:\.\d+)*)?$/.test(name)) {
      return;
    }

    const linkTarget = await fs.readlink(entryPath);
    const absoluteTarget = path.isAbsolute(linkTarget)
      ? linkTarget
      : path.resolve(path.dirname(entryPath), linkTarget);
    const resolvedTarget = await fs.realpath(absoluteTarget).catch(() => "");
    if (!resolvedTarget || resolvedTarget.startsWith(`${bundledRoot}${path.sep}`)) {
      return;
    }

    const targetStat = await fs.stat(resolvedTarget).catch(() => null);
    if (!targetStat?.isFile()) {
      return;
    }

    await fs.rm(entryPath, { force: true });
    await copyExecutable(resolvedTarget, entryPath);
    console.log(
      `Materialized external Python runtime symlink ${path.relative(
        pythonRuntimeDir,
        entryPath
      )}.`
    );
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

async function prepareDesktopDist() {
  configureDistDirectories(desktopDistDir, "internagents-template");
  await fs.rm(distDir, { recursive: true, force: true });
  await fs.mkdir(distDir, { recursive: true });

  await prepareUiStandalone();
  await pruneWindowsUiStandalone();
  await prepareRuntimeTemplate();
  await prepareBackendWheelhouse();
  await prepareBackendCliArchive();
  await preparePythonRuntime();
  await prepareOfficeTools();
  await pruneWindowsPythonRuntime();

  console.log(`Prepared desktop resources at ${distDir}`);
}

async function prepareRemoteBackendPackage() {
  configureDistDirectories(remoteDistDir, "package");
  await fs.rm(distDir, { recursive: true, force: true });
  await fs.mkdir(distDir, { recursive: true });

  await prepareRuntimeTemplate();
  await prepareBackendWheelhouse();
  const archivePath = await prepareBackendCliArchive({
    archivePath: path.join(distDir, backendCliArchiveName),
  });
  await fs.rm(templateDir, { recursive: true, force: true });
  await fs.rm(path.join(distDir, "backend-wheelhouse-requirements.txt"), {
    force: true,
  });
  await fs.rm(path.join(distDir, "backend-wheelhouse-source-requirements.txt"), {
    force: true,
  });

  console.log(`Prepared remote backend package at ${archivePath}`);
}

async function main() {
  const mode = process.argv[2] || "--desktop";
  if (mode === "--desktop") {
    await prepareDesktopDist();
    return;
  }
  if (mode === "--remote") {
    await prepareRemoteBackendPackage();
    return;
  }
  throw new Error(`Unknown prepare-dist mode: ${mode}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
