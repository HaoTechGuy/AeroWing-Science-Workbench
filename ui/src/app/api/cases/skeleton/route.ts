import { promises as fs } from "fs";
import { existsSync } from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const SUPPORTED_SOLVERS = new Set(["su2", "openfoam", "calculix", "nastran", "abaqus", "optistruct"]);

function resolveAppRoot(): string {
  const configuredRoot = process.env.INTERNAGENTS_APP_ROOT;
  if (configuredRoot && existsSync(path.join(configuredRoot, "skills"))) {
    return configuredRoot;
  }
  if (existsSync(path.join(process.cwd(), "skills"))) {
    return process.cwd();
  }
  return path.resolve(process.cwd(), "..");
}

function safeName(value: string): string {
  return value
    .split("")
    .map((char) => (/^[a-zA-Z0-9_-]$/.test(char) ? char : "_"))
    .join("")
    .replace(/^_+|_+$/g, "");
}

async function writeCaseFile(caseDir: string, relativePath: string, content: string) {
  const target = path.join(caseDir, relativePath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content, "utf-8");
  return target;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      caseName?: unknown;
      solver?: unknown;
      sourceModelPath?: unknown;
    };
    const caseName = typeof body.caseName === "string" ? safeName(body.caseName) : "";
    const solver = typeof body.solver === "string" ? body.solver.toLowerCase().trim() : "";
    if (!caseName) {
      return NextResponse.json({ error: "caseName is required." }, { status: 400 });
    }
    if (!SUPPORTED_SOLVERS.has(solver)) {
      return NextResponse.json({ error: "Unsupported solver." }, { status: 400 });
    }

    const appRoot = resolveAppRoot();
    const casesRoot = path.join(appRoot, "cases");
    const caseDir = path.resolve(casesRoot, caseName);
    if (!caseDir.startsWith(path.resolve(casesRoot))) {
      return NextResponse.json({ error: "Invalid case path." }, { status: 400 });
    }
    await fs.mkdir(caseDir, { recursive: true });
    const sourceModelPath =
      typeof body.sourceModelPath === "string" && body.sourceModelPath.trim()
        ? body.sourceModelPath.trim()
        : "not provided";

    const files: Array<[string, string]> = [
      [
        "README.md",
        `# ${caseName}\n\nSolver target: \`${solver}\`\n\nSource model: \`${sourceModelPath}\`\n\nThis skeleton prepares case files only. Review units, mesh quality, materials, loads, and boundary conditions before running a solver.\n`,
      ],
    ];
    if (solver === "su2") {
      files.push(["config.cfg", "MATH_PROBLEM= DIRECT\nSOLVER= EULER\nMESH_FILENAME= mesh.su2\n"]);
    } else if (solver === "openfoam") {
      files.push(["system/controlDict", "application simpleFoam;\nstartFrom startTime;\nstartTime 0;\nendTime 100;\n"]);
      files.push(["constant/README.md", "Place transportProperties, turbulenceProperties, and mesh data here.\n"]);
      files.push(["0/README.md", "Place initial and boundary fields here.\n"]);
    } else if (solver === "calculix") {
      files.push(["model.inp", "*HEADING\nAeroWing CalculiX skeleton\n"]);
    } else {
      files.push([`${solver}-notes.md`, "Add solver-specific deck files here. Commercial solver binaries are not bundled or auto-installed.\n"]);
    }

    const written = [];
    for (const [relativePath, content] of files) {
      written.push(await writeCaseFile(caseDir, relativePath, content));
    }

    return NextResponse.json({
      caseDir,
      solver,
      files: written,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to create case skeleton." },
      { status: 500 }
    );
  }
}
