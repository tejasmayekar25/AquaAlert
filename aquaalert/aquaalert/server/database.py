"""
database.py - SQLite Database Module for AquaAlert
====================================================
Handles all database operations:
  - Thread-safe connection management with WAL (Write-Ahead Logging) mode
  - Creation of readings table and performance indices
  - Parameterized insertion of sensor readings
  - Safe querying of latest and historical readings

Database file: aquaalert.db
"""

import logging
import os
import sqlite3

logger = logging.getLogger("aquaalert.database")

# ── Path: store aquaalert.db next to this script ─────────────────────────────
_HERE = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(_HERE, "aquaalert.db")

# ── SQL: Create table & indices if not exist ─────────────────────────────────
_CREATE_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS readings (
    id          INTEGER  PRIMARY KEY AUTOINCREMENT,
    device_id   TEXT     NOT NULL,
    distance    REAL     NOT NULL,
    water_level REAL     NOT NULL,
    percentage  INTEGER  NOT NULL,
    status      TEXT     NOT NULL,
    rainfall    REAL     DEFAULT 0.0,
    timestamp   DATETIME DEFAULT CURRENT_TIMESTAMP
);
"""

_CREATE_INDICES_SQL = """
CREATE INDEX IF NOT EXISTS idx_readings_id_desc ON readings(id DESC);
CREATE INDEX IF NOT EXISTS idx_readings_device_id ON readings(device_id);
"""


def _connect() -> sqlite3.Connection:
    """Return a new SQLite connection with timeout and dict-like row access."""
    conn = sqlite3.connect(DB_PATH, timeout=10.0, check_same_thread=False)
    conn.row_factory = sqlite3.Row  # rows accessible by column name
    # Ensure WAL mode and busy timeout on every connection
    conn.execute("PRAGMA busy_timeout = 5000;")
    return conn


def init_db() -> None:
    """
    Create the database file, readings table, and indices if they don't exist.
    Enables WAL mode for concurrent reading/writing without database locked errors.
    """
    with _connect() as conn:
        conn.execute("PRAGMA journal_mode = WAL;")
        conn.execute("PRAGMA synchronous = NORMAL;")
        conn.execute(_CREATE_TABLE_SQL)
        # Check and migrate table if rainfall column is missing
        columns = [row["name"] for row in conn.execute("PRAGMA table_info(readings);").fetchall()]
        if "rainfall" not in columns:
            try:
                conn.execute("ALTER TABLE readings ADD COLUMN rainfall REAL DEFAULT 0.0;")
            except sqlite3.OperationalError:
                pass
        for statement in _CREATE_INDICES_SQL.strip().split(";"):
            if statement.strip():
                conn.execute(statement.strip())
        conn.commit()
    logger.info("Database initialized with WAL mode at: %s", DB_PATH)


def insert_reading(
    device_id: str,
    distance: float,
    water_level: float,
    percentage: int,
    status: str,
    rainfall: float = 0.0,
) -> int:
    """
    Insert one sensor reading into the database using parameterized query.

    Parameters:
        device_id   : ESP32 device identifier (e.g. "AQUA-001")
        distance    : raw ultrasonic distance in cm
        water_level : calculated water depth in cm
        percentage  : water level as integer 0-100
        status      : NORMAL / WARNING / HIGH / CRITICAL
        rainfall    : recorded rainfall in mm (optional, default 0.0)

    Returns:
        Auto-assigned row id (integer)
    """
    sql = """
        INSERT INTO readings (device_id, distance, water_level, percentage, status, rainfall)
        VALUES (?, ?, ?, ?, ?, ?)
    """
    with _connect() as conn:
        cur = conn.execute(
            sql, (device_id, distance, water_level, percentage, status, float(rainfall or 0.0))
        )
        conn.commit()
        return int(cur.lastrowid)


def _row_to_dict(row: sqlite3.Row | None) -> dict | None:
    """Convert sqlite3.Row to plain dict with rainfall defaulted, or return None."""
    if row is None:
        return None
    d = dict(row)
    if "rainfall" not in d or d["rainfall"] is None:
        d["rainfall"] = 0.0
    return d


def get_latest_rain_event() -> dict | None:
    """Return the most recent reading where rainfall > 0, or latest reading."""
    sql = "SELECT * FROM readings WHERE rainfall > 0 ORDER BY id DESC LIMIT 1"
    with _connect() as conn:
        row = conn.execute(sql).fetchone()
        if not row:
            row = conn.execute("SELECT * FROM readings ORDER BY id DESC LIMIT 1").fetchone()
        return _row_to_dict(row)


def get_recent_rain_events(limit: int = 20) -> list[dict]:
    """Return recent readings with rainfall data, newest first."""
    sql = "SELECT * FROM readings WHERE rainfall > 0 ORDER BY id DESC LIMIT ?"
    with _connect() as conn:
        rows = conn.execute(sql, (limit,)).fetchall()
        if not rows or len(rows) < 3:
            # Fallback: include recent general readings so the table always has data
            rows = conn.execute("SELECT * FROM readings ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
        return [_row_to_dict(r) for r in rows if r is not None]


def get_latest_reading() -> dict | None:
    """
    Return the most recent reading as a dict.
    Returns None if the table is empty.
    """
    sql = "SELECT * FROM readings ORDER BY id DESC LIMIT 1"
    with _connect() as conn:
        row = conn.execute(sql).fetchone()
        return _row_to_dict(row)


def get_history(limit: int = 50) -> list[dict]:
    """
    Return the last `limit` readings, newest first.
    Used for the /api/history endpoint.
    """
    sql = "SELECT * FROM readings ORDER BY id DESC LIMIT ?"
    with _connect() as conn:
        rows = conn.execute(sql, (limit,)).fetchall()
        return [_row_to_dict(r) for r in rows if r is not None]


def get_history_asc(limit: int = 50) -> list[dict]:
    """
    Return the last `limit` readings, oldest first.
    Use this for chart display so the X-axis flows left to right in time.
    """
    sql = """
        SELECT * FROM (
            SELECT * FROM readings ORDER BY id DESC LIMIT ?
        ) ORDER BY id ASC
    """
    with _connect() as conn:
        rows = conn.execute(sql, (limit,)).fetchall()
        return [_row_to_dict(r) for r in rows if r is not None]


def get_sensor_analytics(limit: int = 50) -> dict:
    """
    Calculate summary statistics, status distribution, and chronological history
    over recorded sensor readings.
    Used for the /api/sensor/analytics endpoint.
    """
    with _connect() as conn:
        stats = conn.execute("""
            SELECT 
                COUNT(*) as total_readings,
                MIN(water_level) as min_water_level,
                MAX(water_level) as max_water_level,
                AVG(water_level) as avg_water_level,
                MIN(percentage) as min_percentage,
                MAX(percentage) as max_percentage,
                AVG(percentage) as avg_percentage
            FROM readings
        """).fetchone()

        status_counts = conn.execute("""
            SELECT status, COUNT(*) as count
            FROM readings
            GROUP BY status
        """).fetchall()

        recent = conn.execute("""
            SELECT * FROM (
                SELECT * FROM readings ORDER BY id DESC LIMIT ?
            ) ORDER BY id ASC
        """, (limit,)).fetchall()

        latest = conn.execute("""
            SELECT * FROM readings ORDER BY id DESC LIMIT 1
        """).fetchone()

        total = stats["total_readings"] if stats and stats["total_readings"] else 0
        status_map = {"NORMAL": 0, "WARNING": 0, "HIGH": 0, "CRITICAL": 0}
        for row in status_counts:
            if row["status"] in status_map:
                status_map[row["status"]] = row["count"]

        recent_list = [_row_to_dict(r) for r in recent if r is not None]
        trend = "STABLE"
        delta_level = 0.0
        if len(recent_list) >= 2:
            first = recent_list[0].get("water_level", 0.0)
            last = recent_list[-1].get("water_level", 0.0)
            delta_level = round(last - first, 1)
            if delta_level > 1.0:
                trend = "RISING"
            elif delta_level < -1.0:
                trend = "FALLING"

        return {
            "total_readings": total,
            "min_water_level": round(float(stats["min_water_level"]), 1) if stats and stats["min_water_level"] is not None else 0.0,
            "max_water_level": round(float(stats["max_water_level"]), 1) if stats and stats["max_water_level"] is not None else 0.0,
            "avg_water_level": round(float(stats["avg_water_level"]), 1) if stats and stats["avg_water_level"] is not None else 0.0,
            "min_percentage": int(stats["min_percentage"]) if stats and stats["min_percentage"] is not None else 0,
            "max_percentage": int(stats["max_percentage"]) if stats and stats["max_percentage"] is not None else 0,
            "avg_percentage": round(float(stats["avg_percentage"]), 1) if stats and stats["avg_percentage"] is not None else 0.0,
            "status_breakdown": status_map,
            "trend": trend,
            "delta_level": delta_level,
            "latest": _row_to_dict(latest),
            "history": recent_list,
        }

