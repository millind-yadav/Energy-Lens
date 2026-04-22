from sqlalchemy import Column, DateTime, Float, Index, Integer, String, UniqueConstraint

from .db import Base


class PriceRecord(Base):
    __tablename__ = "price_records"
    __table_args__ = (
        UniqueConstraint("country_code", "timestamp", name="uq_price_country_time"),
    )

    id = Column(Integer, primary_key=True, index=True)
    country_code = Column(String(2), index=True, nullable=False)
    timestamp = Column(DateTime, index=True, nullable=False)
    price_eur_mwh = Column(Float, nullable=False)


Index("ix_price_records_country_time", PriceRecord.country_code, PriceRecord.timestamp)


class GenerationRecord(Base):
    __tablename__ = "generation_records"
    __table_args__ = (
        UniqueConstraint(
            "country_code", "timestamp", "fuel_type", name="uq_gen_country_time"
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    country_code = Column(String(2), index=True, nullable=False)
    timestamp = Column(DateTime, index=True, nullable=False)
    fuel_type = Column(String(64), index=True, nullable=False)
    value_mw = Column(Float, nullable=False)


Index(
    "ix_generation_records_country_time",
    GenerationRecord.country_code,
    GenerationRecord.timestamp,
)
