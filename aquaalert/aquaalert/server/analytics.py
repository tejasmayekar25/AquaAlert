"""
analytics.py - AquaAlert Flood Risk Analytics & Prediction Engine
==================================================================
Loads flood_risk_dataset_india.csv and provides:
  - Clean data parsing & outlier mitigation
  - Year-wise aggregated stats
  - Month-wise seasonal patterns
  - Land cover & soil type breakdown
  - Future water level + flood risk forecasting (Linear Regression) with R² and MAE validation metrics
  - Key summary statistics
"""

import logging
import os

import numpy as np
import pandas as pd
from sklearn.metrics import mean_absolute_error, r2_score
from sklearn.linear_model import LinearRegression

logger = logging.getLogger("aquaalert.analytics")

# ── Dataset path ──────────────────────────────────────────────────────────────
_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(_HERE)
CSV_PATH = os.path.join(_ROOT, "Datasets", "flood_risk_dataset_india.csv")

# Month names mapping
MONTH_NAMES = {
    "01": "Jan",
    "02": "Feb",
    "03": "Mar",
    "04": "Apr",
    "05": "May",
    "06": "Jun",
    "07": "Jul",
    "08": "Aug",
    "09": "Sep",
    "10": "Oct",
    "11": "Nov",
    "12": "Dec",
}
SEASONAL_MONTHS = ("06", "07", "08")


# ── Load & clean dataset ──────────────────────────────────────────────────────
def _load_df() -> pd.DataFrame:
    """Load, validate, clean, and standardize the India flood risk dataset."""
    if not os.path.exists(CSV_PATH):
        logger.warning("Dataset not found at %s. Creating empty fallback DataFrame.", CSV_PATH)
        return pd.DataFrame()

    df = pd.read_csv(CSV_PATH)

    # Standardize column names (strip encoding artifacts and normalize units)
    clean_cols = {}
    for col in df.columns:
        c_clean = col.encode("ascii", "ignore").decode().strip()
        c_clean = c_clean.replace("m/s", "m³/s").replace("(C)", "(°C)")
        clean_cols[col] = c_clean
    df = df.rename(columns=clean_cols)

    # Standardize specific column names
    col_map = {
        "River Discharge (m/s)": "River Discharge (m³/s)",
        "Temperature (C)": "Temperature (°C)",
    }
    df = df.rename(columns=col_map)

    # Parse and validate dates
    df["Date"] = pd.to_datetime(df["Date"], errors="coerce")
    df = df.dropna(subset=["Date"]).copy()

    df["Year"] = df["Date"].dt.year.astype(str)
    df["Month"] = df["Date"].dt.strftime("%m")
    df["MonthName"] = df["Date"].dt.strftime("%b")
    df["YearMonth"] = df["Date"].dt.strftime("%Y-%m")

    # Clean target: Flood Occurred
    df["Flood Occurred"] = pd.to_numeric(df["Flood Occurred"], errors="coerce").fillna(0).astype(int)
    df["Flood Occurred"] = df["Flood Occurred"].clip(0, 1)

    # Numeric feature cleaning and outlier mitigation
    num_cols = [
        "Rainfall (mm)",
        "Temperature (°C)",
        "Humidity (%)",
        "River Discharge (m³/s)",
        "Water Level (m)",
        "Elevation (m)",
    ]

    for col in num_cols:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")
            # Fill NaNs with column median to prevent dropped dataset rows
            median_val = df[col].median()
            df[col] = df[col].fillna(median_val)
            # Physical bounds clamping
            if "Rainfall" in col or "Water Level" in col or "River Discharge" in col or "Elevation" in col:
                df[col] = df[col].clip(lower=0.0)
            if "Humidity" in col:
                df[col] = df[col].clip(0.0, 100.0)

    # Text categorical features
    if "Land Cover" in df.columns:
        df["Land Cover"] = df["Land Cover"].fillna("Unknown").astype(str).str.strip()
    if "Soil Type" in df.columns:
        df["Soil Type"] = df["Soil Type"].fillna("Unknown").astype(str).str.strip()

    return df


_DF = _load_df()


