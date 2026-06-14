const { app, BrowserWindow, dialog, nativeTheme, shell } = require("electron");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const crypto = require("node:crypto");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const HOST = "127.0.0.1";
const PRESERVED_RUNTIME_FILES = new Set([
  ".env",
  "deepagent.config.json",
  "internagent.resources.json",
  "internagent.resources.local.json",
]);

let mainWindow = null;
let splashWindow = null;
let nextProcess = null;
let runtimeRoot = "";
let splashStatus = "Starting InternAgents...";

app.setName("InternAgents");

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

app.on("second-instance", () => {
  if (!mainWindow && splashWindow) {
    splashWindow.show();
    splashWindow.focus();
    return;
  }
  if (!mainWindow) {
    return;
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
});

function resourcesRoot() {
  if (app.isPackaged) {
    return process.resourcesPath;
  }
  return path.resolve(__dirname, "..", "..", "dist-app");
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function splashPath() {
  return path.join(__dirname, "splash.html");
}

function runSplashScript(script) {
  if (!splashWindow || splashWindow.isDestroyed()) {
    return;
  }
  try {
    splashWindow.webContents.executeJavaScript(script).catch(() => {
      // The splash is cosmetic; startup should not depend on renderer updates.
    });
  } catch {
    // The splash may be closing while the main window takes over.
  }
}

function updateSplashStatus(message) {
  splashStatus = message;
  const script = `window.setSplashStatus && window.setSplashStatus(${JSON.stringify(
    message,
  )})`;
  if (!splashWindow || splashWindow.isDestroyed()) {
    return;
  }
  if (splashWindow.webContents.isLoading()) {
    splashWindow.webContents.once("did-finish-load", () => runSplashScript(script));
    return;
  }
  runSplashScript(script);
}

async function createSplashWindow() {
  if (splashWindow || mainWindow) {
    return;
  }

  splashWindow = new BrowserWindow({
    width: 460,
    height: 320,
    show: false,
    frame: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    title: "InternAgents",
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#10131a" : "#f7fbff",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  splashWindow.on("closed", () => {
    splashWindow = null;
  });

  await splashWindow.loadFile(splashPath());
  updateSplashStatus(splashStatus);
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.show();
  }
}

function closeSplashWindow() {
  if (!splashWindow || splashWindow.isDestroyed()) {
    splashWindow = null;
    return;
  }
  const currentSplash = splashWindow;
  splashWindow = null;
  currentSplash.close();
}

function requestJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request(url, options, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        let payload = {};
        try {
          payload = body ? JSON.parse(body) : {};
        } catch {
          payload = { raw: body };
        }
        resolve({ ok: response.statusCode >= 200 && response.statusCode < 300, payload });
      });
    });
    request.on("error", reject);
    request.end();
  });
}

function findAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, HOST, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}

async function waitForUrl(url, timeoutMs = 60000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await requestJson(url);
      if (response.ok) {
        return true;
      }
    } catch {
      // keep waiting
    }
    await wait(500);
  }
  return false;
}

async function findFile(directory, fileName) {
  const entries = await fsp.readdir(directory, { withFileTypes: true });
  if (entries.some((entry) => entry.isFile() && entry.name === fileName)) {
    return path.join(directory, fileName);
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const result = await findFile(path.join(directory, entry.name), fileName);
    if (result) {
      return result;
    }
  }
  return null;
}

async function copyRuntimeTemplate(source, destination) {
  await fsp.mkdir(destination, { recursive: true });
  const entries = await fsp.readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(source, entry.name);
    const destinationPath = path.join(destination, entry.name);
    if (PRESERVED_RUNTIME_FILES.has(entry.name) && fs.existsSync(destinationPath)) {
      continue;
    }
    if (entry.isDirectory()) {
      if (entry.name === ".internagents") {
        await fsp.mkdir(destinationPath, { recursive: true });
        await fsp.cp(sourcePath, destinationPath, {
          recursive: true,
          force: true,
          verbatimSymlinks: false,
        });
        continue;
      }
      await fsp.rm(destinationPath, { recursive: true, force: true });
      await fsp.cp(sourcePath, destinationPath, {
        recursive: true,
        force: true,
        verbatimSymlinks: false,
      });
    } else {
      await fsp.cp(sourcePath, destinationPath, {
        recursive: true,
        force: true,
        verbatimSymlinks: false,
      });
    }
  }
}

