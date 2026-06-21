"""
Log Normalizer — Adapter Pattern
Converts any log format into the canonical internal schema using a config file.

Canonical schema:
  timestamp          (ISO8601 string)
  source_service     (string)
  target_service     (string)
  endpoint           (string, optional)
  latency_ms         (float)
  status_code        (int)
  error_type         (string or None)
  concurrent_requests(int, optional)
  cpu_percent        (float, optional)
  memory_percent     (float, optional)
  retry_count        (int, optional)
"""

import csv
import json
import io
import re
from typing import List, Dict, Any, Optional


# ---------------------------------------------------------------------------
# Adapter config schema (what the user provides)
# ---------------------------------------------------------------------------
# {
#   "input_format": "csv" | "json" | "apache",
#   "delimiter": ",",          # csv only
#   "field_mappings": {
#       "timestamp":           "their_field_name" | null,
#       "source_service":      "their_field_name" | null,
#       "target_service":      "their_field_name" | null,
#       "endpoint":            "their_field_name" | null,
#       "latency_ms":          "their_field_name" | null,
#       "status_code":         "their_field_name" | null,
#       "error_type":          "their_field_name" | null,
#       "concurrent_requests": "their_field_name" | null,
#       "cpu_percent":         "their_field_name" | null,
#       "memory_percent":      "their_field_name" | null,
#       "retry_count":         "their_field_name" | null
#   },
#   "error_detection": {
#       "from_status_code": true,
#       "error_threshold": 400
#   },
#   "derived_fields": {
#       "source_service": "static:api-gateway",   # set a static value
#       "concurrent_requests": "ignore"            # skip this field
#   }
# }

CANONICAL_FIELDS = [
    "timestamp", "source_service", "target_service", "endpoint",
    "latency_ms", "status_code", "error_type",
    "concurrent_requests", "cpu_percent", "memory_percent", "retry_count",
]

REQUIRED_FIELDS = {"timestamp", "source_service", "target_service", "latency_ms", "status_code"}


class NormalizationError(Exception):
    pass


def _cast(value: str, field: str) -> Any:
    """Cast raw string value to appropriate Python type."""
    if value is None or value == "":
        return None
    if field == "latency_ms":
        # Accept values like "342ms", "342.5", "0.342s"
        v = str(value).lower().replace("ms", "").replace("s", "").strip()
        f = float(v)
        if "s" in str(value).lower() and "ms" not in str(value).lower():
            f *= 1000  # convert seconds to ms
        return f
    if field in ("status_code", "concurrent_requests", "retry_count"):
        return int(float(str(value).strip()))
    if field in ("cpu_percent", "memory_percent"):
        v = str(value).replace("%", "").strip()
        return float(v)
    return str(value).strip()


def _apply_error_detection(row: Dict, config: Dict) -> Dict:
    """If error_type is missing, derive it from status_code."""
    ed = config.get("error_detection", {})
    if not ed.get("from_status_code", False):
        return row
    threshold = ed.get("error_threshold", 400)
    if row.get("error_type") is None and row.get("status_code") is not None:
        if row["status_code"] >= threshold:
            code = row["status_code"]
            if code == 504:
                row["error_type"] = "timeout"
            elif code == 503:
                row["error_type"] = "connection_refused"
            elif code >= 500:
                row["error_type"] = "internal_error"
            elif code >= 400:
                row["error_type"] = "client_error"
    return row


