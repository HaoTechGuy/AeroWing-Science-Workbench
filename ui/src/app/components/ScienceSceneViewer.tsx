"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Group, PerspectiveCamera, WebGLRenderer } from "three";
import { Maximize2, RotateCcw, Waves } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { WorkspaceFileResponse } from "@/app/types/workspace";
import { cn } from "@/lib/utils";

type ScienceSceneType =
  | "crystal"
  | "orbital"
  | "flow"
  | "spectrum"
  | "microscopy";

interface ScienceMetric {
  label: string;
  value: string;
}

interface ScienceSceneData {
  type: ScienceSceneType;
  title?: string;
  subtitle?: string;
  metrics?: ScienceMetric[];
  [key: string]: unknown;
}

interface CrystalAtom {
  element: string;
  color: string;
  radius: number;
  position: [number, number, number];
}

interface SpectrumPeak {
  x: number;
  height: number;
  width?: number;
  label: string;
  color?: string;
  fragment?: string;
}

const SPECTRUM_WIDTH = 860;
const SPECTRUM_HEIGHT = 430;
const SPECTRUM_PLOT = {
  bottom: 332,
  height: 242,
  left: 58,
  right: 48,
  top: 78,
  width: 754,
} as const;

const SCENE_LABELS: Record<ScienceSceneType, string> = {
  crystal: "Crystal",
  flow: "Flow",
  microscopy: "Microscopy",
  orbital: "Orbital",
  spectrum: "Spectrum",
};

const ATOM_STYLES: Record<string, { color: string; radius: number }> = {
  C: { color: "#64748b", radius: 0.16 },
  H: { color: "#e2e8f0", radius: 0.1 },
  N: { color: "#38bdf8", radius: 0.16 },
  O: { color: "#fb7185", radius: 0.16 },
  Pb: { color: "#cbd5e1", radius: 0.32 },
  Ti: { color: "#a78bfa", radius: 0.22 },
};

function getScienceExtension(file: WorkspaceFileResponse) {
  if (file.extension) {
    return file.extension.toLowerCase();
  }
  const lowerPath = file.path.toLowerCase();
  if (lowerPath.endsWith(".science.json")) {
    return ".science.json";
  }
  const dotIndex = lowerPath.lastIndexOf(".");
  return dotIndex >= 0 ? lowerPath.slice(dotIndex) : "";
}

function splitDataTokens(line: string) {
  return (
    line
      .match(/'(?:[^']*)'|"(?:[^"]*)"|\S+/g)
      ?.map((token) => token.replace(/^['"]|['"]$/g, "")) ?? []
  );
}

function metric(label: string, value: string | number): ScienceMetric {
  return { label, value: String(value) };
}

function readJcampValue(content: string, label: string) {
  const match = new RegExp(`^##${label}=([^\\r\\n]*)`, "im").exec(content);
  return match?.[1]?.trim() || "";
}

function parseCifScene(
  content: string,
  file: WorkspaceFileResponse
): ScienceSceneData {
  const lines = content.split(/\r?\n/);
  const readCifValue = (key: string) => {
    const line = lines.find((candidate) =>
      candidate.trim().toLowerCase().startsWith(key.toLowerCase())
    );
    return line ? splitDataTokens(line).slice(1).join(" ") : "";
  };
  const formula =
    readCifValue("_chemical_formula_sum") ||
    readCifValue("_chemical_formula_structural") ||
    file.name.replace(/\.cif$/i, "");
  const cellA = Number.parseFloat(readCifValue("_cell_length_a"));
  const atoms: CrystalAtom[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].trim().toLowerCase() !== "loop_") {
      continue;
    }

    const headers: string[] = [];
    let cursor = i + 1;
    while (cursor < lines.length && lines[cursor].trim().startsWith("_")) {
      headers.push(lines[cursor].trim());
      cursor += 1;
    }

    if (!headers.some((header) => header.startsWith("_atom_site_"))) {
      continue;
    }

    const symbolIndex = headers.findIndex(
      (header) =>
        header === "_atom_site_type_symbol" ||
        header === "_atom_site_label" ||
        header.endsWith(".type_symbol") ||
        header.endsWith(".label")
    );
    const xIndex = headers.findIndex((header) =>
      header.includes("fract_x")
    );
    const yIndex = headers.findIndex((header) =>
      header.includes("fract_y")
    );
    const zIndex = headers.findIndex((header) =>
      header.includes("fract_z")
    );

    if (symbolIndex < 0 || xIndex < 0 || yIndex < 0 || zIndex < 0) {
      continue;
    }

    while (cursor < lines.length) {
      const line = lines[cursor].trim();
      if (!line || line.startsWith("_") || line.toLowerCase() === "loop_") {
        break;
      }
      if (line.startsWith("#")) {
        cursor += 1;
        continue;
      }
      const tokens = splitDataTokens(line);
      if (tokens.length >= headers.length) {
        const rawSymbol = tokens[symbolIndex].replace(/[0-9.+-]/g, "");
        const element =
          rawSymbol.charAt(0).toUpperCase() + rawSymbol.slice(1).toLowerCase();
        const style = ATOM_STYLES[element] || {
          color: "#f8fafc",
          radius: 0.18,
        };
        const position: [number, number, number] = [
          Number.parseFloat(tokens[xIndex]),
          Number.parseFloat(tokens[yIndex]),
          Number.parseFloat(tokens[zIndex]),
        ];
        if (position.every(Number.isFinite)) {
          atoms.push({
            element,
            color: style.color,
            radius: style.radius,
            position,
          });
        }
      }
      cursor += 1;
    }
  }

  return {
    type: "crystal",
    title: "CIF Crystal Structure",
    subtitle: `${formula} fractional coordinates from CIF`,
    metrics: [
      metric("format", "CIF"),
      metric("atoms", atoms.length),
      metric("cell a", Number.isFinite(cellA) ? `${cellA.toFixed(3)} A` : "n/a"),
    ],
    lattice: {
      cellSize: 1.06,
      repeat: [4, 4, 4],
    },
    atoms,
  };
}

function parseCubeScene(
  content: string,
  file: WorkspaceFileResponse
): ScienceSceneData {
  const lines = content.split(/\r?\n/);
  const title = lines[0]?.trim() || file.name;
  const atomLine = splitDataTokens(lines[2] || "");
  const atomCount = Math.abs(Number.parseInt(atomLine[0] || "0", 10)) || 0;
  const grid = [3, 4, 5].map((lineIndex) => {
    const tokens = splitDataTokens(lines[lineIndex] || "");
    return Math.abs(Number.parseInt(tokens[0] || "0", 10)) || 0;
  });
  const valueCount = grid.reduce((product, value) => product * value, 1);

  return {
    type: "orbital",
    title: "Gaussian Cube Orbital",
    subtitle: title,
    metrics: [
      metric("format", "CUBE"),
      metric("atoms", atomCount),
      metric("grid", grid.every(Boolean) ? grid.join("x") : "n/a"),
    ],
    densityPoints: Math.max(900, Math.min(2200, valueCount)),
    negativeColor: "#f472b6",
    positiveColor: "#2dd4bf",
  };
}

