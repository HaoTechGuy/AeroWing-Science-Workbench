import { NextResponse } from "next/server";
import {
  chooseLocalFolder,
  isUserCancelled,
} from "@/app/api/_lib/local-folder-picker";

export const runtime = "nodejs";

export async function POST() {
  try {
    const selectedPath = await chooseLocalFolder("选择本地技能文件夹");

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
        error: "无法打开本地文件夹选择器，请手动粘贴本地技能路径。",
      },
      { status: 500 }
    );
  }
}
