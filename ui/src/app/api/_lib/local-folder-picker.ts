import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);
const PICKER_TIMEOUT_MS = 120_000;

export function isUserCancelled(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes("user canceled") ||
    message.includes("cancelled") ||
    message.includes("canceled") ||
    message.includes("用户已取消") ||
    message.includes("用户取消") ||
    message.includes("(-128)")
  );
}

async function chooseFolderOnMac(prompt: string): Promise<string> {
  const script = [
    `set selectedFolder to choose folder with prompt ${JSON.stringify(prompt)}`,
    "POSIX path of selectedFolder",
  ].join("\n");

  const { stdout } = await execFileAsync("osascript", ["-e", script], {
    timeout: PICKER_TIMEOUT_MS,
  });
  return stdout.trim();
}

async function chooseFolderOnLinux(title: string): Promise<string> {
  const { stdout: pickerPath } = await execFileAsync(
    "sh",
    [
      "-lc",
      "command -v zenity || command -v kdialog || command -v yad || true",
    ],
    { timeout: 5_000 }
  );
  const picker = pickerPath.trim().split(/\r?\n/)[0];
  if (!picker) {
    throw new Error("当前系统没有可用的文件夹选择器，请安装 zenity、kdialog 或 yad。");
  }

  const command: { file: string; args: string[] } = picker.endsWith("kdialog")
    ? { file: picker, args: ["--getexistingdirectory", process.env.HOME || "."] }
    : {
        file: picker,
        args: ["--file-selection", "--directory", `--title=${title}`],
      };
  const { stdout } = await execFileAsync(command.file, command.args, {
    timeout: PICKER_TIMEOUT_MS,
  });
  return stdout.trim();
}

async function chooseFolderOnWindows(description: string): Promise<string> {
  const script = [
    "Add-Type -AssemblyName System.Windows.Forms",
    "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
    `$dialog.Description = ${JSON.stringify(description)}`,
    "$dialog.ShowNewFolderButton = $false",
    "if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { $dialog.SelectedPath }",
  ].join("; ");

  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-Command", script],
    { timeout: PICKER_TIMEOUT_MS }
  );
  return stdout.trim();
}

export async function chooseLocalFolder(prompt: string): Promise<string> {
  if (process.platform === "darwin") {
    return chooseFolderOnMac(prompt);
  }
  if (process.platform === "linux") {
    return chooseFolderOnLinux(prompt);
  }
  if (process.platform === "win32") {
    return chooseFolderOnWindows(prompt);
  }

  throw new Error("当前系统暂不支持打开本地文件夹选择器。");
}