function parseJcampScene(content: string): ScienceSceneData {
  const title = readJcampValue(content, "TITLE") || "JCAMP-DX Spectrum";
  const xUnits = readJcampValue(content, "XUNITS") || "cm-1";
  const firstX = Number.parseFloat(readJcampValue(content, "FIRSTX"));
  const lastX = Number.parseFloat(readJcampValue(content, "LASTX"));
  const assignmentBlock =
    /^##\$PEAK_ASSIGNMENTS=\s*([\s\S]*?)(?=^##[A-Z$])/im.exec(content)?.[1] ||
    "";
  const assignments = new Map<
    number,
    { label: string; fragment: string; color: string }
  >();
  assignmentBlock
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => {
      const [xValue, label, fragment, color] = line.split("|");
      const x = Math.round(Number.parseFloat(xValue));
      if (Number.isFinite(x)) {
        assignments.set(x, {
          color: color || "#f8fafc",
          fragment: fragment || `${x} ${xUnits}`,
          label: label || `${x}`,
        });
      }
    });

  const peakBlock =
    /^##PEAK TABLE=[^\r\n]*\r?\n([\s\S]*?)(?=^##[A-Z$])/im.exec(content)?.[1] ||
    "";
  const pairs = Array.from(
    peakBlock.matchAll(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/g)
  ).map((match) => ({
    x: Number.parseFloat(match[1]),
    y: Number.parseFloat(match[2]),
  }));
  const values = pairs.filter((pair) => Number.isFinite(pair.x) && Number.isFinite(pair.y));
  const minX = Math.min(
    ...values.map((pair) => pair.x),
    Number.isFinite(firstX) ? firstX : Infinity,
    Number.isFinite(lastX) ? lastX : Infinity
  );
  const maxX = Math.max(
    ...values.map((pair) => pair.x),
    Number.isFinite(firstX) ? firstX : -Infinity,
    Number.isFinite(lastX) ? lastX : -Infinity
  );
  const maxY = Math.max(...values.map((pair) => pair.y), 1);
  const span = Math.max(maxX - minX, 1);
  const peaks = values.map((pair, index) => {
    const assignment = assignments.get(Math.round(pair.x));
    const height = Math.max(0.16, Math.min(1, pair.y / maxY));
    return {
      color:
        assignment?.color ||
        ["#38bdf8", "#2dd4bf", "#a78bfa", "#f59e0b", "#fb7185"][
          index % 5
        ],
      fragment: assignment?.fragment || `${pair.x} ${xUnits}`,
      height,
      label: assignment?.label || `${Math.round(pair.x)}`,
      width: 0.0014 + height * 0.0013,
      x: (pair.x - minX) / span,
    } satisfies SpectrumPeak;
  });

  return {
    type: "spectrum",
    title,
    subtitle: `JCAMP-DX peak table in ${xUnits}`,
    metrics: [
      metric("format", "JCAMP-DX"),
      metric("peaks", peaks.length),
      metric("range", `${Math.round(minX)}-${Math.round(maxX)} ${xUnits}`),
    ],
    peaks,
  };
}

function parseVtkFlowScene(content: string): ScienceSceneData {
  const title = content.split(/\r?\n/)[1]?.trim() || "VTK Vector Field";
  const pointCount =
    Number.parseInt(/^POINTS\s+(\d+)/im.exec(content)?.[1] || "0", 10) || 0;
  const vectorName = /^VECTORS\s+(\S+)/im.exec(content)?.[1] || "velocity";

  return {
    type: "flow",
    title: "VTK Reactive Flow Field",
    subtitle: title,
    metrics: [
      metric("format", "VTK"),
      metric("points", pointCount),
      metric("vectors", vectorName),
    ],
    particleCount: Math.max(560, Math.min(1400, pointCount * 24 || 900)),
    colorA: "#22d3ee",
    colorB: "#fb7185",
  };
}

function parseVtiVolumeScene(content: string): ScienceSceneData {
  const extentMatch = /WholeExtent="([^"]+)"/i.exec(content);
  const extent = extentMatch?.[1]
    ?.split(/\s+/)
    .map((value) => Number.parseInt(value, 10));
  const dims =
    extent && extent.length >= 6
      ? [
          extent[1] - extent[0] + 1,
          extent[3] - extent[2] + 1,
          extent[5] - extent[4] + 1,
        ]
      : [24, 24, 18];
  const dataValues =
    /<DataArray[^>]*>([\s\S]*?)<\/DataArray>/i
      .exec(content)?.[1]
      ?.trim()
      .split(/\s+/).length || 0;

  return {
    type: "microscopy",
    title: "VTK ImageData Volume",
    subtitle: "fluorescence z-stack from VTI scalar volume",
    metrics: [
      metric("format", "VTI"),
      metric("dims", dims.join("x")),
      metric("scalars", dataValues),
    ],
    hotspots: Math.max(360, Math.min(760, Math.round(dataValues / 6) || 420)),
    slices: Math.max(12, Math.min(40, dims[2] || 28)),
  };
}

function parseScienceScene(file: WorkspaceFileResponse): ScienceSceneData | null {
  if (!file.content) return null;
  const extension = getScienceExtension(file);

  if (extension === ".science.json") {
    const payload = JSON.parse(file.content) as { scene?: ScienceSceneData };
    return payload.scene ?? null;
  }
  if (extension === ".cif") return parseCifScene(file.content, file);
  if (extension === ".cube") return parseCubeScene(file.content, file);
  if (extension === ".jdx") return parseJcampScene(file.content);
  if (extension === ".vtk") return parseVtkFlowScene(file.content);
  if (extension === ".vti") return parseVtiVolumeScene(file.content);

  throw new Error(`暂不支持 ${extension || "这个"} 科学文件格式。`);
}

function isThreeScene(type: ScienceSceneType) {
  return type !== "spectrum";
}

function normalizeVector(value: unknown, fallback: [number, number, number]) {
  if (!Array.isArray(value) || value.length < 3) return fallback;
  const next = value.slice(0, 3).map(Number);
  return next.every(Number.isFinite)
    ? (next as [number, number, number])
    : fallback;
}

function createGridLines(THREE: typeof import("three"), repeat: number[], cellSize: number) {
  const [rx, ry, rz] = repeat;
  const width = rx * cellSize;
  const height = ry * cellSize;
  const depth = rz * cellSize;
  const x0 = -width / 2;
  const y0 = -height / 2;
  const z0 = -depth / 2;
  const positions: number[] = [];

  for (let i = 0; i <= rx; i += 1) {
    const x = x0 + i * cellSize;
    for (let j = 0; j <= ry; j += 1) {
      const y = y0 + j * cellSize;
      positions.push(x, y, z0, x, y, z0 + depth);
    }
    for (let k = 0; k <= rz; k += 1) {
      const z = z0 + k * cellSize;
      positions.push(x, y0, z, x, y0 + height, z);
    }
  }

  for (let j = 0; j <= ry; j += 1) {
    const y = y0 + j * cellSize;
    for (let k = 0; k <= rz; k += 1) {
      const z = z0 + k * cellSize;
      positions.push(x0, y, z, x0 + width, y, z);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3)
  );
  return new THREE.LineSegments(
    geometry,
    new THREE.LineBasicMaterial({
      color: 0x4f6f6a,
      transparent: true,
      opacity: 0.22,
    })
  );
}