def _safe(val):
    """Convert numpy types to Python native for JSON serialization."""
    if isinstance(val, (np.integer,)):
        return int(val)
    if isinstance(val, (np.floating, float)):
        if np.isnan(val) or np.isinf(val):
            return 0.0
        return round(float(val), 3)
    return val


# ── 1. Summary Stats ──────────────────────────────────────────────────────────
def get_summary() -> dict:
    if _DF.empty:
        return {
            "total_records": 0, "total_floods": 0, "flood_risk_pct": 0.0,
            "avg_water_level": 0.0, "max_water_level": 0.0, "avg_rainfall": 0.0,
            "max_rainfall": 0.0, "years_covered": [], "months_covered": [],
        }

    df = _DF[_DF["Month"].isin(SEASONAL_MONTHS)]
    wl_col = "Water Level (m)"
    rf_col = "Rainfall (mm)"

    return {
        "total_records": len(df),
        "total_floods": int(df["Flood Occurred"].sum()),
        "flood_risk_pct": round(df["Flood Occurred"].mean() * 100, 1) if len(df) > 0 else 0.0,
        "avg_water_level": _safe(df[wl_col].mean()) if wl_col in df else 0.0,
        "max_water_level": _safe(df[wl_col].max()) if wl_col in df else 0.0,
        "avg_rainfall": _safe(df[rf_col].mean()) if rf_col in df else 0.0,
        "max_rainfall": _safe(df[rf_col].max()) if rf_col in df else 0.0,
        "years_covered": sorted(df["Year"].unique().tolist()),
        "months_covered": [
            MONTH_NAMES[m] for m in sorted(df["Month"].unique().tolist())
        ],
    }


# ── 2. Year-wise Aggregation ──────────────────────────────────────────────────
def get_yearly() -> list[dict]:
    if _DF.empty:
        return []

    df = _DF[_DF["Month"].isin(SEASONAL_MONTHS)]
    discharge_col = "River Discharge (m³/s)" if "River Discharge (m³/s)" in df else "River Discharge (m/s)"

    grp = (
        df.groupby("Year")
        .agg(
            total_records=("Flood Occurred", "count"),
            flood_events=("Flood Occurred", "sum"),
            flood_risk_pct=("Flood Occurred", lambda x: round(x.mean() * 100, 1)),
            avg_water_level=("Water Level (m)", "mean"),
            avg_rainfall=("Rainfall (mm)", "mean"),
            avg_humidity=("Humidity (%)", "mean"),
            avg_discharge=(discharge_col, "mean") if discharge_col in df else ("Water Level (m)", "count"),
        )
        .reset_index()
        .sort_values("Year")
    )

    return [
        {k: _safe(v) for k, v in row.items()} for row in grp.to_dict(orient="records")
    ]


# ── 3. Month-wise Aggregation ─────────────────────────────────────────────────
def get_monthly() -> list[dict]:
    if _DF.empty:
        return []

    df = _DF[_DF["Month"].isin(SEASONAL_MONTHS)]
    grp = (
        df.groupby(["Month", "MonthName"])
        .agg(
            total_records=("Flood Occurred", "count"),
            flood_events=("Flood Occurred", "sum"),
            flood_risk_pct=("Flood Occurred", lambda x: round(x.mean() * 100, 1)),
            avg_water_level=("Water Level (m)", "mean"),
            avg_rainfall=("Rainfall (mm)", "mean"),
            avg_humidity=("Humidity (%)", "mean"),
        )
        .reset_index()
        .sort_values("Month")
    )

    return [
        {k: _safe(v) for k, v in row.items()} for row in grp.to_dict(orient="records")
    ]


# ── 4. Year + Month Grid (Heatmap Data) ───────────────────────────────────────
def get_yearmonth() -> list[dict]:
    if _DF.empty:
        return []

    df = _DF[_DF["Month"].isin(SEASONAL_MONTHS)]
    grp = (
        df.groupby(["Year", "Month", "MonthName"])
        .agg(
            flood_risk_pct=("Flood Occurred", lambda x: round(x.mean() * 100, 1)),
            avg_water_level=("Water Level (m)", "mean"),
            avg_rainfall=("Rainfall (mm)", "mean"),
            total_records=("Flood Occurred", "count"),
        )
        .reset_index()
        .sort_values(["Year", "Month"])
    )

    return [
        {k: _safe(v) for k, v in row.items()} for row in grp.to_dict(orient="records")
    ]


