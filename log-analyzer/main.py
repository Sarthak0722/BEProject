"""
Kendra Log Analyzer — Flask API
Endpoints:
  POST /analyze          — normalize logs + generate services.json + train all models
  POST /predict/load     — predict system health at N concurrent users
  POST /predict/cascade  — predict cascade probability for a fault injection
  GET  /insights         — risk scores, saturation points, anomaly periods, retry amplification
  POST /normalize        — normalize raw logs (for adapter demo)
  GET  /health           — service health check
"""

import os
import io
import csv
import re
import json
import traceback
from flask import Flask, request, jsonify
from flask_cors import CORS

from log_generator import generate_logs
from normalizer import normalize, normalize_file, get_available_features
from analyzer import generate_services_json
from models import (
    LoadLatencyModel,
    CascadeModel,
    AnomalyDetector,
    SaturationModel,
    compute_retry_amplification,
    compute_risk_scores,
)

app = Flask(__name__)
CORS(app)

# ---------------------------------------------------------------------------
# In-memory state — holds trained models and analysis results
# ---------------------------------------------------------------------------
state = {
    "rows": [],
    "services_json": None,
    "load_model": None,
    "cascade_model": None,
    "anomaly_detector": None,
    "saturation_model": None,
    "risk_scores": {},
    "retry_info": {},
    "features": {},
    "trained": False,
}

SAMPLE_LOGS_DIR = os.path.join(os.path.dirname(__file__), "sample_logs")
DEFAULT_LOG_PATH = os.path.join(SAMPLE_LOGS_DIR, "bbd_logs.csv")
SERVICES_JSON_PATH = os.path.join(os.path.dirname(__file__), "..", "simulation-engine", "services.json")

DEFAULT_ADAPTER_CONFIG = {
    "input_format": "csv",
    "field_mappings": {
        "timestamp": "timestamp",
        "source_service": "source_service",
        "target_service": "target_service",
        "endpoint": "endpoint",
        "latency_ms": "latency_ms",
        "status_code": "status_code",
        "error_type": "error_type",
        "concurrent_requests": "concurrent_requests",
        "cpu_percent": "cpu_percent",
        "memory_percent": "memory_percent",
        "retry_count": "retry_count",
    },
    "error_detection": {"from_status_code": True, "error_threshold": 400},
}

KENDRA_SERVICES = [
    "api-gateway", "auth-service", "user-service",
    "order-service", "product-service", "database-service",
]