function buildCrystalScene(
  THREE: typeof import("three"),
  data: ScienceSceneData,
  root: Group
) {
  const lattice = (data.lattice ?? {}) as Record<string, unknown>;
  const repeat = normalizeVector(lattice.repeat, [3, 3, 3]).map((item) =>
    Math.max(1, Math.round(item))
  );
  const cellSize = Number(lattice.cellSize) || 1.15;
  const atoms = Array.isArray(data.atoms)
    ? (data.atoms as CrystalAtom[])
    : [
        { element: "A", color: "#6d5dfc", radius: 0.2, position: [0, 0, 0] },
        { element: "B", color: "#19b6a3", radius: 0.18, position: [0.5, 0.5, 0.5] },
      ];

  root.add(createGridLines(THREE, repeat, cellSize));

  const sphere = new THREE.SphereGeometry(1, 32, 16);
  const [rx, ry, rz] = repeat;
  for (let x = 0; x < rx; x += 1) {
    for (let y = 0; y < ry; y += 1) {
      for (let z = 0; z < rz; z += 1) {
        atoms.forEach((atom) => {
          const position = normalizeVector(atom.position, [0, 0, 0]);
          const mesh = new THREE.Mesh(
            sphere,
            new THREE.MeshStandardMaterial({
              color: atom.color,
              metalness: 0.18,
              roughness: 0.33,
            })
          );
          mesh.scale.setScalar(atom.radius);
          mesh.position.set(
            (x + position[0] - rx / 2) * cellSize,
            (y + position[1] - ry / 2) * cellSize,
            (z + position[2] - rz / 2) * cellSize
          );
          root.add(mesh);
        });
      }
    }
  }
}

function buildOrbitalScene(
  THREE: typeof import("three"),
  data: ScienceSceneData,
  root: Group
) {
  const positiveColor = new THREE.Color(
    (data.positiveColor as string) || "#2dd4bf"
  );
  const negativeColor = new THREE.Color(
    (data.negativeColor as string) || "#f472b6"
  );
  const orbitalGroup = new THREE.Group();
  root.add(orbitalGroup);

  const makeLobeGeometry = (phase: number) => {
    const geometry = new THREE.SphereGeometry(0.92, 72, 36);
    const position = geometry.getAttribute("position");
    const vector = new THREE.Vector3();
    for (let i = 0; i < position.count; i += 1) {
      vector.fromBufferAttribute(position, i);
      const angle = Math.atan2(vector.z, vector.x);
      const polar = Math.acos(
        THREE.MathUtils.clamp(vector.y / Math.max(vector.length(), 0.0001), -1, 1)
      );
      const ripple =
        1 +
        Math.sin(angle * 4 + phase) * 0.17 * Math.sin(polar) +
        Math.cos(polar * 3 + phase) * 0.09;
      vector.multiplyScalar(ripple);
      position.setXYZ(i, vector.x, vector.y, vector.z);
    }
    geometry.computeVertexNormals();
    return geometry;
  };

  const makePhaseMaterial = (color: typeof positiveColor, opacity: number) =>
    new THREE.MeshPhysicalMaterial({
      blending: THREE.AdditiveBlending,
      color,
      emissive: color,
      emissiveIntensity: 0.72,
      metalness: 0,
      opacity,
      roughness: 0.14,
      side: THREE.DoubleSide,
      transparent: true,
      transmission: 0.24,
    });

  const lobes: Array<{
    mesh: import("three").Mesh;
    baseScale: [number, number, number];
    phase: number;
  }> = [];
  const lobeSpecs = [
    {
      color: positiveColor,
      phase: 0,
      position: [0, 0.94, 0],
      rotation: [0, 0, 0],
      scale: [0.68, 1.34, 0.68] as [number, number, number],
    },
    {
      color: negativeColor,
      phase: Math.PI,
      position: [0, -0.94, 0],
      rotation: [0, 0, 0],
      scale: [0.68, 1.34, 0.68] as [number, number, number],
    },
    {
      color: positiveColor,
      phase: Math.PI * 0.35,
      position: [1.08, 0, 0],
      rotation: [0, 0, Math.PI / 2],
      scale: [0.52, 1.08, 0.52] as [number, number, number],
    },
    {
      color: negativeColor,
      phase: Math.PI * 1.35,
      position: [-1.08, 0, 0],
      rotation: [0, 0, Math.PI / 2],
      scale: [0.52, 1.08, 0.52] as [number, number, number],
    },
  ];

  lobeSpecs.forEach((spec) => {
    const mesh = new THREE.Mesh(
      makeLobeGeometry(spec.phase),
      makePhaseMaterial(spec.color, 0.48)
    );
    mesh.position.fromArray(spec.position);
    mesh.rotation.set(spec.rotation[0], spec.rotation[1], spec.rotation[2]);
    mesh.scale.set(...spec.scale);
    orbitalGroup.add(mesh);
    lobes.push({ mesh, baseScale: spec.scale, phase: spec.phase });
  });

  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(2.18, 96, 48),
    new THREE.ShaderMaterial({
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.BackSide,
      transparent: true,
      uniforms: {
        uColorA: { value: positiveColor },
        uColorB: { value: negativeColor },
        uTime: { value: 0 },
      },
      vertexShader: `
        varying vec3 vNormal;
        varying vec3 vPosition;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          vPosition = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 uColorA;
        uniform vec3 uColorB;
        uniform float uTime;
        varying vec3 vNormal;
        varying vec3 vPosition;
        void main() {
          float phase = 0.5 + 0.5 * sin(vPosition.y * 4.0 + uTime * 1.4);
          float rim = pow(1.0 - abs(vNormal.z), 2.5);
          vec3 color = mix(uColorA, uColorB, phase);
          gl_FragColor = vec4(color, rim * 0.32);
        }
      `,
    })
  );
  orbitalGroup.add(halo);

  const slice = new THREE.Mesh(
    new THREE.PlaneGeometry(4.2, 2.6, 36, 20),
    new THREE.MeshBasicMaterial({
      blending: THREE.AdditiveBlending,
      color: "#ffffff",
      opacity: 0.08,
      side: THREE.DoubleSide,
      transparent: true,
      wireframe: true,
    })
  );
  slice.rotation.y = Math.PI / 2;
  orbitalGroup.add(slice);

  const nucleus = new THREE.Mesh(
    new THREE.SphereGeometry(0.2, 40, 20),
    new THREE.MeshStandardMaterial({
      color: "#ffffff",
      emissive: "#fbbf24",
      emissiveIntensity: 1.2,
      metalness: 0.22,
      roughness: 0.12,
    })
  );
  orbitalGroup.add(nucleus);

  const rings = [0, 1, 2].map((index) => {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.24 + index * 0.34, 0.008, 8, 220),
      new THREE.MeshBasicMaterial({
        blending: THREE.AdditiveBlending,
        color: index % 2 ? positiveColor : negativeColor,
        opacity: 0.42 - index * 0.08,
        transparent: true,
      })
    );
    ring.rotation.set(Math.PI / 2, index * 0.58, index * 0.24);
    orbitalGroup.add(ring);
    return ring;
  });

  const pointCount = Number(data.densityPoints) || 1600;
  const points = new Float32Array(pointCount * 3);
  const colors = new Float32Array(pointCount * 3);
  for (let i = 0; i < pointCount; i += 1) {
    const angle = i * 2.399963;
    const band = i % 4;
    const radius = 0.18 + ((i * 73) % 1000) / 1000;
    const sign = band < 2 ? 1 : -1;
    const y = sign * (0.26 + radius * (band % 2 ? 1.42 : 1.02));
    const spread = 0.42 + radius * 0.72;
    points[i * 3] = Math.cos(angle) * spread;
    points[i * 3 + 1] = y;
    points[i * 3 + 2] = Math.sin(angle) * spread;
    const color = sign > 0 ? positiveColor : negativeColor;
    colors.set([color.r, color.g, color.b], i * 3);
  }
  const pointGeometry = new THREE.BufferGeometry();
  pointGeometry.setAttribute("position", new THREE.BufferAttribute(points, 3));
  pointGeometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const cloud = new THREE.Points(
    pointGeometry,
    new THREE.PointsMaterial({
      blending: THREE.AdditiveBlending,
      opacity: 0.62,
      size: 0.022,
      transparent: true,
      vertexColors: true,
    })
  );
  orbitalGroup.add(cloud);

  return (time: number) => {
    const pulse = 1 + Math.sin(time * 2.4) * 0.045;
    lobes.forEach(({ mesh, baseScale, phase }) => {
      const localPulse = pulse + Math.sin(time * 3.1 + phase) * 0.025;
      mesh.scale.set(
        baseScale[0] * localPulse,
        baseScale[1] * localPulse,
        baseScale[2] * localPulse
      );
    });
    (halo.material as import("three").ShaderMaterial).uniforms.uTime.value = time;
    rings.forEach((ring, index) => {
      ring.rotation.z = time * (0.11 + index * 0.035);
      ring.rotation.x = Math.PI / 2 + Math.sin(time * 0.5 + index) * 0.08;
    });
    cloud.rotation.y = time * 0.055;
    slice.position.x = Math.sin(time * 0.7) * 0.38;
    slice.rotation.z = time * 0.08;
  };
}