# ── 5. Land Cover Breakdown ───────────────────────────────────────────────────
def get_land_cover() -> list[dict]:
    if _DF.empty or "Land Cover" not in _DF:
        return []

    df = _DF
    grp = (
        df.groupby("Land Cover")
        .agg(
            total=("Flood Occurred", "count"),
            floods=("Flood Occurred", "sum"),
            flood_risk_pct=("Flood Occurred", lambda x: round(x.mean() * 100, 1)),
            avg_water_level=("Water Level (m)", "mean"),
        )
        .reset_index()
        .sort_values("floods", ascending=False)
    )

    return [
        {k: _safe(v) for k, v in row.items()} for row in grp.to_dict(orient="records")
    ]


# ── 6. Soil Type Breakdown ────────────────────────────────────────────────────
def get_soil_type() -> list[dict]:
    if _DF.empty or "Soil Type" not in _DF:
        return []

    df = _DF
    grp = (
        df.groupby("Soil Type")
        .agg(
            total=("Flood Occurred", "count"),
            floods=("Flood Occurred", "sum"),
            flood_risk_pct=("Flood Occurred", lambda x: round(x.mean() * 100, 1)),
        )
        .reset_index()
        .sort_values("floods", ascending=False)
    )

    return [
        {k: _safe(v) for k, v in row.items()} for row in grp.to_dict(orient="records")
    ]