def _map_row(raw: Dict[str, str], config: Dict) -> Optional[Dict]:
    """Map a single raw row to canonical schema using field_mappings."""
    mappings = config.get("field_mappings", {})
    derived = config.get("derived_fields", {})
    result = {}

    for canonical in CANONICAL_FIELDS:
        their_field = mappings.get(canonical)
        value = None

        if canonical in derived:
            directive = derived[canonical]
            if directive == "ignore":
                value = None
            elif str(directive).startswith("static:"):
                value = directive.split("static:", 1)[1]
            else:
                value = directive
        elif their_field and their_field in raw:
            value = raw[their_field]
        elif canonical in raw:
            # Fall back to same-name field if no mapping provided
            value = raw[canonical]

        try:
            result[canonical] = _cast(value, canonical) if value not in (None, "") else None
        except (ValueError, TypeError):
            result[canonical] = None

    # Check required fields
    for req in REQUIRED_FIELDS:
        if result.get(req) is None:
            return None  # skip rows missing critical fields

    result = _apply_error_detection(result, config)
    return result


# ---------------------------------------------------------------------------
# Format parsers
# ---------------------------------------------------------------------------

def _parse_csv(content: str, config: Dict) -> List[Dict]:
    delimiter = config.get("delimiter", ",")
    reader = csv.DictReader(io.StringIO(content), delimiter=delimiter)
    rows = []
    for raw in reader:
        mapped = _map_row(dict(raw), config)
        if mapped:
            rows.append(mapped)
    return rows


def _parse_json(content: str, config: Dict) -> List[Dict]:
    data = json.loads(content)
    if isinstance(data, dict):
        # Try common envelope keys
        for key in ("logs", "events", "records", "data", "items"):
            if key in data:
                data = data[key]
                break
        else:
            data = [data]
    rows = []
    for raw in data:
        flat = {k: str(v) for k, v in raw.items() if not isinstance(v, (dict, list))}
        mapped = _map_row(flat, config)
        if mapped:
            rows.append(mapped)
    return rows


# Apache Combined Log Format:
# 127.0.0.1 - frank [10/Oct/2000:13:55:36 -0700] "GET /apache_pb.gif HTTP/1.0" 200 2326 0.045
APACHE_RE = re.compile(
    r'(?P<host>\S+) \S+ \S+ \[(?P<time>[^\]]+)\] '
    r'"(?P<method>\S+) (?P<path>\S+) \S+" '
    r'(?P<status>\d{3}) \S+ (?P<duration>\S+)'
)


def _parse_apache(content: str, config: Dict) -> List[Dict]:
    rows = []
    for line in content.splitlines():
        m = APACHE_RE.match(line.strip())
        if not m:
            continue
        raw = {
            "timestamp": m.group("time"),
            "endpoint": m.group("path"),
            "status_code": m.group("status"),
            "latency_ms": m.group("duration"),
        }
        # source/target may come from derived_fields in config
        mapped = _map_row(raw, config)
        if mapped:
            rows.append(mapped)
    return rows


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def normalize(content: str, config: Dict) -> List[Dict]:
    """
    Normalize raw log content to canonical schema.

    Args:
        content: Raw log file content as string
        config:  Adapter config dict (from adapter_config.json)

    Returns:
        List of canonical log dicts
    """
    fmt = config.get("input_format", "csv").lower()
    if fmt == "csv":
        return _parse_csv(content, config)
    elif fmt == "json":
        return _parse_json(content, config)
    elif fmt == "apache":
        return _parse_apache(content, config)
    else:
        raise NormalizationError(f"Unsupported input_format: '{fmt}'. Supported: csv, json, apache")


def normalize_file(filepath: str, config: Dict) -> List[Dict]:
    with open(filepath, "r", encoding="utf-8") as f:
        content = f.read()
    return normalize(content, config)


def get_available_features(rows: List[Dict]) -> Dict[str, bool]:
    """Report which optional features are available given the normalized data."""
    if not rows:
        return {}
    sample = rows[0]
    return {
        "load_simulation":      sample.get("concurrent_requests") is not None,
        "resource_saturation":  sample.get("cpu_percent") is not None,
        "memory_analysis":      sample.get("memory_percent") is not None,
        "retry_amplification":  sample.get("retry_count") is not None,
        "endpoint_breakdown":   sample.get("endpoint") is not None,
    }
