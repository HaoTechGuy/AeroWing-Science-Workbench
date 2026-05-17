#!/usr/bin/env python3
"""Check runtime dependencies for the local npm-installed kb wrapper."""
from __future__ import annotations

import argparse
import shutil
import subprocess
import sys


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--postinstall", action="store_true", help="emit postinstall-friendly messages")
    args = parser.parse_args()

    python = shutil.which("python3")
    if not python:
        print("kb runtime check failed: python3 was not found on PATH", file=sys.stderr)
        return 1

    proc = subprocess.run(
        [python, "-c", "import yaml; print('PyYAML available')"],
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if proc.returncode != 0:
        print("kb runtime check failed: Python package PyYAML is required", file=sys.stderr)
        print("Install it with one of:", file=sys.stderr)
        print("  python3 -m pip install PyYAML", file=sys.stderr)
        print("  sudo apt-get install python3-yaml", file=sys.stderr)
        if proc.stderr.strip():
            print(proc.stderr.strip(), file=sys.stderr)
        return 1

    if not args.postinstall:
        print(f"python3: {python}")
        print(proc.stdout.strip())
        print("kb runtime check passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
