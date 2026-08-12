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
CACHE_PATH = "memory/cache/wb_fill_quarter_reports_jam_2026_q1_q2.json"

REPORTS = [
    {"sheet": "Отчет за 1 квартал", "start": "2026-01-01", "end": "2026-03-30"},
    {"sheet": "Отчет за 2 квартал", "start": "2026-04-01", "end": "2026-06-30"},
]


def log(*parts):
    print(dt.datetime.now(dt.UTC).strftime("%H:%M:%S"), *parts, flush=True)


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


def read_values(service, range_name):
    return (
        service.spreadsheets()
        .values()
        .get(spreadsheetId=SPREADSHEET_ID, range=range_name)
        .execute()
        .get("values", [])
    )


def batch_update(service, updates):
    return (
        service.spreadsheets()
        .values()
        .batchUpdate(
            spreadsheetId=SPREADSHEET_ID,
            body={"valueInputOption": "USER_ENTERED", "data": updates},
        )
        .execute()
    )


def load_cache():
    if not os.path.exists(CACHE_PATH):
        return {"jam": {}, "ads": {}, "summary": {}}
    with open(CACHE_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def save_cache(cache):
    os.makedirs(os.path.dirname(CACHE_PATH), exist_ok=True)
    with open(CACHE_PATH, "w", encoding="utf-8") as f:
        json.dump(cache, f, ensure_ascii=False, indent=2)


def get_wb_token(service):
    values = read_values(service, "'Ключ'!A1:A2")
    a1 = values[0][0].strip() if len(values) >= 1 and values[0] else ""
    a2 = values[1][0].strip() if len(values) >= 2 and values[1] else ""
    if not a1:
        raise RuntimeError("Ключ!A1 пустой")
    if a2:
        log("A1 выбран; A2 есть, но ранее WB вернул 401 withdrawn")
    return a1


def wb_request(method, url, token, max_wait_minutes=120, **kwargs):
    headers = {
        "Authorization": token,
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": "OpenClaw/1.0",
    }
    started = time.monotonic()
    attempt = 0
    while True:
        attempt += 1
        try:
            resp = requests.request(method, url, headers=headers, timeout=(30, 120), **kwargs)
        except requests.RequestException as exc:
            if (time.monotonic() - started) / 60 > max_wait_minutes:
                raise
            wait = min(900, 180 + attempt * 120)
            log("WB request error, wait", wait, "sec:", type(exc).__name__, url)
            time.sleep(wait)
            continue

        if resp.status_code == 429:
            if (time.monotonic() - started) / 60 > max_wait_minutes:
                return resp
            retry_after = resp.headers.get("Retry-After")
            wait = int(retry_after) if retry_after and retry_after.isdigit() else min(1200, 240 + attempt * 120)
            log("WB 429, wait", wait, "sec:", url)
            time.sleep(wait)
            continue
        if resp.status_code >= 500:
            if (time.monotonic() - started) / 60 > max_wait_minutes:
                return resp
            wait = min(900, 120 + attempt * 120)
            log("WB", resp.status_code, "wait", wait, "sec:", url)
            time.sleep(wait)
            continue
        return resp


def nmids_from_rows(rows):
    ids = []
    for row in rows:
        if len(row) > 1 and str(row[1]).strip().isdigit():
            ids.append(int(str(row[1]).strip()))
    return ids


def clear_target_columns(service, rows_by_sheet):
    updates = []
    for sheet, rows in rows_by_sheet.items():
        empty = [[""] * 11 for _ in rows]  # E:O, D and P stay untouched.
        updates.append({"range": f"'{sheet}'!E3:O{2 + len(rows)}", "values": empty})
    batch_update(service, updates)
    log("cleared E:O for", len(updates), "sheets")


def fetch_jam_details(report, nmids, token, cache):
    key = report["sheet"]
    if key in cache["jam"]:
        log("JAM cache hit:", key)
        return cache["jam"][key]

    by_nm = {}
    for offset in range(0, len(nmids), 50):
        chunk = nmids[offset : offset + 50]
        payload = {
            "currentPeriod": {"start": report["start"], "end": report["end"]},
            "nmIds": chunk,
            "orderBy": {"field": "openCard", "mode": "desc"},
            "positionCluster": "all",
            "includeSubstitutedSKUs": True,
            "includeSearchTexts": True,
            "limit": 1000,
            "offset": 0,
        }
        resp = wb_request(
            "POST",
            "https://seller-analytics-api.wildberries.ru/api/v2/search-report/table/details",
            token,
            json=payload,
        )
        log("JAM table/details", key, "chunk", offset, resp.status_code)
        if resp.status_code != 200:
            raise RuntimeError(f"JAM details {key} failed {resp.status_code}: {resp.text[:700]}")

        data = resp.json().get("data", {})
        products = data.get("products") or data.get("items") or []
        for item in products:
            nm = item.get("nmId")
            if nm:
                by_nm[str(int(nm))] = item
        if offset + 50 < len(nmids):
            time.sleep(22)
    cache["jam"][key] = by_nm
    save_cache(cache)
    log("JAM products:", key, len(by_nm))
    return by_nm


def current(metric):
    if isinstance(metric, dict):
        return metric.get("current") or 0
    return metric or 0


def write_jam_columns(service, report, rows, jam):
    values = []
    filled = 0
    missing = 0
    for row in rows:
        nm = int(str(row[1]).strip()) if len(row) > 1 and str(row[1]).strip().isdigit() else None
        line = ["", "", "", "", "", ""]
        if nm:
            item = jam.get(str(nm))
            if item:
                line = [
                    item.get("feedbackRating") or "",
                    int(current(item.get("openCard")) or 0),
                    "",  # JAM table/details has no separate clicks/impressions CTR field.
                    current(item.get("openToCart")) or 0,
                    current(item.get("cartToOrder")) or 0,
                    "",  # JAM table/details has no refusal/cancel metric.
                ]
                filled += 1
            else:
                missing += 1
        values.append(line)
    batch_update(service, [{"range": f"'{report['sheet']}'!E3:J{2 + len(rows)}", "values": values}])
    log("wrote E:J:", report["sheet"], "filled", filled, "missing", missing)
    return {"jam_filled": filled, "jam_missing": missing}


def date_list(start, end):
    day = dt.date.fromisoformat(start)
    finish = dt.date.fromisoformat(end)
    dates = []
    while day <= finish:
        dates.append(day.isoformat())
        day += dt.timedelta(days=1)
    return dates


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
            if item.get("advertId"):
                ids.append(int(item["advertId"]))
    ids = list(dict.fromkeys(ids))
    cache["ads"]["campaign_ids"] = ids
    save_cache(cache)
    log("campaign ids:", len(ids))
    return ids


def fetch_ads(report, campaign_ids, token, cache):
    key = report["sheet"]
    if key in cache["ads"]:
        log("ads cache hit:", key)
        return cache["ads"][key]

    aggregate = defaultdict(lambda: {"views": 0.0, "clicks": 0.0, "atbs": 0.0, "orders": 0.0})
    dates = date_list(report["start"], report["end"])
    for offset in range(0, len(campaign_ids), 100):
        payload = [{"id": campaign_id, "dates": dates} for campaign_id in campaign_ids[offset : offset + 100]]
        resp = wb_request(
            "POST",
            "https://advert-api.wildberries.ru/adv/v2/fullstats",
            token,
            json=payload,
        )
        log("fullstats", key, "chunk", offset, resp.status_code)
        if resp.status_code != 200:
            raise RuntimeError(f"fullstats {key} failed {resp.status_code}: {resp.text[:700]}")
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
    log("ads products:", key, len(aggregate))
    return cache["ads"][key]


def write_ad_columns(service, report, rows, ads):
    values = []
    rows_with_views = 0
    for row in rows:
        nm = int(str(row[1]).strip()) if len(row) > 1 and str(row[1]).strip().isdigit() else None
        line = [0, 0, 0, 0, ""]
        if nm:
            item = ads.get(str(nm), {})
            views = float(item.get("views") or 0)
            clicks = float(item.get("clicks") or 0)
            atbs = float(item.get("atbs") or 0)
            orders = float(item.get("orders") or 0)
            if views:
                rows_with_views += 1
            line = [
                int(views),
                round(clicks / views * 100, 2) if views else 0,
                round(atbs / clicks * 100, 2) if clicks else 0,
                round(orders / atbs * 100, 2) if atbs else 0,
                "",  # No refusal/cancel metric in adv fullstats per nm.
            ]
        values.append(line)
    batch_update(service, [{"range": f"'{report['sheet']}'!K3:O{2 + len(rows)}", "values": values}])
    log("wrote K:O:", report["sheet"], "rows_with_views", rows_with_views)
    return {"ad_rows_with_views": rows_with_views}


def main():
    service = load_google_service()
    token = get_wb_token(service)
    cache = load_cache()

    rows_by_sheet = {}
    all_nmids = []
    for report in REPORTS:
        rows = read_values(service, f"'{report['sheet']}'!A3:P107")
        rows_by_sheet[report["sheet"]] = rows
        all_nmids.extend(nmids_from_rows(rows))
    all_nmids = list(dict.fromkeys(all_nmids))
    log("unique nmIDs:", len(all_nmids))

    clear_target_columns(service, rows_by_sheet)

    summary = {}
    for report in REPORTS:
        jam = fetch_jam_details(report, all_nmids, token, cache)
        summary[report["sheet"]] = write_jam_columns(service, report, rows_by_sheet[report["sheet"]], jam)

    campaign_ids = fetch_campaign_ids(token, cache)
    for report in REPORTS:
        ads = fetch_ads(report, campaign_ids, token, cache)
        summary[report["sheet"]].update(write_ad_columns(service, report, rows_by_sheet[report["sheet"]], ads))

    cache["summary"]["last_run"] = {
        "finished_at_utc": dt.datetime.now(dt.UTC).isoformat(timespec="seconds"),
        "summary": summary,
        "mapping": {
            "D": "untouched/manual",
            "E": "JAM table/details feedbackRating",
            "F": "JAM table/details openCard.current",
            "G": "blank: JAM table/details has no CTR/click percent field",
            "H": "JAM table/details openToCart.current",
            "I": "JAM table/details cartToOrder.current",
            "J": "blank: JAM table/details has no refusal metric",
            "K": "advert fullstats views",
            "L": "advert fullstats clicks/views",
            "M": "advert fullstats atbs/clicks",
            "N": "advert fullstats orders/atbs",
            "O": "blank: adv fullstats has no refusal metric",
            "P": "untouched/manual",
        },
    }
    save_cache(cache)
    log("DONE", json.dumps(summary, ensure_ascii=False))


if __name__ == "__main__":
    main()
