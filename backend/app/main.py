from datetime import datetime, timedelta, timezone

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

from .config import settings
from .db import Base, SessionLocal, engine, get_db
from .entsoe import BIDDING_ZONES, fetch_day_ahead_prices, fetch_generation_mix
from .models import GenerationRecord, PriceRecord
from .schemas import (
    AnalysisRequest,
    AnalysisResponse,
    GenerationMixResponse,
    GenerationPoint,
    GenerationSeries,
    PricePoint,
    PriceSeriesResponse,
)

app = FastAPI(title="Energy Lens API")

origins = ["http://localhost:5173"]

COUNTRIES = ["DE", "FR", "NL", "GB"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup() -> None:
    Base.metadata.create_all(bind=engine)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/config")
def config_status():
    return {
        "entsoe_configured": bool(settings.entsoe_api_key),
        "llm_configured": bool(settings.openai_api_key or settings.anthropic_api_key),
    }


@app.get("/countries")
def list_countries():
    return {"countries": COUNTRIES}


@app.get("/prices", response_model=PriceSeriesResponse)
def get_prices(
    country: str = Query(..., min_length=2, max_length=2),
    start: datetime | None = None,
    end: datetime | None = None,
    db: Session = Depends(get_db),
):
    country = country.upper()
    if country not in BIDDING_ZONES:
        raise HTTPException(status_code=400, detail="Unsupported country code")

    end = _ensure_utc(end) if end else datetime.now(timezone.utc)
    start = _ensure_utc(start) if start else end - timedelta(days=7)

    expected = int((end - start).total_seconds() // 3600) + 1
    existing_count = (
        db.query(PriceRecord)
        .filter(PriceRecord.country_code == country)
        .filter(PriceRecord.timestamp >= start)
        .filter(PriceRecord.timestamp <= end)
        .count()
    )

    if existing_count < expected:
        if not settings.entsoe_api_key:
            raise HTTPException(
                status_code=400,
                detail="ENTSOE_API_KEY is missing",
            )
        fetched = fetch_day_ahead_prices(country, start, end, settings.entsoe_api_key)
        _upsert_prices(db, country, fetched)

    query = db.query(PriceRecord).filter(PriceRecord.country_code == country)
    if start is not None:
        query = query.filter(PriceRecord.timestamp >= start)
    if end is not None:
        query = query.filter(PriceRecord.timestamp <= end)

    rows = query.order_by(PriceRecord.timestamp).all()
    points = [
        PricePoint(timestamp=row.timestamp, price_eur_mwh=row.price_eur_mwh)
        for row in rows
    ]

    return {
        "country_code": country,
        "start": start,
        "end": end,
        "points": points,
    }


@app.get("/generation", response_model=GenerationMixResponse)
def get_generation_mix(
    country: str = Query(..., min_length=2, max_length=2),
    start: datetime | None = None,
    end: datetime | None = None,
    db: Session = Depends(get_db),
):
    country = country.upper()
    if country not in BIDDING_ZONES:
        raise HTTPException(status_code=400, detail="Unsupported country code")

    end = _ensure_utc(end) if end else datetime.now(timezone.utc)
    start = _ensure_utc(start) if start else end - timedelta(days=7)

    existing_count = (
        db.query(GenerationRecord)
        .filter(GenerationRecord.country_code == country)
        .filter(GenerationRecord.timestamp >= start)
        .filter(GenerationRecord.timestamp <= end)
        .count()
    )

    if existing_count == 0:
        if not settings.entsoe_api_key:
            raise HTTPException(
                status_code=400,
                detail="ENTSOE_API_KEY is missing",
            )
        fetched = fetch_generation_mix(country, start, end, settings.entsoe_api_key)
        _upsert_generation(db, country, fetched)

    rows = (
        db.query(GenerationRecord)
        .filter(GenerationRecord.country_code == country)
        .filter(GenerationRecord.timestamp >= start)
        .filter(GenerationRecord.timestamp <= end)
        .order_by(GenerationRecord.timestamp)
        .all()
    )

    grouped: dict[str, list[GenerationPoint]] = {}
    for row in rows:
        grouped.setdefault(row.fuel_type, []).append(
            GenerationPoint(timestamp=row.timestamp, value_mw=row.value_mw)
        )

    series = [
        GenerationSeries(fuel_type=fuel_type, points=points)
        for fuel_type, points in sorted(grouped.items())
    ]

    return {
        "country_code": country,
        "start": start,
        "end": end,
        "series": series,
    }


def _upsert_prices(
    db: Session, country_code: str, points: list[tuple[datetime, float]]
) -> None:
    if not points:
        return

    rows = [
        {
            "country_code": country_code,
            "timestamp": timestamp,
            "price_eur_mwh": price,
        }
        for timestamp, price in points
    ]
    statement = sqlite_insert(PriceRecord).values(rows)
    statement = statement.on_conflict_do_nothing(
        index_elements=["country_code", "timestamp"]
    )
    db.execute(statement)
    db.commit()


def _ensure_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _upsert_generation(
    db: Session, country_code: str, points: list[tuple[datetime, str, float]]
) -> None:
    if not points:
        return

    rows = [
        {
            "country_code": country_code,
            "timestamp": timestamp,
            "fuel_type": fuel_type,
            "value_mw": value_mw,
        }
        for timestamp, fuel_type, value_mw in points
    ]

    statement = sqlite_insert(GenerationRecord).values(rows)
    statement = statement.on_conflict_do_nothing(
        index_elements=["country_code", "timestamp", "fuel_type"]
    )
    db.execute(statement)
    db.commit()


@app.post("/analysis", response_model=AnalysisResponse)
def analyze_series(payload: AnalysisRequest):
    points = payload.points
    if not points:
        summary = "No price points provided. Select a date range and try again."
        return {"summary": summary, "used_mock": True}

    max_point = max(points, key=lambda point: point.price_eur_mwh)
    min_point = min(points, key=lambda point: point.price_eur_mwh)
    avg_price = sum(point.price_eur_mwh for point in points) / len(points)

    summary = (
        f"Mock analysis for {payload.country_code}. "
        f"Average price: {avg_price:.2f} EUR/MWh. "
        f"Peak: {max_point.price_eur_mwh:.2f} at {max_point.timestamp.isoformat()}. "
        f"Low: {min_point.price_eur_mwh:.2f} at {min_point.timestamp.isoformat()}. "
        "Connect an LLM key for a real narrative explanation."
    )

    return {"summary": summary, "used_mock": True}