function buildFlowScene(
  THREE: typeof import("three"),
  data: ScienceSceneData,
  root: Group
) {
  const flowGroup = new THREE.Group();
  root.add(flowGroup);
  const count = Number(data.particleCount) || 900;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const colorA = new THREE.Color((data.colorA as string) || "#40e0d0");
  const colorB = new THREE.Color((data.colorB as string) || "#ff5ca8");
  const colorC = new THREE.Color("#facc15");

  for (let i = 0; i < count; i += 1) {
    const mix = (i % 97) / 96;
    const color = mix < 0.5
      ? colorA.clone().lerp(colorC, mix * 2)
      : colorC.clone().lerp(colorB, (mix - 0.5) * 2);
    colors.set([color.r, color.g, color.b], i * 3);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const material = new THREE.PointsMaterial({
    blending: THREE.AdditiveBlending,
    opacity: 0.92,
    size: 0.042,
    transparent: true,
    vertexColors: true,
  });
  const points = new THREE.Points(geometry, material);
  flowGroup.add(points);

  const streamGroup = new THREE.Group();
  flowGroup.add(streamGroup);
  const streamTubes: Array<import("three").Mesh> = [];
  for (let lane = 0; lane < 11; lane += 1) {
    const lanePhase = (lane / 11) * Math.PI * 2;
    const curvePoints = Array.from({ length: 88 }, (_, step) => {
      const t = step / 87;
      const x = (t - 0.5) * 5.1;
      const swirl = Math.sin(t * Math.PI * 5.6 + lanePhase);
      const radius = 0.62 + 0.28 * Math.sin(t * Math.PI * 2 + lanePhase);
      return new THREE.Vector3(
        x,
        Math.sin(t * Math.PI * 3.4 + lanePhase) * radius,
        Math.cos(t * Math.PI * 3.4 + lanePhase) * radius + swirl * 0.2
      );
    });
    const curve = new THREE.CatmullRomCurve3(curvePoints);
    const tube = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 144, 0.014 + (lane % 3) * 0.004, 8, false),
      new THREE.MeshBasicMaterial({
        blending: THREE.AdditiveBlending,
        color: lane % 3 === 0 ? colorA : lane % 3 === 1 ? colorB : colorC,
        opacity: 0.24,
        transparent: true,
      })
    );
    streamGroup.add(tube);
    streamTubes.push(tube);
  }

  const reactor = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.48, 4),
    new THREE.MeshPhysicalMaterial({
      blending: THREE.AdditiveBlending,
      color: "#ffffff",
      emissive: "#22d3ee",
      emissiveIntensity: 1.1,
      opacity: 0.32,
      roughness: 0.1,
      transparent: true,
      transmission: 0.18,
      wireframe: true,
    })
  );
  flowGroup.add(reactor);

  const rings = [0, 1, 2, 3].map((index) => {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.72 + index * 0.36, 0.012, 8, 180),
      new THREE.MeshBasicMaterial({
        blending: THREE.AdditiveBlending,
        color: index % 2 ? colorB : colorA,
        opacity: 0.38 - index * 0.055,
        transparent: true,
      })
    );
    ring.rotation.set(Math.PI / 2, index * 0.47, index * 0.8);
    flowGroup.add(ring);
    return ring;
  });

  const shockGeometry = new THREE.BufferGeometry();
  const shockPositions: number[] = [];
  for (let i = 0; i < 280; i += 1) {
    const angle = (i / 280) * Math.PI * 2;
    const next = ((i + 1) / 280) * Math.PI * 2;
    const r0 = 1.9 + Math.sin(i * 0.21) * 0.12;
    const r1 = 1.9 + Math.sin((i + 1) * 0.21) * 0.12;
    shockPositions.push(
      Math.cos(angle) * r0,
      Math.sin(angle * 3) * 0.16,
      Math.sin(angle) * r0,
      Math.cos(next) * r1,
      Math.sin(next * 3) * 0.16,
      Math.sin(next) * r1
    );
  }
  shockGeometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(shockPositions, 3)
  );
  const shockRing = new THREE.LineSegments(
    shockGeometry,
    new THREE.LineBasicMaterial({
      blending: THREE.AdditiveBlending,
      color: "#f8fafc",
      opacity: 0.24,
      transparent: true,
    })
  );
  flowGroup.add(shockRing);

  return (time: number) => {
    const attribute = geometry.getAttribute("position");
    for (let i = 0; i < count; i += 1) {
      const phase = i * 0.113;
      const t = (time * 0.11 + (i % count) / count) % 1;
      const x = (t - 0.5) * 5.2;
      const spin = time * 1.2 + phase + t * Math.PI * 7.5;
      const envelope = 0.28 + Math.sin(t * Math.PI) * 0.95;
      attribute.setXYZ(
        i,
        x,
        Math.sin(spin) * envelope + Math.sin(time * 2 + phase) * 0.08,
        Math.cos(spin * 0.86) * envelope
      );
    }
    attribute.needsUpdate = true;
    streamGroup.rotation.x = Math.sin(time * 0.25) * 0.12;
    streamGroup.rotation.y = time * 0.08;
    streamTubes.forEach((tube, index) => {
      const material = tube.material as import("three").MeshBasicMaterial;
      material.opacity = 0.18 + Math.sin(time * 1.7 + index) * 0.055;
    });
    const reactorPulse = 1 + Math.sin(time * 4.2) * 0.12;
    reactor.scale.setScalar(reactorPulse);
    reactor.rotation.x = time * 0.42;
    reactor.rotation.y = time * 0.68;
    rings.forEach((ring, index) => {
      ring.rotation.z = time * (0.35 + index * 0.08);
      ring.scale.setScalar(1 + Math.sin(time * 2.4 + index) * 0.08);
    });
    shockRing.rotation.y = -time * 0.18;
  };
}

