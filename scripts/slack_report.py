import os
import sys
import requests
from datetime import datetime, timedelta

print("=== Starting Slack Report ===")

# Check credentials file
creds_file = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS", "/tmp/bq-key.json")
print(f"Credentials file: {creds_file}")
if os.path.exists(creds_file):
    print(f"Credentials file exists, size: {os.path.getsize(creds_file)} bytes")
else:
    print("ERROR: Credentials file not found!")
    sys.exit(1)

# Initialize BigQuery client
try:
    from google.cloud import bigquery
    client = bigquery.Client()
    print("BigQuery client initialized successfully")
except Exception as e:
    print(f"ERROR: Failed to initialize BigQuery client: {e}")
    sys.exit(1)

# Date range
end_date = datetime.now()
start_date = end_date - timedelta(days=30)
start_str = start_date.strftime("%Y%m%d")
end_str = end_date.strftime("%Y%m%d")
start_dash = start_date.strftime("%Y-%m-%d")
end_dash = end_date.strftime("%Y-%m-%d")
print(f"Date range: {start_dash} ~ {end_dash}")

# Initialize data
data = {"mau": 0, "revenue": 0, "paying_users": 0, "arppu": 0, "conversion": 0, "cac": 0, "ltv_cac": 0, "roas": 0, "margin": 0}

# Query MAU
try:
    query = f"SELECT COUNT(DISTINCT user_pseudo_id) as mau FROM `cheongimun.analytics_515600551.events_*` WHERE _TABLE_SUFFIX BETWEEN '{start_str}' AND '{end_str}'"
    for row in client.query(query).result():
        data["mau"] = row.mau or 0
    print(f"MAU: {data['mau']:,}")
except Exception as e:
    print(f"MAU query error: {e}")

# Query revenue
try:
    query = f"SELECT SUM(total_amount) as revenue, COUNT(DISTINCT customer_phone) as paying_users FROM `cheongimun.supabase_sync.orders` WHERE payment_status = 'PAID' AND DATE(created_at) BETWEEN '{start_dash}' AND '{end_dash}'"
    for row in client.query(query).result():
        data["revenue"] = int(row.revenue) if row.revenue else 0
        data["paying_users"] = row.paying_users or 0
    print(f"Revenue: {data['revenue']:,}, Paying users: {data['paying_users']:,}")
except Exception as e:
    print(f"Revenue query error: {e}")

# PostgreSQL
ad_spend, ai_cost = 52960184, 21754819
try:
    import psycopg2
    conn = psycopg2.connect(
        host="aws-1-ap-northeast-2.pooler.supabase.com",
        port=6543,
        database="postgres",
        user="postgres.jlutbjmjpreauyanjzdd",
        password=os.environ.get("SUPABASE_PASSWORD", ""),
        sslmode="require",
        connect_timeout=10
    )
    cur = conn.cursor()
    cur.execute("SELECT SUM(spend) FROM adset_performance")
    r = cur.fetchone()
    if r and r[0]: ad_spend = float(r[0])
    cur.execute("SELECT SUM(cost_krw) FROM api_costs")
    r = cur.fetchone()
    if r and r[0]: ai_cost = float(r[0])
    cur.close()
    conn.close()
    print(f"Ad spend: {ad_spend:,}, AI cost: {ai_cost:,}")
except Exception as e:
    print(f"PostgreSQL error (using defaults): {e}")

# Calculate metrics
if data["revenue"] and data["paying_users"]: data["arppu"] = round(data["revenue"] / data["paying_users"])
if data["mau"] and data["paying_users"]: data["conversion"] = round(data["paying_users"] / data["mau"] * 100, 2)
if data["paying_users"] and ad_spend: data["cac"] = round(ad_spend / data["paying_users"])
if data["arppu"] and data["cac"]: data["ltv_cac"] = round(data["arppu"] / data["cac"], 2)
if data["revenue"] and ad_spend: data["roas"] = round(data["revenue"] / ad_spend, 2)
if data["revenue"] and ai_cost: data["margin"] = round((1 - ai_cost / data["revenue"]) * 100, 1)

print(f"Calculated metrics: {data}")

# Send Slack message
now_str = datetime.now().strftime("%Y-%m-%d %H:%M")
payload = {
    "blocks": [
        {"type": "header", "text": {"type": "plain_text", "text": "Daily Dashboard Report"}},
        {"type": "context", "elements": [{"type": "mrkdwn", "text": f"*{now_str}* | Data: {start_dash} ~ {end_dash}"}]},
        {"type": "divider"},
        {"type": "section", "fields": [
            {"type": "mrkdwn", "text": f"*Revenue*\nKRW {data['revenue']:,}"},
            {"type": "mrkdwn", "text": f"*MAU*\n{data['mau']:,}"},
            {"type": "mrkdwn", "text": f"*ARPPU*\nKRW {data['arppu']:,}"},
            {"type": "mrkdwn", "text": f"*Paying Users*\n{data['paying_users']:,}"}
        ]},
        {"type": "divider"},
        {"type": "section", "fields": [
            {"type": "mrkdwn", "text": f"*ROAS*\n{data['roas']}x"},
            {"type": "mrkdwn", "text": f"*LTV/CAC*\n{data['ltv_cac']}x"},
            {"type": "mrkdwn", "text": f"*Margin*\n{data['margin']}%"},
            {"type": "mrkdwn", "text": f"*Conversion*\n{data['conversion']}%"}
        ]},
        {"type": "divider"},
        {"type": "actions", "elements": [{"type": "button", "text": {"type": "plain_text", "text": "View Dashboard"}, "url": "https://invest-board-seven.vercel.app/", "style": "primary"}]}
    ]
}

slack_url = os.environ.get("SLACK_WEBHOOK_URL")
if not slack_url:
    print("ERROR: SLACK_WEBHOOK_URL not set")
    sys.exit(1)

response = requests.post(slack_url, json=payload, timeout=30)
print(f"Slack response: {response.status_code}")
if response.status_code == 200:
    print("=== SUCCESS ===")
else:
    print(f"Slack error: {response.text}")
    sys.exit(1)
