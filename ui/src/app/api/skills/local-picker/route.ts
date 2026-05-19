import { execFile } from "child_process";
import { promisify } from "util";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const execFileAsync = promisify(execFile);
const PICKER_TIMEOUT_MS = 120_000;

function isUserCancelled(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return message.includes("user canceled") || message.includes("cancelled");
}

async function chooseFolderOnMac(): Promise<string> {
  const script = [
    'set selectedFolder to choose folder with prompt "选择本地技能文件夹"',
    "POSIX path of selectedFolder",
  ].join("\n");

  const { stdout } = await execFileAsync("osascript", ["-e", script], {
    timeout: PICKER_TIMEOUT_MS,
  });
  return stdout.trim();
}

async function chooseFolderOnLinux(): Promise<string> {
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
        args: ["--file-selection", "--directory", "--title=选择本地技能文件夹"],
      };
  const { stdout } = await execFileAsync(command.file, command.args, {
    timeout: PICKER_TIMEOUT_MS,
  });
  return stdout.trim();
}

async function chooseFolderOnWindows(): Promise<string> {
  const script = [
    "Add-Type -AssemblyName System.Windows.Forms",
    "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
    '$dialog.Description = "选择本地技能文件夹"',
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

export async function POST() {
  try {
    let selectedPath = "";
    if (process.platform === "darwin") {
      selectedPath = await chooseFolderOnMac();
    } else if (process.platform === "linux") {
      selectedPath = await chooseFolderOnLinux();
    } else if (process.platform === "win32") {
      selectedPath = await chooseFolderOnWindows();
    } else {
      throw new Error("当前系统暂不支持打开本地文件夹选择器。");
    }

    if (!selectedPath) {
      return NextResponse.json({ cancelled: true });
    }

    return NextResponse.json({ path: selectedPath });
  } catch (error) {
    if (isUserCancelled(error)) {
      return NextResponse.json({ cancelled: true });
    }

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "无法打开本地文件夹选择器。",
      },
      { status: 500 }
    );
  }
}
