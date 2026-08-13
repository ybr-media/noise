"""Check R2 storage/operations usage against the Cloudflare free tier and
email an alert when any meter is approaching it.

Reads current-month usage from Cloudflare's GraphQL Analytics API
(https://api.cloudflare.com/client/v4/graphql) for the three meters R2
actually bills for: storage (GB-month), Class A operations (writes/lists),
and Class B operations (reads). Egress is not billed on R2, so it is not
tracked here. Deletes are free and are not billed either.

Sends the alert through Resend (https://resend.com) so it can reach a
primary recipient plus any cc'd addresses; nothing is sent when every meter
is comfortably under the alert threshold.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import date, datetime, timezone

GRAPHQL_URL = "https://api.cloudflare.com/client/v4/graphql"
RESEND_URL = "https://api.resend.com/emails"

# Cloudflare's published free tier (https://developers.cloudflare.com/r2/pricing/).
FREE_STORAGE_BYTES = 10 * 1_000_000_000  # 10 GB-month
FREE_CLASS_A_REQUESTS = 1_000_000
FREE_CLASS_B_REQUESTS = 10_000_000

# Overage pricing, used only to estimate a dollar figure once a meter is
# past its free tier -- the alert itself fires on percent-of-free-tier.
PRICE_PER_GB_MONTH = 0.015
PRICE_PER_MILLION_CLASS_A = 4.50
PRICE_PER_MILLION_CLASS_B = 0.36

# R2's S3-compatible action names, split the way Cloudflare bills them.
# Deletes and a handful of read-only bucket config calls are free and are
# omitted on purpose. Anything not listed here is reported as "unclassified"
# rather than silently folded into class A or B.
CLASS_A_ACTIONS = {
    "ListBuckets",
    "PutBucket",
    "ListObjects",
    "PutObject",
    "CopyObject",
    "CompleteMultipartUpload",
    "CreateMultipartUpload",
    "ListMultipartUploads",
    "UploadPart",
    "UploadPartCopy",
    "ListParts",
    "PutBucketEncryption",
    "PutBucketLifecycleConfiguration",
    "LifecycleStorageTierTransition",
}
CLASS_B_ACTIONS = {
    "HeadBucket",
    "HeadObject",
    "GetObject",
    "GetBucketEncryption",
    "GetBucketLocation",
    "GetBucketLifecycleConfiguration",
}


class UsageError(RuntimeError):
    pass


def graphql(token: str, query: str, variables: dict[str, object]) -> dict[str, object]:
    body = json.dumps({"query": query, "variables": variables}).encode("utf-8")
    request = urllib.request.Request(
        GRAPHQL_URL,
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(request) as response:
            payload = json.loads(response.read())
    except urllib.error.HTTPError as exc:
        raise UsageError(f"Cloudflare GraphQL API returned {exc.code}: {exc.read().decode('utf-8', 'replace')}") from exc
    if payload.get("errors"):
        raise UsageError(f"Cloudflare GraphQL API returned errors: {payload['errors']}")
    return payload["data"]


def fetch_storage(token: str, account_id: str, bucket: str) -> dict[str, int]:
    query = """
        query R2Storage($accountTag: String!, $bucket: String!) {
          viewer {
            accounts(filter: { accountTag: $accountTag }) {
              r2StorageAdaptiveGroups(
                filter: { bucketName: $bucket }
                limit: 1
                orderBy: [date_DESC]
              ) {
                dimensions { date }
                max { payloadSize metadataSize objectCount }
              }
            }
          }
        }
    """
    data = graphql(token, query, {"accountTag": account_id, "bucket": bucket})
    groups = data["viewer"]["accounts"][0]["r2StorageAdaptiveGroups"]
    if not groups:
        return {"date": None, "payloadSize": 0, "metadataSize": 0, "objectCount": 0}
    latest = groups[0]
    return {
        "date": latest["dimensions"]["date"],
        "payloadSize": latest["max"]["payloadSize"],
        "metadataSize": latest["max"]["metadataSize"],
        "objectCount": latest["max"]["objectCount"],
    }


def fetch_operations(token: str, account_id: str, bucket: str, start: date, end: date) -> dict[str, int]:
    query = """
        query R2Operations($accountTag: String!, $bucket: String!, $start: Date!, $end: Date!) {
          viewer {
            accounts(filter: { accountTag: $accountTag }) {
              r2OperationsAdaptiveGroups(
                filter: { bucketName: $bucket, date_geq: $start, date_leq: $end }
                limit: 10000
                orderBy: [date_ASC]
              ) {
                dimensions { actionType }
                sum { requests }
              }
            }
          }
        }
    """
    data = graphql(
        token,
        query,
        {
            "accountTag": account_id,
            "bucket": bucket,
            "start": start.isoformat(),
            "end": end.isoformat(),
        },
    )
    groups = data["viewer"]["accounts"][0]["r2OperationsAdaptiveGroups"]
    by_action: dict[str, int] = {}
    for group in groups:
        action = group["dimensions"]["actionType"]
        by_action[action] = by_action.get(action, 0) + group["sum"]["requests"]

    class_a = sum(n for action, n in by_action.items() if action in CLASS_A_ACTIONS)
    class_b = sum(n for action, n in by_action.items() if action in CLASS_B_ACTIONS)
    unclassified = {a: n for a, n in by_action.items() if a not in CLASS_A_ACTIONS and a not in CLASS_B_ACTIONS}
    return {"classA": class_a, "classB": class_b, "unclassified": unclassified}


def build_report(storage: dict[str, object], operations: dict[str, object], threshold_pct: float) -> dict[str, object]:
    storage_bytes = storage["payloadSize"] + storage["metadataSize"]
    meters = [
        {
            "name": "Storage",
            "used": storage_bytes,
            "free": FREE_STORAGE_BYTES,
            "unit": "GB",
            "scale": 1_000_000_000,
            "overage_price": PRICE_PER_GB_MONTH,
        },
        {
            "name": "Class A operations (writes/lists)",
            "used": operations["classA"],
            "free": FREE_CLASS_A_REQUESTS,
            "unit": "requests",
            "scale": 1,
            "overage_price": PRICE_PER_MILLION_CLASS_A / 1_000_000,
        },
        {
            "name": "Class B operations (reads)",
            "used": operations["classB"],
            "free": FREE_CLASS_B_REQUESTS,
            "unit": "requests",
            "scale": 1,
            "overage_price": PRICE_PER_MILLION_CLASS_B / 1_000_000,
        },
    ]
    for meter in meters:
        meter["pct"] = meter["used"] / meter["free"]
        overage_units = max(0, meter["used"] - meter["free"])
        meter["estimated_cost"] = overage_units * meter["overage_price"]
    triggered = [m for m in meters if m["pct"] >= threshold_pct]
    return {
        "meters": meters,
        "triggered": triggered,
        "unclassified": operations["unclassified"],
        "storage_date": storage["date"],
        "object_count": storage["objectCount"],
    }


def format_meter_line(meter: dict[str, object]) -> str:
    used = meter["used"] / meter["scale"]
    free = meter["free"] / meter["scale"]
    return (
        f"{meter['name']}: {used:,.2f} {meter['unit']} used of {free:,.0f} {meter['unit']} free "
        f"({meter['pct'] * 100:.1f}%), est. overage ${meter['estimated_cost']:.2f}"
    )


def print_summary(bucket: str, report: dict[str, object]) -> None:
    print(f"R2 usage for bucket {bucket!r} (storage as of {report['storage_date']}, {report['object_count']:,} objects):")
    for meter in report["meters"]:
        print(f"  {format_meter_line(meter)}")
    if report["unclassified"]:
        print(f"  Unclassified actionTypes seen (not counted toward class A/B): {report['unclassified']}")


def send_alert_email(
    resend_api_key: str,
    sender: str,
    to: list[str],
    cc: list[str],
    bucket: str,
    report: dict[str, object],
) -> None:
    lines = [f"<li>{format_meter_line(m)}</li>" for m in report["triggered"]]
    all_lines = [f"<li>{format_meter_line(m)}</li>" for m in report["meters"]]
    html = f"""
        <p>R2 bucket <b>{bucket}</b> has a meter at or above the configured alert threshold
        (storage as of {report['storage_date']}, {report['object_count']:,} objects stored).</p>
        <p><b>Triggered:</b></p>
        <ul>{''.join(lines)}</ul>
        <p><b>All meters:</b></p>
        <ul>{''.join(all_lines)}</ul>
        <p>Estimated total overage this month: ${sum(m['estimated_cost'] for m in report['meters']):.2f}.
        R2 does not charge for egress or deletes, so those are not tracked here.</p>
    """
    body = {
        "from": sender,
        "to": to,
        "subject": f"R2 usage alert: {bucket} approaching free tier",
        "html": html,
    }
    if cc:
        body["cc"] = cc
    request = urllib.request.Request(
        RESEND_URL,
        data=json.dumps(body).encode("utf-8"),
        method="POST",
        headers={
            "Authorization": f"Bearer {resend_api_key}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(request) as response:
            response.read()
    except urllib.error.HTTPError as exc:
        raise UsageError(f"Resend API returned {exc.code}: {exc.read().decode('utf-8', 'replace')}") from exc


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bucket", default=os.environ.get("R2_BUCKET", "noise-labs"))
    parser.add_argument("--threshold-pct", type=float, default=float(os.environ.get("ALERT_THRESHOLD_PCT", "0.8")))
    parser.add_argument("--dry-run", action="store_true", help="Print the report but never send an email")
    parser.add_argument("--force-alert", action="store_true", help="Send the email even if no meter is triggered")
    args = parser.parse_args(argv)

    try:
        cf_token = os.environ["CLOUDFLARE_API_TOKEN"]
        account_id = os.environ["R2_ACCOUNT_ID"]
    except KeyError as exc:
        print(f"Missing required environment variable: {exc}", file=sys.stderr)
        return 2

    today = datetime.now(timezone.utc).date()
    month_start = today.replace(day=1)

    try:
        storage = fetch_storage(cf_token, account_id, args.bucket)
        operations = fetch_operations(cf_token, account_id, args.bucket, month_start, today)
    except UsageError as exc:
        print(f"Failed to fetch R2 usage: {exc}", file=sys.stderr)
        return 1

    report = build_report(storage, operations, args.threshold_pct)
    print_summary(args.bucket, report)

    if not report["triggered"] and not args.force_alert:
        print("No meter at or above threshold; not sending an alert.")
        return 0

    if args.dry_run:
        print("--dry-run set; skipping email send.")
        return 0

    try:
        resend_api_key = os.environ["RESEND_API_KEY"]
        sender = os.environ["ALERT_EMAIL_FROM"]
        to = [addr.strip() for addr in os.environ["ALERT_EMAIL_TO"].split(",") if addr.strip()]
    except KeyError as exc:
        print(f"Missing required environment variable for sending email: {exc}", file=sys.stderr)
        return 2
    cc = [addr.strip() for addr in os.environ.get("ALERT_EMAIL_CC", "").split(",") if addr.strip()]

    send_alert_email(resend_api_key, sender, to, cc, args.bucket, report)
    print(f"Alert email sent to {to}" + (f" (cc: {cc})" if cc else ""))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
