import { promises as fs } from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { getWorkspaceRoot } from "@/app/api/workspace/_lib/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FALLBACK_AUTO_SHOWN_VERSION = "desktop-initial";

interface OnboardingState {
  quickstart?: {
    lastAutoShownVersion?: string;
  };
}

function isDesktopMode() {
  return process.env.INTERNAGENTS_DESKTOP === "1";
}

function getAppVersion() {
  return process.env.INTERNAGENTS_APP_VERSION?.trim() || "";
}

function getAutoShownVersion() {
  return getAppVersion() || FALLBACK_AUTO_SHOWN_VERSION;
}

function getOnboardingStatePath() {
  return path.join(getWorkspaceRoot(), ".internagents", "onboarding.json");
}

async function readOnboardingState(): Promise<OnboardingState> {
  try {
    return JSON.parse(
      await fs.readFile(getOnboardingStatePath(), "utf8")
    ) as OnboardingState;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

async function writeOnboardingState(state: OnboardingState) {
  const statePath = getOnboardingStatePath();
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
}

function buildResponse(state: OnboardingState) {
  const desktopMode = isDesktopMode();
  const appVersion = getAppVersion();
  const autoShownVersion = getAutoShownVersion();
  const lastAutoShownVersion =
    state.quickstart?.lastAutoShownVersion?.trim() || "";

  return NextResponse.json({
    desktopMode,
    appVersion,
    lastAutoShownVersion,
    shouldAutoStart:
      desktopMode && lastAutoShownVersion !== autoShownVersion,
  });
}

export async function GET() {
  try {
    return buildResponse(await readOnboardingState());
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "无法读取导览状态。",
      },
      { status: 500 }
    );
  }
}

export async function PUT() {
  try {
    const state = await readOnboardingState();
    const autoShownVersion = getAutoShownVersion();

    if (isDesktopMode()) {
      const nextState: OnboardingState = {
        ...state,
        quickstart: {
          ...state.quickstart,
          lastAutoShownVersion: autoShownVersion,
        },
      };
      await writeOnboardingState(nextState);
      return buildResponse(nextState);
    }

    return buildResponse(state);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "无法写入导览状态。",
      },
      { status: 500 }
    );
  }
}
