from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Iterable, List, Tuple
import xml.etree.ElementTree as ET

import httpx

BIDDING_ZONES = {
    "DE": "10Y1001A1001A82H",
    "FR": "10YFR-RTE------C",
    "NL": "10YNL----------L",
    "GB": "10YGB----------A",
}

ENTSOE_URL = "https://web-api.tp.entsoe.eu/api"

PSR_TYPE_LABELS = {
    "B01": "Biomass",
    "B02": "Fossil Brown coal",
    "B03": "Fossil Coal-derived gas",
    "B04": "Fossil Gas",
    "B05": "Fossil Hard coal",
    "B06": "Fossil Oil",
    "B07": "Fossil Oil shale",
    "B08": "Fossil Peat",
    "B09": "Geothermal",
    "B10": "Hydro Pumped Storage",
    "B11": "Hydro Run-of-river",
    "B12": "Hydro Reservoir",
    "B13": "Marine",
    "B14": "Nuclear",
    "B15": "Other renewable",
    "B16": "Solar",
    "B17": "Waste",
    "B18": "Wind Offshore",
    "B19": "Wind Onshore",
    "B20": "Other",
}


def _parse_datetime(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _resolution_to_timedelta(value: str) -> timedelta | None:
    mapping = {
        "PT15M": timedelta(minutes=15),
        "PT30M": timedelta(minutes=30),
        "PT60M": timedelta(hours=1),
    }
    return mapping.get(value)


def _strip_ns(tag: str) -> str:
    if "}" in tag:
        return tag.split("}", 1)[1]
    return tag


def _iter_children(parent: ET.Element, name: str) -> Iterable[ET.Element]:
    return [child for child in parent if _strip_ns(child.tag) == name]


def parse_day_ahead_prices(xml_text: str) -> List[Tuple[datetime, float]]:
    root = ET.fromstring(xml_text)
    points: list[tuple[datetime, float]] = []

    for time_series in root.iter():
        if _strip_ns(time_series.tag) != "TimeSeries":
            continue

        for period in _iter_children(time_series, "Period"):
            interval = _iter_children(period, "timeInterval")
            resolution = _iter_children(period, "resolution")
            if not interval or not resolution:
                continue

            start_node = _iter_children(interval[0], "start")
            if not start_node:
                continue

            start = _parse_datetime(start_node[0].text or "")
            step = _resolution_to_timedelta(resolution[0].text or "")
            if step is None:
                continue

            for point in _iter_children(period, "Point"):
                position_node = _iter_children(point, "position")
                price_node = _iter_children(point, "price.amount")
                if not position_node or not price_node:
                    continue

                try:
                    position = int(position_node[0].text or "0")
                    price = float(price_node[0].text or "0")
                except ValueError:
                    continue

                timestamp = start + (position - 1) * step
                points.append((timestamp, price))

    points.sort(key=lambda item: item[0])
    return points


def parse_generation_mix(xml_text: str) -> List[Tuple[datetime, str, float]]:
    root = ET.fromstring(xml_text)
    records: list[tuple[datetime, str, float]] = []

    for time_series in root.iter():
        if _strip_ns(time_series.tag) != "TimeSeries":
            continue

        mkt_psr = _iter_children(time_series, "MktPSRType")
        if not mkt_psr:
            continue

        psr_type = _iter_children(mkt_psr[0], "psrType")
        if not psr_type:
            continue

        psr_code = psr_type[0].text or ""
        fuel_type = PSR_TYPE_LABELS.get(psr_code, f"Other ({psr_code})")

        for period in _iter_children(time_series, "Period"):
            interval = _iter_children(period, "timeInterval")
            resolution = _iter_children(period, "resolution")
            if not interval or not resolution:
                continue

            start_node = _iter_children(interval[0], "start")
            if not start_node:
                continue

            start = _parse_datetime(start_node[0].text or "")
            step = _resolution_to_timedelta(resolution[0].text or "")
            if step is None:
                continue

            for point in _iter_children(period, "Point"):
                position_node = _iter_children(point, "position")
                quantity_node = _iter_children(point, "quantity")
                if not position_node or not quantity_node:
                    continue

                try:
                    position = int(position_node[0].text or "0")
                    quantity = float(quantity_node[0].text or "0")
                except ValueError:
                    continue

                timestamp = start + (position - 1) * step
                records.append((timestamp, fuel_type, quantity))

    records.sort(key=lambda item: (item[0], item[1]))
    return records


def fetch_day_ahead_prices(
    country_code: str,
    start: datetime,
    end: datetime,
    api_key: str,
) -> List[Tuple[datetime, float]]:
    if country_code not in BIDDING_ZONES:
        raise ValueError("Unsupported country code")

    start_utc = _ensure_utc(start)
    end_utc = _ensure_utc(end)

    params = {
        "securityToken": api_key,
        "documentType": "A44",
        "in_Domain": BIDDING_ZONES[country_code],
        "out_Domain": BIDDING_ZONES[country_code],
        "periodStart": start_utc.strftime("%Y%m%d%H00"),
        "periodEnd": end_utc.strftime("%Y%m%d%H00"),
    }

    response = httpx.get(ENTSOE_URL, params=params, timeout=30)
    response.raise_for_status()

    return parse_day_ahead_prices(response.text)


def fetch_generation_mix(
    country_code: str,
    start: datetime,
    end: datetime,
    api_key: str,
) -> List[Tuple[datetime, str, float]]:
    if country_code not in BIDDING_ZONES:
        raise ValueError("Unsupported country code")

    start_utc = _ensure_utc(start)
    end_utc = _ensure_utc(end)

    params = {
        "securityToken": api_key,
        "documentType": "A75",
        "processType": "A16",
        "in_Domain": BIDDING_ZONES[country_code],
        "periodStart": start_utc.strftime("%Y%m%d%H00"),
        "periodEnd": end_utc.strftime("%Y%m%d%H00"),
    }

    response = httpx.get(ENTSOE_URL, params=params, timeout=30)
    response.raise_for_status()

    return parse_generation_mix(response.text)


def _ensure_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)