def _train_all_models(rows):
    """Train all 4 ML models on normalized rows."""
    # Split: normal period = first 8 hours (00:00–08:00) for anomaly baseline
    normal_rows = [r for r in rows if r["timestamp"] < "2024-11-01T08:00:00Z"]
    if len(normal_rows) < 50:
        normal_rows = rows[:max(50, len(rows) // 4)]

    load_model = LoadLatencyModel().fit(rows)
    cascade_model = CascadeModel().fit(rows)
    anomaly_detector = AnomalyDetector(contamination=0.08).fit(normal_rows)
    saturation_model = SaturationModel().fit(rows)

    risk_scores = compute_risk_scores(rows, cascade_model, saturation_model)
    retry_info = compute_retry_amplification(rows)
    features = get_available_features(rows)

    return load_model, cascade_model, anomaly_detector, saturation_model, risk_scores, retry_info, features


def _auto_initialize():
    """Auto-train on startup if default log file exists."""
    if os.path.exists(DEFAULT_LOG_PATH) and not state["trained"]:
        try:
            rows = normalize_file(DEFAULT_LOG_PATH, DEFAULT_ADAPTER_CONFIG)
            _apply_analysis(rows)
            print(f"✅ Auto-initialized with {len(rows):,} log rows from {DEFAULT_LOG_PATH}")
        except Exception as e:
            print(f"⚠️  Auto-init failed: {e}")


def _apply_analysis(rows):
    """Run full analysis pipeline and store results in state."""
    state["rows"] = rows

    # Load existing services.json for node metadata
    existing_config = None
    if os.path.exists(SERVICES_JSON_PATH):
        with open(SERVICES_JSON_PATH) as f:
            existing_config = json.load(f)

    services_json = generate_services_json(rows, existing_config)
    state["services_json"] = services_json

    (
        state["load_model"],
        state["cascade_model"],
        state["anomaly_detector"],
        state["saturation_model"],
        state["risk_scores"],
        state["retry_info"],
        state["features"],
    ) = _train_all_models(rows)

    state["trained"] = True
    return services_json


# ---------------------------------------------------------------------------
# CSV Validation
# ---------------------------------------------------------------------------

REQUIRED_COLS = ['timestamp', 'source_service', 'target_service', 'latency_ms', 'status_code']
OPTIONAL_COLS = ['endpoint', 'error_type', 'concurrent_requests', 'cpu_percent', 'memory_percent', 'retry_count']
DATE_PATTERN = re.compile(r'^\d{4}[-/]\d{2}[-/]\d{2}')

def _validate_csv(content):
    """
    Full validation of CSV content before training.
    Returns: { valid: bool, error: str|None, details: list[str], warnings: list[str], row_count: int }
    """
    details = []
    warnings = []

    if not content.strip():
        return {"valid": False, "error": "File is empty.", "details": [], "warnings": []}

    if len(content) > 50 * 1024 * 1024:
        return {"valid": False, "error": "File too large (max 50 MB).", "details": [], "warnings": []}

    # Parse CSV
    try:
        reader = csv.DictReader(io.StringIO(content))
        raw_headers = reader.fieldnames
        if not raw_headers:
            return {"valid": False, "error": "CSV has no header row.", "details": [], "warnings": []}
        headers = [h.strip().lower().replace('"', '') for h in raw_headers]
        rows = list(reader)
    except Exception as exc:
        return {"valid": False, "error": f"Cannot parse CSV: {exc}", "details": [], "warnings": []}

    # 1. Required columns
    missing = [c for c in REQUIRED_COLS if c not in headers]
    if missing:
        details.append(f"Your columns: {', '.join(headers)}")
        details.append(f"Expected: {', '.join(REQUIRED_COLS)}")
        return {
            "valid": False,
            "error": f"Missing required column(s): {', '.join(missing)}",
            "details": details,
            "warnings": warnings,
        }

    # 2. Row count
    if len(rows) == 0:
        return {"valid": False, "error": "File has a header but no data rows.", "details": [], "warnings": []}
    if len(rows) < 10:
        return {
            "valid": False,
            "error": f"Too few rows ({len(rows)}). Need at least 10 data rows.",
            "details": ["Provide at least 10 rows; 1,000+ recommended for reliable ML models."],
            "warnings": warnings,
        }
    if len(rows) < 1000:
        warnings.append(f"Only {len(rows):,} rows found. ML models work best with 1,000+ rows.")

    # 3. Data quality checks on a sample (up to 500 rows)
    sample = rows[:500]
    n = len(sample)

    bad_latency, bad_status, bad_timestamp = 0, 0, 0
    empty_source, empty_target = 0, 0

    for row in sample:
        # latency_ms — numeric, ≥ 0
        try:
            lat = float(row.get('latency_ms', '').strip())
            if lat < 0:
                bad_latency += 1
        except (ValueError, AttributeError):
            bad_latency += 1

        # status_code — integer 100–999
        try:
            sc = int(float(row.get('status_code', '').strip()))
            if sc < 100 or sc > 999:
                bad_status += 1
        except (ValueError, AttributeError):
            bad_status += 1

        # timestamp — must look like a date
        ts = row.get('timestamp', '').strip()
        if not ts or not DATE_PATTERN.match(ts):
            bad_timestamp += 1

        # source/target non-empty
        if not row.get('source_service', '').strip():
            empty_source += 1
        if not row.get('target_service', '').strip():
            empty_target += 1

    threshold = n * 0.5
    if bad_latency > threshold:
        details.append(
            f"latency_ms: {bad_latency}/{n} sampled rows are not valid numbers ≥ 0  "
            f"(e.g. found \"{sample[0].get('latency_ms', '?')}\")"
        )
    if bad_status > threshold:
        details.append(
            f"status_code: {bad_status}/{n} sampled rows are not valid HTTP codes (100–999)  "
            f"(e.g. found \"{sample[0].get('status_code', '?')}\")"
        )
    if bad_timestamp > threshold:
        details.append(
            f"timestamp: {bad_timestamp}/{n} sampled rows don't look like dates  "
            f"(expected ISO 8601, e.g. 2024-11-01T05:00:00Z)"
        )
    if empty_source > threshold:
        details.append(f"source_service: {empty_source}/{n} sampled rows are empty.")
    if empty_target > threshold:
        details.append(f"target_service: {empty_target}/{n} sampled rows are empty.")

    if details:
        return {"valid": False, "error": "Data quality issues found in your file.", "details": details, "warnings": warnings}

    # 4. Need at least 2 distinct services to build a topology
    sources = {r.get('source_service', '').strip() for r in sample if r.get('source_service', '').strip()}
    targets = {r.get('target_service', '').strip() for r in sample if r.get('target_service', '').strip()}
    all_services = sources | targets
    if len(all_services) < 2:
        return {
            "valid": False,
            "error": f"Only {len(all_services)} unique service(s) found. Need at least 2 to build a service topology.",
            "details": [f"Services found: {', '.join(all_services) or '(none)'}"],
            "warnings": warnings,
        }

    return {"valid": True, "error": None, "details": [], "warnings": warnings, "row_count": len(rows)}


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/health")
def health():
    return jsonify({
        "status": "healthy",
        "trained": state["trained"],
        "log_rows": len(state["rows"]),
        "features_available": state["features"],
    })


@app.post("/analyze")
def analyze():
    """
    Body (JSON):
      {
        "log_content": "...",          # raw log string (optional)
        "log_path": "/path/to/file",   # or file path
        "adapter_config": { ... }      # optional, defaults to canonical CSV
      }
    If neither provided, uses the default BBD sample logs.
    """
    try:
        body = request.get_json(silent=True) or {}
        adapter_config = body.get("adapter_config", DEFAULT_ADAPTER_CONFIG)
        log_content = body.get("log_content")
        log_path = body.get("log_path")

        if log_content:
            rows = normalize(log_content, adapter_config)
        elif log_path and os.path.exists(log_path):
            rows = normalize_file(log_path, adapter_config)
        else:
            # Default: use sample BBD logs
            rows = normalize_file(DEFAULT_LOG_PATH, DEFAULT_ADAPTER_CONFIG)

        if not rows:
            return jsonify({"error": "No valid log rows after normalization"}), 400

        services_json = _apply_analysis(rows)

        # Write updated services.json to disk so simulation engine picks it up
        try:
            with open(SERVICES_JSON_PATH, "w") as f:
                json.dump(services_json, f, indent=2)
        except Exception:
            pass  # Don't fail if path not writable

        return jsonify({
            "success": True,
            "rows_analyzed": len(rows),
            "services_discovered": len(services_json["nodes"]),
            "edges_discovered": len(services_json["edges"]),
            "features_available": state["features"],
            "services_json": services_json,
        })

    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


@app.post("/upload-logs")
def upload_logs():
    """
    Accepts a CSV file upload via multipart/form-data.
    Validates the file, then trains all 4 ML models on it.
    """
    if 'file' not in request.files:
        return jsonify({"error": "No file provided. Send a multipart/form-data request with field 'file'."}), 400

    file = request.files['file']
    if not file or file.filename == '':
        return jsonify({"error": "No file selected."}), 400

    # Extension check
    fname = file.filename.lower()
    if not fname.endswith('.csv'):
        return jsonify({
            "error": f"File must be a .csv file (received: {file.filename}).",
            "details": [],
        }), 400

    # Read content
    try:
        content = file.read().decode('utf-8')
    except UnicodeDecodeError:
        return jsonify({
            "error": "File encoding error. Save your file as UTF-8 CSV and try again.",
            "details": [],
        }), 400

    # Validate
    validation = _validate_csv(content)
    if not validation["valid"]:
        return jsonify({
            "error": validation["error"],
            "details": validation.get("details", []),
        }), 400

    # Normalize & train
    try:
        rows = normalize(content, DEFAULT_ADAPTER_CONFIG)
        if not rows:
            return jsonify({"error": "No rows could be normalized after parsing. Check column values."}), 400

        services_json = _apply_analysis(rows)

        try:
            with open(SERVICES_JSON_PATH, "w") as f:
                json.dump(services_json, f, indent=2)
        except Exception:
            pass

        return jsonify({
            "success": True,
            "rows_analyzed": len(rows),
            "services_discovered": len(services_json["nodes"]),
            "edges_discovered": len(services_json["edges"]),
            "features_available": state["features"],
            "warnings": validation.get("warnings", []),
        })
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


@app.post("/predict/load")
def predict_load():
    """
    Body: { "concurrent_users": 1000 }
    Returns predicted health state for all services at that load.
    """
    if not state["trained"]:
        return jsonify({"error": "Models not trained yet. Call POST /analyze first."}), 400

    body = request.get_json(silent=True) or {}
    concurrent = int(body.get("concurrent_users", 500))
    concurrent = max(1, min(concurrent, 5000))

    predictions = state["load_model"].predict_all_services(concurrent, KENDRA_SERVICES)

    # Build summary
    failed = [s for s, p in predictions.items() if p["health"] == "failed"]
    degraded = [s for s, p in predictions.items() if p["health"] == "degraded"]
    healthy = [s for s, p in predictions.items() if p["health"] == "healthy"]

    return jsonify({
        "concurrent_users": concurrent,
        "predictions": predictions,
        "summary": {
            "healthy": healthy,
            "degraded": degraded,
            "failed": failed,
            "overall_status": "critical" if len(failed) >= 2 else
                              "degraded" if (failed or len(degraded) >= 2) else "healthy",
        },
    })


@app.post("/predict/cascade")
def predict_cascade():
    """
    Body: { "serviceId": "database-service", "fault": { "type": "FAILURE" } }
    Returns cascade probability to downstream services.
    """
    if not state["trained"]:
        return jsonify({"error": "Models not trained yet. Call POST /analyze first."}), 400

    body = request.get_json(silent=True) or {}
    service_id = body.get("serviceId", "")
    fault = body.get("fault", {})

    cascades = state["cascade_model"].predict_cascade(service_id)

    # For LATENCY faults, reduce probabilities proportionally
    if fault.get("type") == "LATENCY":
        delay = fault.get("delay", 0)
        factor = min(1.0, delay / 3000)
        cascades = [
            {**c, "probability": round(c["probability"] * factor, 3)}
            for c in cascades
        ]
        cascades = [c for c in cascades if c["probability"] >= 0.05]

    return jsonify({
        "serviceId": service_id,
        "fault": fault,
        "cascade_predictions": cascades,
        "summary": {
            "services_at_risk": len(cascades),
            "highest_risk": cascades[0] if cascades else None,
        },
    })


@app.get("/insights")
def insights():
    """Returns risk scores, saturation points, anomaly periods, retry amplification."""
    if not state["trained"]:
        return jsonify({"error": "Models not trained yet. Call POST /analyze first."}), 400

    # Score a sample of rows for anomaly periods (for performance)
    sample = state["rows"][::5]  # every 5th row
    scored = state["anomaly_detector"].score_rows(sample)
    anomaly_periods = state["anomaly_detector"].get_anomaly_periods(scored)

    saturation_info = state["saturation_model"].get_saturation_info()

    return jsonify({
        "risk_scores": state["risk_scores"],
        "saturation_points": saturation_info,
        "anomaly_periods": anomaly_periods[:10],  # top 10 periods
        "retry_amplification": state["retry_info"],
        "features_available": state["features"],
        "log_summary": {
            "total_rows": len(state["rows"]),
            "services": list({r["target_service"] for r in state["rows"]}),
        },
    })


@app.post("/normalize")
def normalize_demo():
    """
    Demo endpoint for the adapter pattern.
    Body: { "log_content": "...", "adapter_config": { ... } }
    Returns normalized rows (first 10) for display.
    """
    try:
        body = request.get_json(silent=True) or {}
        content = body.get("log_content", "")
        config = body.get("adapter_config", DEFAULT_ADAPTER_CONFIG)

        if not content:
            return jsonify({"error": "log_content is required"}), 400

        rows = normalize(content, config)
        features = get_available_features(rows)

        return jsonify({
            "success": True,
            "total_rows": len(rows),
            "sample_rows": rows[:10],
            "features_available": features,
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.post("/generate-sample-logs")
def generate_sample():
    """Regenerate the synthetic BBD logs."""
    try:
        os.makedirs(SAMPLE_LOGS_DIR, exist_ok=True)
        count = generate_logs(DEFAULT_LOG_PATH)
        # Re-train after generation
        rows = normalize_file(DEFAULT_LOG_PATH, DEFAULT_ADAPTER_CONFIG)
        _apply_analysis(rows)
        return jsonify({"success": True, "rows_generated": count, "rows_analyzed": len(rows)})
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


# ---------------------------------------------------------------------------
# Startup
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    # Generate logs if they don't exist
    os.makedirs(SAMPLE_LOGS_DIR, exist_ok=True)
    if not os.path.exists(DEFAULT_LOG_PATH):
        print("📊 Generating synthetic BBD logs...")
        generate_logs(DEFAULT_LOG_PATH)

    _auto_initialize()

    port = int(os.environ.get("PORT", 5001))
    print(f"🤖 Kendra ML Service running on port {port}")
    app.run(host="0.0.0.0", port=port, debug=False)