function createMicroscopyTexture(
  THREE: typeof import("three"),
  index: number,
  slices: number
) {
  const canvas = document.createElement("canvas");
  const size = 256;
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) {
    return new THREE.CanvasTexture(canvas);
  }

  const depth = slices <= 1 ? 0 : index / (slices - 1);
  const centerPulse = Math.sin(depth * Math.PI);
  context.clearRect(0, 0, size, size);

  const gradient = context.createRadialGradient(
    size * (0.48 + Math.sin(index * 0.37) * 0.05),
    size * (0.52 + Math.cos(index * 0.31) * 0.05),
    6,
    size * 0.5,
    size * 0.5,
    size * 0.55
  );
  gradient.addColorStop(0, `rgba(45, 212, 191, ${0.24 + centerPulse * 0.34})`);
  gradient.addColorStop(0.34, "rgba(34, 211, 238, 0.2)");
  gradient.addColorStop(0.66, "rgba(168, 85, 247, 0.13)");
  gradient.addColorStop(1, "rgba(0, 0, 0, 0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);

  context.globalCompositeOperation = "lighter";
  for (let ring = 0; ring < 4; ring += 1) {
    const radius = 28 + ring * 22 + Math.sin(index * 0.42 + ring) * 8;
    context.beginPath();
    context.strokeStyle =
      ring % 2 === 0
        ? `rgba(34, 211, 238, ${0.16 + centerPulse * 0.12})`
        : `rgba(244, 114, 182, ${0.13 + centerPulse * 0.1})`;
    context.lineWidth = 2.2;
    context.ellipse(
      size * 0.5,
      size * 0.5,
      radius * 1.18,
      radius * 0.72,
      index * 0.08 + ring * 0.7,
      0,
      Math.PI * 2
    );
    context.stroke();
  }

  for (let i = 0; i < 54; i += 1) {
    const phase = i * 1.618 + index * 0.27;
    const radiusBand = 22 + ((i * 29 + index * 11) % 96);
    const x = size / 2 + Math.cos(phase) * radiusBand * (0.78 + centerPulse * 0.18);
    const y =
      size / 2 +
      Math.sin(phase * 1.13) *
        radiusBand *
        (0.62 + Math.sin(index * 0.21 + i) * 0.08);
    const blobRadius = 2.4 + ((i + index) % 8) * 0.85;
    const blob = context.createRadialGradient(x, y, 0, x, y, blobRadius * 3.8);
    const palette = i % 4;
    const alpha = 0.35 + Math.sin(depth * Math.PI + i) * 0.12;
    if (palette === 0) {
      blob.addColorStop(0, `rgba(251, 191, 36, ${alpha + 0.2})`);
      blob.addColorStop(1, "rgba(251, 191, 36, 0)");
    } else if (palette === 1) {
      blob.addColorStop(0, `rgba(94, 234, 212, ${alpha + 0.18})`);
      blob.addColorStop(1, "rgba(94, 234, 212, 0)");
    } else if (palette === 2) {
      blob.addColorStop(0, `rgba(244, 114, 182, ${alpha + 0.16})`);
      blob.addColorStop(1, "rgba(244, 114, 182, 0)");
    } else {
      blob.addColorStop(0, `rgba(129, 140, 248, ${alpha + 0.12})`);
      blob.addColorStop(1, "rgba(129, 140, 248, 0)");
    }
    context.fillStyle = blob;
    context.beginPath();
    context.arc(x, y, blobRadius * 3.8, 0, Math.PI * 2);
    context.fill();
  }

  for (let y = 0; y < size; y += 9) {
    context.fillStyle = `rgba(255, 255, 255, ${0.014 + ((y + index) % 5) * 0.002})`;
    context.fillRect(0, y + Math.sin(index * 0.2 + y) * 1.4, size, 1);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function buildMicroscopyScene(
  THREE: typeof import("three"),
  data: ScienceSceneData,
  root: Group
) {
  const slices = Number(data.slices) || 28;
  const sliceSpacing = 0.072;
  const volumeGroup = new THREE.Group();
  const baseRotation = { x: -0.56, y: 0.38, z: -0.08 };
  volumeGroup.rotation.set(baseRotation.x, baseRotation.y, baseRotation.z);
  root.add(volumeGroup);

  const geometry = new THREE.PlaneGeometry(3.85, 3.85, 12, 12);
  const sliceMeshes: Array<import("three").Mesh> = [];
  for (let i = 0; i < slices; i += 1) {
    const texture = createMicroscopyTexture(THREE, i, slices);
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        alphaMap: texture,
        blending: THREE.AdditiveBlending,
        color: "#ffffff",
        depthWrite: false,
        map: texture,
        opacity: 0.12 + Math.sin((i / Math.max(1, slices - 1)) * Math.PI) * 0.08,
        side: THREE.DoubleSide,
        transparent: true,
      })
    );
    mesh.position.z = (i - (slices - 1) / 2) * sliceSpacing;
    mesh.rotation.z = Math.sin(i * 0.47) * 0.025;
    volumeGroup.add(mesh);
    sliceMeshes.push(mesh);
  }

  const pointCount = Number(data.hotspots) || 420;
  const pointPositions = new Float32Array(pointCount * 3);
  const pointColors = new Float32Array(pointCount * 3);
  const colorA = new THREE.Color("#22d3ee");
  const colorB = new THREE.Color("#f472b6");
  const colorC = new THREE.Color("#facc15");
  for (let i = 0; i < pointCount; i += 1) {
    const angle = i * 2.399963;
    const radius = 0.14 + ((i * 37) % 1000) / 1000;
    const spiral = Math.sin(i * 0.17) * 0.22;
    pointPositions[i * 3] = Math.cos(angle) * radius * 1.72 + spiral;
    pointPositions[i * 3 + 1] =
      Math.sin(angle * 1.19) * radius * 1.36 + Math.cos(i * 0.11) * 0.18;
    pointPositions[i * 3 + 2] =
      (((i * 53) % pointCount) / pointCount - 0.5) *
      slices *
      sliceSpacing *
      0.92;
    const mix = (i % 127) / 126;
    const color =
      mix < 0.5
        ? colorA.clone().lerp(colorC, mix * 2)
        : colorC.clone().lerp(colorB, (mix - 0.5) * 2);
    pointColors.set([color.r, color.g, color.b], i * 3);
  }

  const pointGeometry = new THREE.BufferGeometry();
  pointGeometry.setAttribute(
    "position",
    new THREE.BufferAttribute(pointPositions, 3)
  );
  pointGeometry.setAttribute("color", new THREE.BufferAttribute(pointColors, 3));
  const hotspots = new THREE.Points(
    pointGeometry,
    new THREE.PointsMaterial({
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: 0.82,
      size: 0.036,
      transparent: true,
      vertexColors: true,
    })
  );
  volumeGroup.add(hotspots);

  const shell = new THREE.Mesh(
    new THREE.SphereGeometry(1.48, 72, 40),
    new THREE.MeshBasicMaterial({
      blending: THREE.AdditiveBlending,
      color: "#a78bfa",
      depthWrite: false,
      opacity: 0.1,
      transparent: true,
      wireframe: true,
    })
  );
  shell.scale.set(1.18, 0.86, 0.56);
  shell.rotation.z = -0.2;
  volumeGroup.add(shell);

  const scanPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(4.1, 4.1),
    new THREE.MeshBasicMaterial({
      blending: THREE.AdditiveBlending,
      color: "#22d3ee",
      depthWrite: false,
      opacity: 0.065,
      side: THREE.DoubleSide,
      transparent: true,
    })
  );
  volumeGroup.add(scanPlane);

  const scanGrid = new THREE.Mesh(
    new THREE.PlaneGeometry(4.1, 4.1, 18, 18),
    new THREE.MeshBasicMaterial({
      blending: THREE.AdditiveBlending,
      color: "#e0f2fe",
      depthWrite: false,
      opacity: 0.18,
      side: THREE.DoubleSide,
      transparent: true,
      wireframe: true,
    })
  );
  volumeGroup.add(scanGrid);

  const frame = new THREE.Mesh(
    new THREE.BoxGeometry(3.95, 3.95, slices * sliceSpacing),
    new THREE.MeshBasicMaterial({
      color: "#67e8f9",
      opacity: 0.08,
      transparent: true,
      wireframe: true,
    })
  );
  volumeGroup.add(frame);

  const crosshair = new THREE.LineSegments(
    new THREE.BufferGeometry().setAttribute(
      "position",
      new THREE.Float32BufferAttribute(
        [
          -2.05, 0, 0, 2.05, 0, 0,
          0, -2.05, 0, 0, 2.05, 0,
          0, 0, -slices * sliceSpacing * 0.52, 0, 0, slices * sliceSpacing * 0.52,
        ],
        3
      )
    ),
    new THREE.LineBasicMaterial({
      blending: THREE.AdditiveBlending,
      color: "#f8fafc",
      opacity: 0.18,
      transparent: true,
    })
  );
  volumeGroup.add(crosshair);

  return (time: number) => {
    volumeGroup.rotation.x = baseRotation.x + Math.sin(time * 0.34) * 0.08;
    volumeGroup.rotation.y = baseRotation.y + time * 0.055;
    volumeGroup.rotation.z = baseRotation.z + Math.sin(time * 0.22) * 0.035;
    const scanZ = Math.sin(time * 1.15) * slices * sliceSpacing * 0.48;
    scanPlane.position.z = scanZ;
    scanGrid.position.z = scanZ + 0.003;
    scanPlane.material.opacity = 0.045 + Math.sin(time * 2.3) * 0.018;
    scanGrid.material.opacity = 0.14 + Math.sin(time * 2.3) * 0.04;
    shell.rotation.y = time * 0.12;
    shell.scale.set(
      1.18 + Math.sin(time * 1.7) * 0.025,
      0.86 + Math.cos(time * 1.4) * 0.018,
      0.56
    );
    hotspots.rotation.z = -time * 0.08;
    sliceMeshes.forEach((mesh, index) => {
      const distance = Math.abs(mesh.position.z - scanZ);
      const material = mesh.material as import("three").MeshBasicMaterial;
      material.opacity =
        0.08 +
        Math.sin((index / Math.max(1, slices - 1)) * Math.PI) * 0.07 +
        Math.max(0, 0.1 - distance * 0.16);
    });
  };
}

