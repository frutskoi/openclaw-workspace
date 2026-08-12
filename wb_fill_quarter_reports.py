#!/usr/bin/env python3
import datetime as dt
import json
import os
import time
from collections import defaultdict

import requests
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build


SPREADSHEET_ID = "1d7rdQF33susHEDfLUwThGOYVWmF4jLYi5VzZd7O5Qn8"
GOOGLE_TOKEN_PATH = "google-creds/token.json"
CACHE_PATH = "memory/cache/wb_fill_quarter_reports_2026_q1_q2.json"

REPORTS = [
    {
        "sheet": "Отчет за 1 квартал",
        "start": "2026-01-01",
        "end": "2026-03-30",
    },
    {
        "sheet": "Отчет за 2 квартал",
        "start": "2026-04-01",
        "end": "2026-06-30",
    },
]


def log(*parts):
    print(dt.datetime.utcnow().strftime("%H:%M:%S"), *parts, flush=True)


def load_google_service():
    with open(GOOGLE_TOKEN_PATH, "r", encoding="utf-8") as f:
        info = json.load(f)
    creds = Credentials.from_authorized_user_info(info, scopes=info.get("scopes"))
    if not creds.valid:
        creds.refresh(Request())
        merged = json.loads(creds.to_json())
        if not merged.get("refresh_token") and info.get("refresh_token"):
            merged["refresh_token"] = info["refresh_token"]
        with open(GOOGLE_TOKEN_PATH, "w", encoding="utf-8") as f:
            json.dump(merged, f, ensure_ascii=False, indent=2)
    return build("sheets", "v4", credentials=creds)


def read_sheet_values(service, range_name):
    resp = (
        service.spreadsheets()
        .values()
        .get(spreadsheetId=SPREADSHEET_ID, range=range_name)
        .execute()
    )
    return resp.get("values", [])


def batch_update(service, updates):
    body = {"valueInputOption": "USER_ENTERED", "data": updates}
    return (
        service.spreadsheets()
        .values()
        .batchUpdate(spreadsheetId=SPREADSHEET_ID, body=body)
        .execute()
    )


