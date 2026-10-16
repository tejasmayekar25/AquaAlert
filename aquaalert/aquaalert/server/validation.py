"""Validation helpers for incoming AquaAlert sensor payloads."""

import math
import re
from typing import Any

VALID_STATUSES = {"NORMAL", "WARNING", "HIGH", "CRITICAL"}
_DEVICE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$")


def _number(
    value: Any, name: str, minimum: float, maximum: float | None = None
) -> tuple[float | None, str | None]:
    if (
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or not math.isfinite(float(value))
    ):
        return None, f"{name} must be a finite number"
    number = float(value)
    if number < minimum or (maximum is not None and number > maximum):
        limit = (
            f" between {minimum:g} and {maximum:g}"
            if maximum is not None
            else f" >= {minimum:g}"
        )
        return None, f"{name} must be{limit}"
    return number, None


def validate_sensor_payload(payload: Any) -> tuple[dict[str, Any] | None, list[str]]:
    """Validate and normalize an ESP32 payload before persistence."""
    if not isinstance(payload, dict):
        return None, ["JSON body must be an object"]

    errors: list[str] = []
    device_id = payload.get("device_id")
    if not isinstance(device_id, str) or not _DEVICE_ID.fullmatch(device_id):
        errors.append("device_id must contain 1-32 letters, numbers, '_' or '-'")

    distance, error = _number(payload.get("distance"), "distance", 0, 450)
    if error:
        errors.append(error)

    water_level, error = _number(payload.get("waterLevel"), "waterLevel", 0, 100)
    if error:
        errors.append(error)

    percentage, error = _number(payload.get("percentage"), "percentage", 0, 100)
    if error:
        errors.append(error)
    elif not percentage.is_integer():
        errors.append("percentage must be an integer between 0 and 100")

    status = payload.get("status")
    if not isinstance(status, str) or status not in VALID_STATUSES:
        errors.append("status must be one of: " + ", ".join(sorted(VALID_STATUSES)))

    rainfall_val = 0.0
    if "rainfall" in payload and payload.get("rainfall") is not None:
        r_num, error = _number(payload.get("rainfall"), "rainfall", 0, 500)
        if error:
            errors.append(error)
        else:
            rainfall_val = r_num or 0.0

    if errors:
        return None, errors

    return {
        "device_id": device_id,
        "distance": distance,
        "waterLevel": water_level,
        "percentage": int(percentage),
        "status": status,
        "rainfall": rainfall_val,
    }, []

