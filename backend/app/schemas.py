from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel


class PricePoint(BaseModel):
    timestamp: datetime
    price_eur_mwh: float


class PriceSeriesResponse(BaseModel):
    country_code: str
    start: Optional[datetime]
    end: Optional[datetime]
    points: List[PricePoint]


class AnalysisRequest(BaseModel):
    country_code: str
    start: Optional[datetime]
    end: Optional[datetime]
    points: List[PricePoint]
    question: Optional[str] = None


class AnalysisResponse(BaseModel):
    summary: str
    used_mock: bool


class GenerationPoint(BaseModel):
    timestamp: datetime
    value_mw: float


class GenerationSeries(BaseModel):
    fuel_type: str
    points: List[GenerationPoint]


class GenerationMixResponse(BaseModel):
    country_code: str
    start: Optional[datetime]
    end: Optional[datetime]
    series: List[GenerationSeries]
