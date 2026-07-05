---
name: aircraft-geometry-audit
description: Audit aircraft CAD/CAE geometry and mesh files for aviation analysis readiness. Use when inspecting STL/OBJ/PLY/VTK/VTU/INP mesh geometry, checking dimensions, surface area, volume, watertightness, degenerate faces, mesh scale, and whether a model is suitable for CFD, FEM, visualization, or 3D printing workflows.
---

# Aircraft Geometry Audit

Use this skill to evaluate geometry/mesh readiness before aviation structure, CFD, FEM, or visualization work.

## Workflow

1. Identify the file type and intended downstream use: visualization, CFD surface prep, FEM shell/solid meshing, or 3D printing.
2. Run `tools/audit_geometry.py <file>` for deterministic metrics. Add `--markdown` when a report is needed.
3. Interpret the JSON/Markdown using engineering context:
   - Large bounding-box ratios can indicate wing/fuselage scale or unit issues.
   - Non-watertight STL/OBJ/PLY meshes are risky for volume, CFD volume meshing, and 3D printing.
   - Degenerate faces and duplicated/isolated vertices should be cleaned before solver use.
   - STL carries tessellated geometry only; materials, loads, constraints, and CAD features are absent.
4. Recommend next steps: repair mesh, simplify/downsample, convert format, assign materials/properties, or create solver-specific BDF/INP.

## Tool

`audit_geometry.py` supports STL/OBJ/PLY through `trimesh` and common VTK/VTU/INP/STL mesh containers through `meshio` fallback. It emits:

- bounding box dimensions and centroid
- length, wing span, height, and full envelope box
- surface area and volume when available
- watertight, boundary edge, and non-manifold edge checks when supported
- point/cell/triangle counts
- degenerate face count when triangular faces are available
- readiness flags for visualization, CFD, FEM, and 3D printing
- Markdown report output with `--markdown`
