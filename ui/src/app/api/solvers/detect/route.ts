import { existsSync } from "fs";
import path from "path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

function pathEntries(): string[] {
  return (process.env.PATH || process.env.Path || "")
    .split(path.delimiter)
    .filter(Boolean);
}

function executableNames(name: string): string[] {
  if (process.platform !== "win32") {
    return [name];
  }
  const extensions = (process.env.PATHEXT || ".EXE;.CMD;.BAT")
    .split(";")
    .filter(Boolean);
  return [name, ...extensions.map((extension) => `${name}${extension.toLowerCase()}`), ...extensions.map((extension) => `${name}${extension.toUpperCase()}`)];
}

function whichAny(names: string[]): string | null {
  for (const directory of pathEntries()) {
    for (const name of names) {
      for (const executable of executableNames(name)) {
        const candidate = path.join(directory, executable);
        if (existsSync(candidate)) {
          return candidate;
        }
      }
    }
  }
  return null;
}

export async function GET() {
  const solvers = {
    su2: whichAny(["SU2_CFD", "su2_cfd"]),
    openfoam: whichAny(["simpleFoam", "pimpleFoam", "icoFoam"]),
    calculix: whichAny(["ccx", "ccx_static"]),
    nastran: whichAny(["nastran", "msc2024", "nxnastran"]),
    abaqus: whichAny(["abaqus"]),
    optistruct: whichAny(["optistruct"]),
  };
  return NextResponse.json({
    checkedAt: new Date().toISOString(),
    solvers: Object.fromEntries(
      Object.entries(solvers).map(([name, solverPath]) => [
        name,
        {
          available: Boolean(solverPath),
          path: solverPath,
          hint: solverPath ? null : `未检测到 ${name} 命令；配置 PATH 后重试。`,
        },
      ])
    ),
  });
}