def load_cache():
    if not os.path.exists(CACHE_PATH):
        return {"analytics": {}, "ads": {}, "reports": {}}
    with open(CACHE_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def save_cache(cache):
    os.makedirs(os.path.dirname(CACHE_PATH), exist_ok=True)
    with open(CACHE_PATH, "w", encoding="utf-8") as f:
        json.dump(cache, f, ensure_ascii=False, indent=2)


def wb_request(method, url, token, max_wait_minutes=120, **kwargs):
    headers = {"Authorization": token, "Content-Type": "application/json"}
    started = time.monotonic()
    attempt = 0
    while True:
        attempt += 1
        try:
            resp = requests.request(method, url, headers=headers, timeout=120, **kwargs)
        except requests.RequestException as exc:
            elapsed_min = (time.monotonic() - started) / 60
            if elapsed_min > max_wait_minutes:
                raise
            wait = min(600, 120 + attempt * 120)
            log("WB request error, wait", wait, "sec:", type(exc).__name__, url)
            time.sleep(wait)
            continue
        if resp.status_code == 429:
            elapsed_min = (time.monotonic() - started) / 60
            if elapsed_min > max_wait_minutes:
                return resp
            retry_after = resp.headers.get("Retry-After")
            wait = int(retry_after) if retry_after and retry_after.isdigit() else min(900, 240 + attempt * 120)
            log("WB 429, wait", wait, "sec:", url)
            time.sleep(wait)
            continue
        if resp.status_code >= 500:
            elapsed_min = (time.monotonic() - started) / 60
            if elapsed_min > max_wait_minutes:
                return resp
            wait = min(600, 60 + attempt * 60)
            log("WB", resp.status_code, "wait", wait, "sec:", url)
            time.sleep(wait)
            continue
        return resp


def date_list(start, end):
    day = dt.date.fromisoformat(start)
    finish = dt.date.fromisoformat(end)
    out = []
    while day <= finish:
        out.append(day.isoformat())
        day += dt.timedelta(days=1)
    return out


def nmids_from_rows(rows_by_sheet):
    nmids = []
    for rows in rows_by_sheet.values():
        for row in rows:
            if len(row) > 1 and str(row[1]).strip().isdigit():
                nmids.append(int(str(row[1]).strip()))
    return list(dict.fromkeys(nmids))


def get_wb_token(service):
    values = read_sheet_values(service, "'Ключ'!A1:A2")
    a1 = values[0][0].strip() if len(values) >= 1 and values[0] else ""
    a2 = values[1][0].strip() if len(values) >= 2 and values[1] else ""
    if not a1:
        raise RuntimeError("Ключ!A1 пустой")
    if a2:
        log("Ключи: A1 есть, A2 есть; использую A1, A2 ранее отвечал 401 withdrawn")
    else:
        log("Ключ: A1 есть, A2 пустой")
    return a1


def fetch_analytics(report, nmids, token, cache):
    key = report["sheet"]
    if key in cache["analytics"]:
        log("analytics cache hit:", key)
        return cache["analytics"][key]

    payload = {
        "selectedPeriod": {"start": report["start"], "end": report["end"]},
        "nmIds": nmids,
        "limit": 1000,
        "offset": 0,
        "skipDeletedNm": False,
        "orderBy": {"field": "orderCount", "mode": "desc"},
    }
    resp = wb_request(
        "POST",
        "https://seller-analytics-api.wildberries.ru/api/analytics/v3/sales-funnel/products",
        token,
        json=payload,
    )
    log("analytics", key, resp.status_code)
    if resp.status_code != 200:
        raise RuntimeError(f"analytics {key} failed {resp.status_code}: {resp.text[:500]}")
    products = resp.json().get("data", {}).get("products", [])
    by_nm = {}
    for item in products:
        nm = item.get("product", {}).get("nmId")
        if nm:
            by_nm[str(int(nm))] = item
    cache["analytics"][key] = by_nm
    save_cache(cache)
    log("analytics products:", key, len(by_nm))
    return by_nm


def write_general_columns(service, report, rows, analytics):
    values = []
    filled = 0
    missing = 0
    for row in rows:
        line = ["", "", "", "", ""]
        nm = int(str(row[1]).strip()) if len(row) > 1 and str(row[1]).strip().isdigit() else None
        if nm:
            item = analytics.get(str(nm))
            if item:
                stat = item.get("statistic", {}).get("selected", {}) or {}
                conv = stat.get("conversions") or {}
                order_count = float(stat.get("orderCount") or 0)
                cancel_count = float(stat.get("cancelCount") or 0)
                line = [
                    int(stat.get("openCount") or 0),
                    conv.get("addToCartPercent") or 0,
                    conv.get("cartToOrderPercent") or 0,
                    conv.get("buyoutPercent") or 0,
                    round(cancel_count / order_count * 100, 2) if order_count else 0,
                ]
                filled += 1
            else:
                missing += 1
        values.append(line)
    end_row = 2 + len(values)
    batch_update(service, [{"range": f"'{report['sheet']}'!F3:J{end_row}", "values": values}])
    log("wrote F:J:", report["sheet"], "filled", filled, "missing", missing)
    return {"general_filled": filled, "general_missing": missing}


def fetch_campaign_ids(token, cache):
    if "campaign_ids" in cache["ads"]:
        log("campaign ids cache hit:", len(cache["ads"]["campaign_ids"]))
        return cache["ads"]["campaign_ids"]
    resp = wb_request("GET", "https://advert-api.wildberries.ru/adv/v1/promotion/count", token)
    log("promotion/count", resp.status_code)
    if resp.status_code != 200:
        raise RuntimeError(f"promotion/count failed {resp.status_code}: {resp.text[:500]}")
    ids = []
    for group in resp.json().get("adverts", []):
        for item in group.get("advert_list", []) or []:
            advert_id = item.get("advertId")
            if advert_id:
                ids.append(int(advert_id))
    ids = list(dict.fromkeys(ids))
    cache["ads"]["campaign_ids"] = ids
    save_cache(cache)
    log("campaign ids:", len(ids))
    return ids


def fetch_ads_for_report(report, campaign_ids, token, cache):
    key = report["sheet"]
    if key in cache["ads"]:
        log("ads cache hit:", key)
        return cache["ads"][key]

    aggregate = defaultdict(lambda: {"views": 0.0, "clicks": 0.0, "atbs": 0.0, "orders": 0.0})
    dates = date_list(report["start"], report["end"])
    for offset in range(0, len(campaign_ids), 100):
        chunk = campaign_ids[offset : offset + 100]
        payload = [{"id": campaign_id, "dates": dates} for campaign_id in chunk]
        resp = wb_request(
            "POST",
            "https://advert-api.wildberries.ru/adv/v2/fullstats",
            token,
            json=payload,
        )
        log("fullstats", key, "chunk", offset, resp.status_code)
        if resp.status_code != 200:
            raise RuntimeError(f"fullstats {key} failed {resp.status_code}: {resp.text[:500]}")
        data = resp.json()
        for campaign in data if isinstance(data, list) else []:
            for day in campaign.get("days", []) or []:
                for app in day.get("apps", []) or []:
                    for nmrow in app.get("nm", []) or []:
                        nm = nmrow.get("nmId") or nmrow.get("nm")
                        if not nm:
                            continue
                        item = aggregate[str(int(nm))]
                        for field in ("views", "clicks", "atbs", "orders"):
                            item[field] += float(nmrow.get(field) or 0)
    cache["ads"][key] = dict(aggregate)
    save_cache(cache)
    log("ads nm rows:", key, len(aggregate))
    return cache["ads"][key]


def write_ad_columns(service, report, rows, ads):
    values = []
    rows_with_views = 0
    for row in rows:
        line = [0, 0, 0, 0, "", ""]
        nm = int(str(row[1]).strip()) if len(row) > 1 and str(row[1]).strip().isdigit() else None
        if nm:
            ad = ads.get(str(nm), {})
            views = float(ad.get("views") or 0)
            clicks = float(ad.get("clicks") or 0)
            atbs = float(ad.get("atbs") or 0)
            orders = float(ad.get("orders") or 0)
            if views:
                rows_with_views += 1
            line = [
                int(views),
                round(clicks / views * 100, 2) if views else 0,
                round(atbs / clicks * 100, 2) if clicks else 0,
                round(orders / atbs * 100, 2) if atbs else 0,
                "",
                "",
            ]
        values.append(line)
    end_row = 2 + len(values)
    batch_update(service, [{"range": f"'{report['sheet']}'!K3:P{end_row}", "values": values}])
    log("wrote K:P:", report["sheet"], "rows_with_ad_views", rows_with_views)
    return {"ad_rows_with_views": rows_with_views}


def main():
    service = load_google_service()
    token = get_wb_token(service)
    cache = load_cache()

    rows_by_sheet = {}
    for report in REPORTS:
        rows_by_sheet[report["sheet"]] = read_sheet_values(
            service, f"'{report['sheet']}'!A3:P107"
        )
    nmids = nmids_from_rows(rows_by_sheet)
    log("nmIDs:", len(nmids))

    report_summary = {}
    for report in REPORTS:
        analytics = fetch_analytics(report, nmids, token, cache)
        summary = write_general_columns(
            service, report, rows_by_sheet[report["sheet"]], analytics
        )
        report_summary[report["sheet"]] = summary

    campaign_ids = fetch_campaign_ids(token, cache)
    for report in REPORTS:
        ads = fetch_ads_for_report(report, campaign_ids, token, cache)
        summary = write_ad_columns(service, report, rows_by_sheet[report["sheet"]], ads)
        report_summary[report["sheet"]].update(summary)

    cache["reports"]["last_run"] = {
        "finished_at_utc": dt.datetime.utcnow().isoformat(timespec="seconds") + "Z",
        "summary": report_summary,
        "mapping": {
            "F": "seller-analytics openCount",
            "G": "seller-analytics addToCartPercent",
            "H": "seller-analytics cartToOrderPercent",
            "I": "seller-analytics buyoutPercent",
            "J": "cancelCount/orderCount",
            "K": "advert fullstats views",
            "L": "advert fullstats clicks/views",
            "M": "advert fullstats atbs/clicks",
            "N": "advert fullstats orders/atbs",
            "O": "blank: advert fullstats has no per-nm отказ metric",
            "P": "blank/comment",
        },
    }
    save_cache(cache)
    log("DONE", json.dumps(report_summary, ensure_ascii=False))


if __name__ == "__main__":
    main()