function envPath() {
  return path.join(runtimeRoot, ".env");
}

function readEnvValues(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }
  const values = {};
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || line.trim().startsWith("#")) {
      continue;
    }
    let value = match[2].trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

function hasInitialConfig() {
  const values = readEnvValues(envPath());
  return Boolean(
    (values.INTERNAGENTS_GATEWAY_KEY &&
      values.INTERNAGENTS_GATEWAY_KEY.trim()) ||
      (values.OPENROUTER_API_KEY && values.OPENROUTER_API_KEY.trim())
  );
}

async function defaultDesktopWorkspace() {
  const workspacePath = path.join(app.getPath("home"), "InternAgents-Workspace");
  await fsp.mkdir(workspacePath, { recursive: true });
  return workspacePath;
}

async function ensureRuntimeResources(runtimePort) {
  const envResourcesFile = readEnvValues(envPath()).INTERNAGENT_RESOURCES_FILE;
  const resourcesPaths = new Set([path.join(runtimeRoot, "internagent.resources.json")]);
  if (envResourcesFile && envResourcesFile.trim()) {
    const configuredPath = path.isAbsolute(envResourcesFile)
      ? envResourcesFile
      : path.join(runtimeRoot, envResourcesFile);
    resourcesPaths.add(configuredPath);
  }

  for (const resourcesPath of resourcesPaths) {
    await ensureRuntimeResourcesFile(resourcesPath, runtimePort);
  }
}