function SpectrumScene({ data }: { data: ScienceSceneData }) {
  const peaks = useMemo(
    () => (Array.isArray(data.peaks) ? (data.peaks as SpectrumPeak[]) : []),
    [data.peaks]
  );
  const visiblePeaks = useMemo(
    () =>
      peaks.length
        ? peaks
        : [
            {
              color: "#2dd4bf",
              fragment: "reference band",
              height: 0.72,
              label: "peak",
              width: 0.002,
              x: 0.5,
            },
          ],
    [peaks]
  );
  const [activePeak, setActivePeak] = useState(0);
  const activeIndex = Math.min(activePeak, Math.max(visiblePeaks.length - 1, 0));
  const active = visiblePeaks[activeIndex];
  const spectrum = useMemo(() => {
    const signalAt = (sample: number) => {
      const baseline =
        0.035 +
        Math.sin(sample * 52) * 0.011 +
        Math.sin(sample * 137 + 0.4) * 0.006;
      const value = visiblePeaks.reduce((sum, peak, index) => {
        const widthValue = Math.max(peak.width ?? 0.0022, 0.0008);
        const distance = sample - peak.x;
        const shoulderA = distance - (0.018 + index * 0.0008);
        const shoulderB = distance + (0.026 - index * 0.0005);
        return (
          sum +
          peak.height * Math.exp(-(distance * distance) / widthValue) +
          peak.height *
            0.22 *
            Math.exp(-(shoulderA * shoulderA) / (widthValue * 2.8)) +
          peak.height *
            0.13 *
            Math.exp(-(shoulderB * shoulderB) / (widthValue * 4.2))
        );
      }, baseline);
      return Math.min(1.04, Math.max(0, value));
    };

    const toX = (sample: number) =>
      SPECTRUM_PLOT.left + sample * SPECTRUM_PLOT.width;
    const toY = (value: number) =>
      SPECTRUM_PLOT.bottom - value * SPECTRUM_PLOT.height;
    const points = Array.from({ length: 560 }, (_, index) => {
      const sample = index / 559;
      const value = signalAt(sample);
      return {
        sample,
        value,
        x: toX(sample),
        y: toY(value),
      };
    });
    const linePath = points
      .map((point, index) => {
        if (index === 0) {
          return `M ${point.x.toFixed(1)} ${point.y.toFixed(1)}`;
        }
        const previous = points[index - 1];
        const midX = (previous.x + point.x) / 2;
        return `C ${midX.toFixed(1)} ${previous.y.toFixed(1)} ${midX.toFixed(
          1
        )} ${point.y.toFixed(1)} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`;
      })
      .join(" ");
    const areaPath = `${linePath} L ${
      SPECTRUM_PLOT.left + SPECTRUM_PLOT.width
    } ${SPECTRUM_PLOT.bottom} L ${SPECTRUM_PLOT.left} ${
      SPECTRUM_PLOT.bottom
    } Z`;
    const heatBands = Array.from({ length: 84 }, (_, index) => {
      const sample = index / 83;
      const value = signalAt(sample);
      const palette =
        sample < 0.35 ? "#22d3ee" : sample < 0.66 ? "#a78bfa" : "#fb7185";
      return {
        color: palette,
        height: Math.max(12, value * SPECTRUM_PLOT.height),
        opacity: 0.025 + value * 0.13,
        x: toX(sample),
      };
    });
    const peakNodes = visiblePeaks.map((peak, index) => {
      const x = toX(peak.x);
      const value = signalAt(peak.x);
      const y = toY(value);
      const fragmentX =
        SPECTRUM_PLOT.left +
        ((index + 0.5) / visiblePeaks.length) * SPECTRUM_PLOT.width;
      const fragmentY = SPECTRUM_HEIGHT - 46;
      return {
        ...peak,
        color: peak.color || "#f8fafc",
        fragmentX,
        fragmentY,
        linkPath: `M ${x.toFixed(1)} ${(y + 8).toFixed(1)} C ${x.toFixed(
          1
        )} ${(SPECTRUM_PLOT.bottom + 22).toFixed(
          1
        )} ${fragmentX.toFixed(1)} ${(fragmentY - 54).toFixed(
          1
        )} ${fragmentX.toFixed(1)} ${fragmentY.toFixed(1)}`,
        x,
        y,
      };
    });
    return { areaPath, heatBands, linePath, peakNodes };
  }, [visiblePeaks]);

  const activeNode = spectrum.peakNodes[activeIndex] ?? spectrum.peakNodes[0];

  return (
    <div
      className="relative flex h-full min-h-0 w-full flex-col overflow-hidden bg-[#030712] text-white"
      data-science-viewer="true"
      data-science-scene-type="spectrum"
    >
      <ScienceOverlay data={data} />
      <div className="flex min-h-0 flex-1 items-center justify-center px-4 pt-16">
        <svg
          viewBox={`0 0 ${SPECTRUM_WIDTH} ${SPECTRUM_HEIGHT}`}
          className="h-full max-h-[520px] w-full overflow-visible"
          role="img"
          aria-label={data.title || "linked spectrum"}
        >
          <defs>
            <linearGradient
              id="spectrum-line"
              x1="0"
              x2="1"
              y1="0"
              y2="0"
            >
              <stop offset="0%" stopColor="#2dd4bf" />
              <stop offset="55%" stopColor="#a78bfa" />
              <stop offset="100%" stopColor="#fb7185" />
            </linearGradient>
            <linearGradient id="spectrum-fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#2dd4bf" stopOpacity="0.34" />
              <stop offset="45%" stopColor="#a78bfa" stopOpacity="0.12" />
              <stop offset="100%" stopColor="#020617" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="spectrum-scan" x1="0" x2="1" y1="0" y2="0">
              <stop offset="0%" stopColor="#22d3ee" stopOpacity="0" />
              <stop offset="45%" stopColor="#e0f2fe" stopOpacity="0.17" />
              <stop offset="100%" stopColor="#fb7185" stopOpacity="0" />
            </linearGradient>
            <radialGradient id="spectrum-bg" cx="52%" cy="44%" r="68%">
              <stop offset="0%" stopColor="#164e63" stopOpacity="0.42" />
              <stop offset="54%" stopColor="#111827" stopOpacity="0.58" />
              <stop offset="100%" stopColor="#020617" stopOpacity="1" />
            </radialGradient>
            <filter id="spectrum-glow">
              <feGaussianBlur stdDeviation="6" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <filter id="spectrum-soft-glow">
              <feGaussianBlur stdDeviation="12" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          <rect
            x="0"
            y="0"
            width={SPECTRUM_WIDTH}
            height={SPECTRUM_HEIGHT}
            fill="url(#spectrum-bg)"
          />
          <rect
            x={SPECTRUM_PLOT.left}
            y={SPECTRUM_PLOT.top}
            width={SPECTRUM_PLOT.width}
            height={SPECTRUM_PLOT.height}
            rx="18"
            fill="rgba(2, 6, 23, 0.44)"
            stroke="rgba(255,255,255,0.1)"
          />
          {spectrum.heatBands.map((band, index) => (
            <rect
              key={`band-${index}`}
              x={band.x - 3.5}
              y={SPECTRUM_PLOT.bottom - band.height}
              width="7"
              height={band.height}
              fill={band.color}
              opacity={band.opacity}
            />
          ))}
          {[0.2, 0.4, 0.6, 0.8].map((tick) => (
            <line
              key={`h-${tick}`}
              x1={SPECTRUM_PLOT.left}
              x2={SPECTRUM_PLOT.left + SPECTRUM_PLOT.width}
              y1={SPECTRUM_PLOT.bottom - tick * SPECTRUM_PLOT.height}
              y2={SPECTRUM_PLOT.bottom - tick * SPECTRUM_PLOT.height}
              stroke="rgba(226,232,240,0.1)"
              strokeDasharray="2 8"
            />
          ))}
          {[0, 0.2, 0.4, 0.6, 0.8, 1].map((tick) => (
            <line
              key={`v-${tick}`}
              x1={SPECTRUM_PLOT.left + tick * SPECTRUM_PLOT.width}
              x2={SPECTRUM_PLOT.left + tick * SPECTRUM_PLOT.width}
              y1={SPECTRUM_PLOT.top}
              y2={SPECTRUM_PLOT.bottom}
              stroke="rgba(226,232,240,0.07)"
            />
          ))}
          {activeNode && (
            <rect
              x={Math.max(SPECTRUM_PLOT.left, activeNode.x - 42)}
              y={SPECTRUM_PLOT.top}
              width={Math.min(
                84,
                SPECTRUM_PLOT.left +
                  SPECTRUM_PLOT.width -
                  activeNode.x +
                  42
              )}
              height={SPECTRUM_PLOT.height}
              fill="url(#spectrum-scan)"
              opacity="0.82"
            />
          )}
          <path d={spectrum.areaPath} fill="url(#spectrum-fill)" />
          <path
            d={spectrum.linePath}
            fill="none"
            filter="url(#spectrum-soft-glow)"
            stroke="url(#spectrum-line)"
            strokeLinecap="round"
            strokeWidth="18"
            opacity="0.2"
          />
          <path
            d={spectrum.linePath}
            fill="none"
            filter="url(#spectrum-glow)"
            stroke="url(#spectrum-line)"
            strokeLinecap="round"
            strokeWidth="7"
            opacity="0.55"
          />
          <path
            d={spectrum.linePath}
            fill="none"
            stroke="#f8fafc"
            strokeLinecap="round"
            strokeWidth="1.2"
            opacity="0.78"
          />
          <line
            x1={SPECTRUM_PLOT.left}
            x2={SPECTRUM_PLOT.left + SPECTRUM_PLOT.width}
            y1={SPECTRUM_PLOT.bottom}
            y2={SPECTRUM_PLOT.bottom}
            stroke="rgba(255,255,255,0.34)"
          />
          {spectrum.peakNodes.map((peak, index) => {
            const isActive = index === activeIndex;
            return (
              <g
                key={`${peak.label}-${index}`}
                onMouseEnter={() => setActivePeak(index)}
                onFocus={() => setActivePeak(index)}
                tabIndex={0}
              >
                <path
                  d={peak.linkPath}
                  fill="none"
                  stroke={peak.color}
                  strokeOpacity={isActive ? 0.54 : 0.14}
                  strokeWidth={isActive ? 1.8 : 1}
                />
                <line
                  x1={peak.x}
                  x2={peak.x}
                  y1={SPECTRUM_PLOT.bottom}
                  y2={peak.y}
                  stroke={peak.color}
                  strokeOpacity={isActive ? 0.96 : 0.48}
                  strokeWidth={isActive ? 4.2 : 2.2}
                  filter="url(#spectrum-glow)"
                />
                <circle
                  cx={peak.x}
                  cy={peak.y}
                  fill={peak.color}
                  r={isActive ? 9 : 5}
                  stroke="rgba(255,255,255,0.72)"
                  strokeWidth={isActive ? 1.5 : 0}
                />
                {isActive && (
                  <circle
                    cx={peak.x}
                    cy={peak.y}
                    fill="none"
                    r="17"
                    stroke={peak.color}
                    strokeOpacity="0.35"
                    strokeWidth="2"
                  />
                )}
                <g transform={`translate(${peak.fragmentX} ${peak.fragmentY})`}>
                  <circle
                    r={isActive ? 15 : 10}
                    fill={peak.color}
                    opacity={isActive ? 0.28 : 0.13}
                  />
                  <circle
                    r={isActive ? 5 : 3.5}
                    fill={peak.color}
                    opacity={isActive ? 0.95 : 0.58}
                  />
                  <text
                    x="0"
                    y="28"
                    fill="rgba(248,250,252,0.78)"
                    fontSize="11"
                    textAnchor="middle"
                  >
                    {peak.label}
                  </text>
                </g>
              </g>
            );
          })}
        </svg>
      </div>
      <div className="grid shrink-0 grid-cols-[minmax(0,1fr)_auto] gap-3 border-t border-white/10 bg-black/35 p-4 backdrop-blur">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">
            {active?.label || "peak"}
          </p>
          <p className="truncate text-xs text-white/62">
            {active?.fragment || "spectral fragment"}
          </p>
        </div>
        <div className="flex max-w-[52vw] flex-wrap justify-end gap-1.5">
          {visiblePeaks.map((peak, index) => (
            <button
              key={`${peak.label}-button`}
              type="button"
              className={cn(
                "h-8 rounded-md border px-2 text-xs transition-colors",
                index === activeIndex
                  ? "border-white/45 bg-white/16 text-white"
                  : "border-white/10 bg-white/5 text-white/62 hover:border-white/25 hover:text-white"
              )}
              onClick={() => setActivePeak(index)}
            >
              {peak.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function ScienceOverlay({ data }: { data: ScienceSceneData }) {
  return (
    <div className="pointer-events-none absolute left-3 top-3 z-10 max-w-[calc(100%-1.5rem)] rounded-md border border-white/12 bg-black/30 px-3 py-2 text-white shadow-lg backdrop-blur">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-white/65">
        <Waves className="h-3.5 w-3.5" />
        {SCENE_LABELS[data.type]}
      </div>
      <div className="mt-1 truncate text-sm font-semibold">
        {data.title || SCENE_LABELS[data.type]}
      </div>
      {data.subtitle && (
        <div className="mt-0.5 truncate text-xs text-white/62">
          {data.subtitle}
        </div>
      )}
      {Array.isArray(data.metrics) && data.metrics.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {data.metrics.slice(0, 4).map((metric) => (
            <span
              key={`${metric.label}-${metric.value}`}
              className="rounded-sm bg-white/10 px-1.5 py-0.5 text-[11px] text-white/75"
            >
              {metric.label}: {metric.value}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function ScienceThreeScene({ data }: { data: ScienceSceneData }) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<WebGLRenderer | null>(null);
  const cameraRef = useRef<PerspectiveCamera | null>(null);
  const rootRef = useRef<Group | null>(null);
  const frameRef = useRef<number | null>(null);
  const dragRef = useRef<{ x: number; y: number; pointerId: number } | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const resetView = useCallback(() => {
    const camera = cameraRef.current;
    const root = rootRef.current;
    if (!camera || !root) return;
    root.rotation.set(-0.18, 0.62, 0);
    camera.position.set(0, 0.4, 6.2);
  }, []);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (
        event.target instanceof Element &&
        event.target.closest('[data-science-controls="true"]')
      ) {
        return;
      }
      event.preventDefault();
      dragRef.current = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      setIsDragging(true);
    },
    []
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      const root = rootRef.current;
      if (!drag || !root || drag.pointerId !== event.pointerId) return;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      dragRef.current = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
      };
      root.rotation.y += dx * 0.008;
      root.rotation.x += dy * 0.008;
    },
    []
  );

  const finishDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
      setIsDragging(false);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    }
  }, []);

  const handleWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    const camera = cameraRef.current;
    if (!camera) return;
    event.preventDefault();
    camera.position.z = Math.max(
      2.6,
      Math.min(10, camera.position.z + event.deltaY * 0.006)
    );
  }, []);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    let disposed = false;
    let cleanup: (() => void) | undefined;

    async function setup() {
      const THREE = await import("three");
      const activeMount = mountRef.current;
      if (disposed || !activeMount) return;

      const renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: true,
      });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(
        activeMount.clientWidth || 1,
        activeMount.clientHeight || 1
      );
      rendererRef.current = renderer;
      activeMount.replaceChildren(renderer.domElement);

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(
        42,
        (activeMount.clientWidth || 1) / (activeMount.clientHeight || 1),
        0.1,
        100
      );
      camera.position.set(0, 0.4, 6.2);
      cameraRef.current = camera;

      scene.add(new THREE.AmbientLight(0xffffff, 1.35));
      const key = new THREE.DirectionalLight(0x7dd3fc, 1.8);
      key.position.set(3, 5, 4);
      scene.add(key);
      const fill = new THREE.PointLight(0xfb7185, 1.2);
      fill.position.set(-3, -2, 3);
      scene.add(fill);

      const root = new THREE.Group();
      root.rotation.set(-0.18, 0.62, 0);
      scene.add(root);
      rootRef.current = root;

      const animators: Array<(time: number) => void> = [];
      if (data.type === "crystal") {
        buildCrystalScene(THREE, data, root);
      } else if (data.type === "orbital") {
        const animate = buildOrbitalScene(THREE, data, root);
        if (animate) animators.push(animate);
      } else if (data.type === "flow") {
        const animate = buildFlowScene(THREE, data, root);
        if (animate) animators.push(animate);
      } else if (data.type === "microscopy") {
        buildMicroscopyScene(THREE, data, root);
      }

      const observer = new ResizeObserver(() => {
        if (!mountRef.current) return;
        const width = mountRef.current.clientWidth || 1;
        const height = mountRef.current.clientHeight || 1;
        renderer.setSize(width, height);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
      });
      observer.observe(activeMount);

      const animate = (timeMs: number) => {
        if (disposed) return;
        const time = timeMs / 1000;
        if (!dragRef.current) {
          root.rotation.y += 0.0026;
        }
        animators.forEach((item) => item(time));
        renderer.render(scene, camera);
        frameRef.current = requestAnimationFrame(animate);
      };
      frameRef.current = requestAnimationFrame(animate);

      cleanup = () => {
        observer.disconnect();
        if (frameRef.current !== null) {
          cancelAnimationFrame(frameRef.current);
        }
        renderer.dispose();
        activeMount.replaceChildren();
      };
    }

    void setup().catch((setupError) => {
      setError(
        setupError instanceof Error
          ? setupError.message
          : "无法渲染科学场景。"
      );
    });

    return () => {
      disposed = true;
      cleanup?.();
      rendererRef.current = null;
      cameraRef.current = null;
      rootRef.current = null;
      dragRef.current = null;
    };
  }, [data]);

  return (
    <div
      className={cn(
        "relative h-full min-h-0 w-full touch-none select-none overflow-hidden bg-[radial-gradient(circle_at_20%_10%,rgba(45,212,191,0.18),transparent_28%),radial-gradient(circle_at_80%_25%,rgba(251,113,133,0.16),transparent_26%),linear-gradient(145deg,#06110f,#101623_55%,#0b1110)]",
        isDragging ? "cursor-grabbing" : "cursor-grab"
      )}
      data-science-viewer="true"
      data-science-scene-type={data.type}
      onPointerDownCapture={handlePointerDown}
      onPointerMoveCapture={handlePointerMove}
      onPointerUpCapture={finishDrag}
      onPointerCancelCapture={finishDrag}
      onWheel={handleWheel}
    >
      <div
        ref={mountRef}
        className="absolute inset-0"
      />
      <ScienceOverlay data={data} />
      <div
        className="absolute right-3 top-3 z-10 flex gap-1 rounded-md border border-white/12 bg-black/30 p-1 shadow-lg backdrop-blur"
        data-science-controls="true"
      >
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-white/75 hover:bg-white/10 hover:text-white"
          onClick={resetView}
          aria-label="重置视角"
          title="重置视角"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </Button>
        <div className="grid h-7 w-7 place-items-center text-white/55">
          <Maximize2 className="h-3.5 w-3.5" />
        </div>
      </div>
      {error && (
        <div className="absolute bottom-3 left-3 right-3 rounded-md border border-red-300/40 bg-red-950/80 px-3 py-2 text-xs text-red-50">
          {error}
        </div>
      )}
    </div>
  );
}

export function ScienceSceneViewer({ file }: { file: WorkspaceFileResponse }) {
  const { data, error } = useMemo(() => {
    try {
      return { data: parseScienceScene(file), error: null };
    } catch (parseError) {
      return {
        data: null,
        error:
          parseError instanceof Error ? parseError.message : "无法解析科学场景。",
      };
    }
  }, [file]);

  if (file.tooLarge) {
    return (
      <div className="flex h-full items-center justify-center bg-muted/30 px-8 text-center">
        <div className="rounded-md border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
          这个科学场景文件太大，无法在这里直接渲染。
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex h-full items-center justify-center bg-muted/30 px-8 text-center">
        <div className="rounded-md border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
          {error || "无法读取这个科学场景文件。"}
        </div>
      </div>
    );
  }

  if (!isThreeScene(data.type)) {
    return <SpectrumScene data={data} />;
  }

  return <ScienceThreeScene data={data} />;
}