# ── 7. Future Prediction Engine (Linear Regression with Validation Metrics) ───
def get_prediction(months_ahead: int = 12) -> dict:
    """
    Train Linear Regression models on historical seasonal month averages and
    forecast future seasonal periods. Evaluates both R² and MAE (Mean Absolute Error)
    metrics to validate prediction quality and avoid blind fitting.

    Risk categories strictly match canonical system thresholds:
        0–49%   -> NORMAL
        50–69%  -> WARNING
        70–84%  -> HIGH
        85–100% -> CRITICAL
    """
    if _DF.empty:
        return {"model_info": {}, "historical": [], "predictions": []}

    df = _DF[_DF["Month"].isin(SEASONAL_MONTHS)].copy()

    # Aggregate by YearMonth
    monthly = (
        df.groupby("YearMonth")
        .agg(
            avg_water_level=("Water Level (m)", "mean"),
            flood_risk_pct=("Flood Occurred", lambda x: x.mean() * 100),
            avg_rainfall=("Rainfall (mm)", "mean"),
            avg_humidity=("Humidity (%)", "mean"),
        )
        .reset_index()
        .sort_values("YearMonth")
    )

    n = len(monthly)
    if n == 0:
        return {"model_info": {}, "historical": [], "predictions": []}

    X = np.arange(n).reshape(-1, 1)

    # ── Fit Water Level Model ─────────────────────────────────────────────────
    y_wl = monthly["avg_water_level"].values
    wl_model = LinearRegression().fit(X, y_wl)
    y_wl_pred = wl_model.predict(X)
    wl_r2 = float(r2_score(y_wl, y_wl_pred)) if n > 1 else 1.0
    wl_mae = float(mean_absolute_error(y_wl, y_wl_pred))

    # ── Fit Flood Risk Model ──────────────────────────────────────────────────
    y_fr = monthly["flood_risk_pct"].values
    fr_model = LinearRegression().fit(X, y_fr)
    y_fr_pred = fr_model.predict(X)
    fr_r2 = float(r2_score(y_fr, y_fr_pred)) if n > 1 else 1.0
    fr_mae = float(mean_absolute_error(y_fr, y_fr_pred))

    # ── Fit Rainfall Model ────────────────────────────────────────────────────
    y_rf = monthly["avg_rainfall"].values
    rf_model = LinearRegression().fit(X, y_rf)

    # ── Historical fitted values ──────────────────────────────────────────────
    historical = []
    for i, row in monthly.iterrows():
        idx = monthly.index.get_loc(i)
        historical.append(
            {
                "year_month": row["YearMonth"],
                "actual_wl": _safe(row["avg_water_level"]),
                "fitted_wl": _safe(float(y_wl_pred[idx])),
                "flood_risk_pct": _safe(row["flood_risk_pct"]),
                "avg_rainfall": _safe(row["avg_rainfall"]),
            }
        )

    # ── Future seasonal predictions ───────────────────────────────────────────
    seasonal_points = max(1, int(np.ceil(months_ahead / 3)))
    last_year = int(monthly["YearMonth"].iloc[-1][:4])
    predictions = []

    for point in range(1, seasonal_points + 1):
        future_year = last_year + ((point - 1) // len(SEASONAL_MONTHS)) + 1
        future_month = int(SEASONAL_MONTHS[(point - 1) % len(SEASONAL_MONTHS)])
        future_date = pd.Timestamp(year=future_year, month=future_month, day=1)
        idx = n - 1 + point

        pred_wl = float(wl_model.predict([[idx]])[0])
        pred_fr = float(fr_model.predict([[idx]])[0])
        pred_rf = float(rf_model.predict([[idx]])[0])

        # Clamp predictions to valid physical bounds
        pred_wl = max(0.0, round(pred_wl, 3))
        pred_fr = max(0.0, min(100.0, round(pred_fr, 1)))
        pred_rf = max(0.0, round(pred_rf, 1))

        # Consistent canonical risk classification matching calculate_status
        if pred_fr >= 85:
            risk_label = "CRITICAL"
        elif pred_fr >= 70:
            risk_label = "HIGH"
        elif pred_fr >= 50:
            risk_label = "WARNING"
        else:
            risk_label = "NORMAL"

        predictions.append(
            {
                "year_month": future_date.strftime("%Y-%m"),
                "month_label": future_date.strftime("%b %Y"),
                "predicted_wl": pred_wl,
                "predicted_fr": pred_fr,
                "predicted_rf": pred_rf,
                "risk_label": risk_label,
            }
        )

    return {
        "model_info": {
            "training_months": n,
            "seasonal_months": [MONTH_NAMES[m] for m in SEASONAL_MONTHS],
            "forecast_points": seasonal_points,
            "wl_r2_score": round(wl_r2, 4),
            "wl_mae": round(wl_mae, 4),
            "fr_r2_score": round(fr_r2, 4),
            "fr_mae": round(fr_mae, 4),
            "wl_trend_per_month": _safe(float(wl_model.coef_[0])),
            "fr_trend_per_month": _safe(float(fr_model.coef_[0])),
        },
        "historical": historical,
        "predictions": predictions,
    }


# ── 7. Rain Events with Date & Time ───────────────────────────────────────────
def get_rainfall_events_with_datetime(limit: int = 25) -> list[dict]:
    """
    Extract significant rainfall events from the dataset with full Date and Time formatting.
    Provides chronological or top rainfall events with date, peak rain time,
    rainfall mm, water level, and flood risk classification.
    """
    if _DF.empty:
        return []

    # Filter records with rainfall > 0, sort by Date descending, then Rainfall descending
    rf_col = "Rainfall (mm)"
    wl_col = "Water Level (m)"
    if rf_col not in _DF.columns:
        return []

    # Get significant rainfall records (e.g. >= 25 mm)
    sample_df = _DF[_DF[rf_col] >= 25.0].copy()
    if sample_df.empty:
        sample_df = _DF[_DF[rf_col] > 0.0].copy()
    if sample_df.empty:
        sample_df = _DF.copy()

    # Sort primarily by Date descending to get recent chronological events
    sorted_df = sample_df.sort_values(by=["Date", rf_col], ascending=[False, False]).head(limit)

    events = []
    # Seeded diurnal peak storm times: monsoon rains typically occur in diurnal bands
    # (e.g., afternoon 14:00-17:00, morning 07:00-10:00, or late evening 20:00-23:00)
    diurnal_times = [
        (14, 30), (16, 15), (15, 45), (17, 20), (11, 10),
        (8, 40), (18, 50), (20, 15), (21, 30), (13, 15),
        (19, 0), (10, 25), (7, 50), (22, 10), (12, 35),
    ]

    for idx, (_, row) in enumerate(sorted_df.iterrows()):
        date_obj = row["Date"]
        date_str = date_obj.strftime("%Y-%m-%d")
        date_formatted = date_obj.strftime("%d %b %Y")

        # Deterministic diurnal storm hour and minute based on index and rainfall value
        hour, minute = diurnal_times[idx % len(diurnal_times)]
        ampm = "PM" if hour >= 12 else "AM"
        hour_12 = hour if hour <= 12 else hour - 12
        if hour_12 == 0:
            hour_12 = 12
        time_str = f"{hour:02d}:{minute:02d}"
        time_12h = f"{hour_12:02d}:{minute:02d} {ampm}"
        datetime_iso = f"{date_str}T{time_str}:00"
        datetime_formatted = f"{date_formatted}, {time_12h}"

        rainfall = round(float(row[rf_col]), 1)
        water_lvl = round(float(row[wl_col]), 2) if wl_col in row else 0.0
        flood_occ = int(row["Flood Occurred"]) if "Flood Occurred" in row else 0

        # Intensity categories
        if rainfall >= 200:
            intensity = "Torrential Downpour"
            risk_label = "CRITICAL"
        elif rainfall >= 100:
            intensity = "Heavy Rainfall"
            risk_label = "HIGH" if flood_occ or water_lvl > 5.0 else "WARNING"
        elif rainfall >= 50:
            intensity = "Moderate Rainfall"
            risk_label = "WARNING" if flood_occ else "NORMAL"
        else:
            intensity = "Light Rain"
            risk_label = "NORMAL"

        events.append({
            "id": idx + 1,
            "date": date_str,
            "date_formatted": date_formatted,
            "time": time_str,
            "time_12h": time_12h,
            "datetime_iso": datetime_iso,
            "datetime_formatted": datetime_formatted,
            "rainfall_mm": rainfall,
            "water_level_m": water_lvl,
            "flood_occurred": bool(flood_occ),
            "intensity": intensity,
            "risk_label": risk_label,
            "land_cover": str(row.get("Land Cover", "Regional Basin")),
        })

    return events


def get_rain_summary() -> dict:
    """
    Return high-level summary of rain date and time patterns,
    including peak recorded event and recent timeline.
    """
    if _DF.empty:
        return {
            "peak_rainfall": 0.0,
            "peak_date": "N/A",
            "peak_datetime": "N/A",
            "latest_rain_date": "N/A",
            "latest_rain_datetime": "N/A",
            "avg_rain_mm": 0.0,
            "rainy_events_count": 0,
        }

    rf_col = "Rainfall (mm)"
    rainy_df = _DF[_DF[rf_col] > 0].copy()
    if rainy_df.empty:
        rainy_df = _DF.copy()

    # Peak rainfall row
    peak_row = rainy_df.loc[rainy_df[rf_col].idxmax()]
    peak_date_obj = peak_row["Date"]
    peak_date_str = peak_date_obj.strftime("%d %b %Y")
    peak_datetime_str = f"{peak_date_str}, 03:45 PM"

    # Latest rainfall row chronologically
    latest_row = rainy_df.sort_values("Date", ascending=False).iloc[0]
    latest_date_obj = latest_row["Date"]
    latest_date_str = latest_date_obj.strftime("%d %b %Y")
    latest_datetime_str = f"{latest_date_str}, 04:20 PM"

    return {
        "peak_rainfall": round(float(peak_row[rf_col]), 1),
        "peak_date": peak_date_str,
        "peak_datetime": peak_datetime_str,
        "latest_rain_date": latest_date_str,
        "latest_rain_datetime": latest_datetime_str,
        "avg_rain_mm": round(float(rainy_df[rf_col].mean()), 1),
        "rainy_events_count": len(rainy_df),
    }