async function ensureRuntimeResourcesFile(resourcesPath, runtimePort) {
  let config = {
    default_resource: "local",
    resources: [],
  };

  try {
    if (fs.existsSync(resourcesPath)) {
      config = JSON.parse(fs.readFileSync(resourcesPath, "utf8"));
    }
  } catch {
    config = {
      default_resource: "local",
      resources: [],
    };
  }

  const resources = Array.isArray(config.resources) ? config.resources : [];
  const defaultWorkspace = await defaultDesktopWorkspace();
  const configured = hasInitialConfig();
  const localResource = resources.find((resource) => resource && resource.id === "local") || {
    id: "local",
    label: "Current Machine",
    backend: "local_shell",
    workspace: defaultWorkspace,
    enabled: true,
  };

  localResource.label ||= "Current Machine";
  localResource.backend ||= "local_shell";
  const shouldUseDefaultWorkspace =
    !localResource.workspace || (localResource.workspace === "." && !configured);
  if (shouldUseDefaultWorkspace) {
    localResource.workspace = defaultWorkspace;
  }
  localResource.remote_url = `http://${HOST}:${runtimePort}`;
  localResource.remote_assistant_id = "agent";
  localResource.enabled = localResource.enabled !== false;

  config.default_resource = config.default_resource || "local";
  config.resources = [
    localResource,
    ...resources.filter((resource) => resource && resource.id !== "local"),
  ];
  config.workspaces = ensureWorkspaceRecord(config.workspaces, localResource.workspace);
  if (shouldUseDefaultWorkspace || !config.default_workspace) {
    config.default_workspace = workspaceIdForPath(localResource.workspace);
  }

  await fsp.mkdir(path.dirname(resourcesPath), { recursive: true });
  await fsp.writeFile(resourcesPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

function workspaceIdForPath(workspacePath) {
  return `local-${crypto.createHash("sha1").update(workspacePath).digest("hex").slice(0, 12)}`;
}

function workspaceLabelForPath(workspacePath) {
  return path.basename(workspacePath) || workspacePath;
}

function ensureWorkspaceRecord(workspaces, workspacePath) {
  const existingWorkspaces = Array.isArray(workspaces) ? workspaces : [];
  const workspaceId = workspaceIdForPath(workspacePath);
  if (existingWorkspaces.some((workspace) => workspace && workspace.id === workspaceId)) {
    return existingWorkspaces;
  }
  return [
    {
      id: workspaceId,
      label: workspaceLabelForPath(workspacePath),
      path: workspacePath,
    },
    ...existingWorkspaces,
  ];
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

function existingDirectories(paths) {
  return uniquePaths(paths).filter((candidate) => {
    try {
      return fs.statSync(candidate).isDirectory();
    } catch {
      return false;
    }
  });
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
    for (const entry of fs.readdirSync(pythonRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }
      candidates.push(path.join(pythonRoot, entry.name, "python.exe"));
    }
  } catch {
    // Packaged apps without a bundled Python fall through to the system fallback.
  }

  return uniquePaths(candidates);
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

function pythonRuntimeEnv(baseEnv = process.env) {
  const runtimeDir = path.join(resourcesRoot(), "python-runtime");
  const env = {};
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

function canRunPython(candidate, env) {
  if (!fs.existsSync(candidate)) {
    return false;
  }

  const result = spawnSync(
    candidate,
    [
      "-c",
      "import sys; import langgraph_cli; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)",
    ],
    {
      env,
      windowsHide: true,
      stdio: "ignore",
    }
  );
  return result.status === 0;
}

function pythonBinary() {
  const runtimeDir = path.join(resourcesRoot(), "python-runtime");
  const env = {
    ...process.env,
    ...pythonRuntimeEnv(process.env),
  };
  const candidates =
    process.platform === "win32"
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

  for (const candidate of uniquePaths(candidates)) {
    if (canRunPython(candidate, env)) {
      return candidate;
    }
  }
  return process.platform === "win32" ? "python" : "python3";
}

function nodeHostBinary() {
  if (process.platform === "darwin" && app.isPackaged) {
    const helperName = `${path.basename(process.execPath)} Helper`;
    const helperPath = path.resolve(
      path.dirname(process.execPath),
      "..",
      "Frameworks",
      `${helperName}.app`,
      "Contents",
      "MacOS",
      helperName,
    );
    if (fs.existsSync(helperPath)) {
      return helperPath;
    }
  }
  return process.execPath;
}

function appBundlePath() {
  if (!app.isPackaged) {
    return "";
  }
  return path.resolve(path.dirname(process.execPath), "..", "..");
}

function runtimePidFile(name) {
  return path.join(runtimeRoot, ".internagents", "pids", `${name}.pid`);
}

function terminatePid(pid) {
  if (!pid || pid <= 1) {
    return;
  }
  if (process.platform === "win32") {
    spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
    return;
  }
  for (const target of [-pid, pid]) {
    try {
      process.kill(target, "SIGTERM");
    } catch {
      // process may already be gone or not be a process group leader
    }
  }
}

function cleanupServices() {
  if (nextProcess && !nextProcess.killed) {
    nextProcess.kill("SIGTERM");
  }

  for (const name of ["backend", "local-runtime"]) {
    const pidFile = runtimePidFile(name);
    if (!fs.existsSync(pidFile)) {
      continue;
    }
    const pid = Number(fs.readFileSync(pidFile, "utf8").trim());
    terminatePid(pid);
  }
}

async function startNextServer(uiPort, backendPort, runtimePort) {
  const serverJs = await findFile(path.join(resourcesRoot(), "ui-standalone"), "server.js");
  if (!serverJs) {
    throw new Error("Next standalone server.js was not found in app resources.");
  }

  const serverDir = path.dirname(serverJs);
  const env = {
    ...process.env,
    ...pythonRuntimeEnv(process.env),
    ELECTRON_RUN_AS_NODE: "1",
    HOSTNAME: HOST,
    PORT: String(uiPort),
    NODE_PATH: path.join(resourcesRoot(), "ui-standalone", "standalone_node_modules"),
    INTERNAGENTS_APP_ROOT: runtimeRoot,
    INTERNAGENTS_DESKTOP: "1",
    INTERNAGENTS_BACKEND_PORT: String(backendPort),
    INTERNAGENTS_LOCAL_RUNTIME_PORT: String(runtimePort),
    INTERNAGENTS_PYTHON_BIN: pythonBinary(),
    INTERNAGENTS_APP_BUNDLE_PATH: appBundlePath(),
    INTERNAGENTS_APP_PID: String(process.pid),
    INTERNAGENTS_APP_VERSION: app.getVersion(),
    PYTHONDONTWRITEBYTECODE: "1",
    PYTHONNOUSERSITE: "1",
    PYTHONUTF8: "1",
    NEXT_PUBLIC_LANGGRAPH_DEPLOYMENT_URL: `http://${HOST}:${backendPort}`,
    NEXT_PUBLIC_LANGGRAPH_ASSISTANT_ID: "agent_local",
  };

  nextProcess = spawn(nodeHostBinary(), [serverJs], {
    cwd: serverDir,
    env,
    stdio: "ignore",
    windowsHide: true,
  });

  const ready = await waitForUrl(`http://${HOST}:${uiPort}`, 60000);
  if (!ready) {
    throw new Error("Next.js server did not become ready in time.");
  }
}

async function restartBackend(uiPort) {
  try {
    await requestJson(`http://${HOST}:${uiPort}/api/runtime/backend/restart`, {
      method: "POST",
    });
  } catch {
    // The visible UI can surface backend restart failures from its config page.
  }
}

function isHttpUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function hasSameOrigin(url, origin) {
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
}

function openExternalUrl(url) {
  shell.openExternal(url).catch(() => {
    // External link failures should not disrupt the app window.
  });
}

function configureExternalLinks(window, appOrigin) {
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isHttpUrl(url) && !hasSameOrigin(url, appOrigin)) {
      openExternalUrl(url);
      return { action: "deny" };
    }
    if (hasSameOrigin(url, appOrigin)) {
      window.loadURL(url).catch(() => undefined);
    }
    return { action: "deny" };
  });

  window.webContents.on("will-navigate", (event, url) => {
    if (!isHttpUrl(url) || hasSameOrigin(url, appOrigin)) {
      return;
    }
    event.preventDefault();
    openExternalUrl(url);
  });
}

async function createWindow(startUrl) {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 980,
    minWidth: 1100,
    minHeight: 720,
    show: false,
    title: "InternAgents",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  configureExternalLinks(mainWindow, new URL(startUrl).origin);

  mainWindow.once("ready-to-show", () => {
    if (!mainWindow) {
      return;
    }
    mainWindow.show();
    mainWindow.focus();
    closeSplashWindow();
  });

  await mainWindow.loadURL(startUrl);
  if (mainWindow && !mainWindow.isVisible()) {
    mainWindow.show();
    mainWindow.focus();
    closeSplashWindow();
  }
}

async function boot() {
  await createSplashWindow();

  const root = resourcesRoot();
  const templateRoot = path.join(root, "internagents-template");
  runtimeRoot = path.join(app.getPath("userData"), "runtime");

  updateSplashStatus("Preparing local workspace...");
  await copyRuntimeTemplate(templateRoot, runtimeRoot);

  updateSplashStatus("Choosing local ports...");
  const uiPort = await findAvailablePort();
  const backendPort = await findAvailablePort();
  const runtimePort = await findAvailablePort();

  updateSplashStatus("Preparing runtime resources...");
  await ensureRuntimeResources(runtimePort);

  updateSplashStatus("Starting desktop services...");
  await startNextServer(uiPort, backendPort, runtimePort);

  updateSplashStatus("Connecting local runtime...");
  await restartBackend(uiPort);

  updateSplashStatus("Opening workspace...");
  const startPath = "/?assistantId=agent_local";
  await createWindow(`http://${HOST}:${uiPort}${startPath}`);
}

if (gotSingleInstanceLock) {
  app.whenReady().then(() => {
    boot().catch((error) => {
      updateSplashStatus("Startup failed.");
      dialog.showErrorBox("InternAgents failed to start", error.message);
      app.quit();
    });
  });
}

app.on("before-quit", cleanupServices);

app.on("window-all-closed", () => {
  app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0 && mainWindow) {
    mainWindow.show();
  }
});
