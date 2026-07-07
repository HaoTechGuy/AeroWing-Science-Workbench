#!/usr/bin/env python3
"""Flight condition calculator for AeroWing."""

from __future__ import annotations

import argparse
import json
import math
from typing import Any

SEA_LEVEL_TEMPERATURE_K = 288.15
SEA_LEVEL_PRESSURE_PA = 101325.0
LAPSE_RATE_K_PER_M = 0.0065
GAMMA_AIR = 1.4
GAS_CONSTANT_AIR = 287.05287
GRAVITY = 9.80665


def standard_atmosphere(altitude_m: float) -> dict[str, float]:
    altitude_m = max(0.0, altitude_m)
    if altitude_m <= 11000.0:
        temperature = SEA_LEVEL_TEMPERATURE_K - LAPSE_RATE_K_PER_M * altitude_m
        pressure = SEA_LEVEL_PRESSURE_PA * (
            temperature / SEA_LEVEL_TEMPERATURE_K
        ) ** (GRAVITY / (GAS_CONSTANT_AIR * LAPSE_RATE_K_PER_M))
    else:
        temperature = 216.65
        pressure_11km = SEA_LEVEL_PRESSURE_PA * (
            temperature / SEA_LEVEL_TEMPERATURE_K
        ) ** (GRAVITY / (GAS_CONSTANT_AIR * LAPSE_RATE_K_PER_M))
        pressure = pressure_11km * math.exp(
            -GRAVITY * (altitude_m - 11000.0) / (GAS_CONSTANT_AIR * temperature)
        )
    density = pressure / (GAS_CONSTANT_AIR * temperature)
    speed_of_sound = math.sqrt(GAMMA_AIR * GAS_CONSTANT_AIR * temperature)
    dynamic_viscosity = 1.458e-6 * temperature**1.5 / (temperature + 110.4)
    return {
        "altitude_m": altitude_m,
        "temperature_k": temperature,
        "pressure_pa": pressure,
        "density_kg_m3": density,
        "speed_of_sound_m_s": speed_of_sound,
        "dynamic_viscosity_pa_s": dynamic_viscosity,
    }


def round_floats(value: Any) -> Any:
    if isinstance(value, float):
        return round(value, 6)
    if isinstance(value, dict):
        return {key: round_floats(item) for key, item in value.items()}
    if isinstance(value, list):
        return [round_floats(item) for item in value]
    return value


def calculate(args: argparse.Namespace) -> dict[str, Any]:
    atmosphere = standard_atmosphere(args.altitude_m)
    if args.speed_m_s is None:
        if args.mach is None:
            raise SystemExit("Provide either --mach or --speed-m-s.")
        speed = args.mach * atmosphere["speed_of_sound_m_s"]
        mach = args.mach
    else:
        speed = args.speed_m_s
        mach = speed / atmosphere["speed_of_sound_m_s"]

    dynamic_pressure = 0.5 * atmosphere["density_kg_m3"] * speed**2
    reynolds = None
    if args.reference_length_m and args.reference_length_m > 0:
        reynolds = (
            atmosphere["density_kg_m3"]
            * speed
            * args.reference_length_m
            / atmosphere["dynamic_viscosity_pa_s"]
        )
    required_cl = None
    if args.reference_area_m2 and args.reference_area_m2 > 0 and args.weight_n:
        required_cl = args.weight_n * args.load_factor / (
            dynamic_pressure * args.reference_area_m2
        )

    return round_floats(
        {
            "schema": "AeroWingFlightCondition",
            "atmosphere": atmosphere,
            "speed_m_s": speed,
            "mach": mach,
            "dynamic_pressure_pa": dynamic_pressure,
            "reynolds_number": reynolds,
            "required_lift_coefficient": required_cl,
            "load_factor": args.load_factor,
            "notes": [
                "ISA model for preliminary screening.",
                "Confirm units, reference area, load factor, and aircraft weight before formal use.",
            ],
        }
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Calculate preliminary aircraft flight conditions.")
    parser.add_argument("--altitude-m", type=float, required=True)
    parser.add_argument("--mach", type=float)
    parser.add_argument("--speed-m-s", type=float)
    parser.add_argument("--reference-length-m", type=float)
    parser.add_argument("--reference-area-m2", type=float)
    parser.add_argument("--weight-n", type=float)
    parser.add_argument("--load-factor", type=float, default=1.0)
    args = parser.parse_args()
    print(json.dumps(calculate(args), ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
