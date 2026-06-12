import { promises as fs } from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { getWorkspaceRoot } from "@/app/api/workspace/_lib/workspace";
import type { ScpCatalogItem } from "@/app/types/types";

export const runtime = "nodejs";

interface ScpCatalogFile {
  skills?: ScpCatalogItem[];
}

export async function GET() {
  try {
    const catalogPath = path.join(getWorkspaceRoot(), "scp_catalog.json");
    const content = await fs.readFile(catalogPath, "utf8");
    const catalog = JSON.parse(content) as ScpCatalogFile;
    const skills = Array.isArray(catalog.skills) ? catalog.skills : [];

    return NextResponse.json({ skills });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to load SCP catalog.",
      },
      { status: 500 }
    );
  }
}
