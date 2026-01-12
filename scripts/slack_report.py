import os
import sys
import requests
from datetime import datetime, timedelta

print("=== Starting Slack Report ===")

# Check credentials file
creds_file = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS", "/tmp/bq-key.json")
if not os.path.exists(creds_file):
    print("ERROR: Credentials file not found!")
    sys.exit(1)

# Initialize BigQuery client
try:
    from google.cloud import bigquery
    client = bigquery.Client()
    print("BigQuery client initialized")
except Exception as e:
    print(f"ERROR: BigQuery init failed: {e}")
    sys.exit(1)

# Date range
end_date = datetime.now()
start_date = end_date - timedelta(days=30)
start_str = start_date.strftime("%Y%m%d")
end_str = end_date.strftime("%Y%m%d")
start_dash = start_date.strftime("%Y-%m-%d")
end_dash = end_date.strftime("%Y-%m-%d")

# Initialize data
data = {"mau": 0, "revenue": 0, "paying_users": 0, "arppu": 0, "conversion": 0,
        "cac": 0, "ltv_cac": 0, "roas": 0, "margin": 0, "d1": 0, "stickiness": 0, "repurchase": 0}

# Query MAU
try:
    query = f"SELECT COUNT(DISTINCT user_pseudo_id) as mau FROM `cheongimun.analytics_515600551.events_*` WHERE _TABLE_SUFFIX BETWEEN '{start_str}' AND '{end_str}'"
    for row in client.query(query).result():
        data["mau"] = row.mau or 0
    print(f"MAU: {data['mau']:,}")
except Exception as e:
    print(f"MAU error: {e}")

# Query revenue
try:
    query = f"SELECT SUM(total_amount) as revenue, COUNT(DISTINCT customer_phone) as paying_users FROM `cheongimun.supabase_sync.orders` WHERE payment_status = 'PAID' AND DATE(created_at) BETWEEN '{start_dash}' AND '{end_dash}'"
    for row in client.query(query).result():
        data["revenue"] = int(row.revenue) if row.revenue else 0
        data["paying_users"] = row.paying_users or 0
    print(f"Revenue: {data['revenue']:,}")
except Exception as e:
    print(f"Revenue error: {e}")

# D1 Retention
try:
    query = f"""
    WITH user_first AS (
        SELECT user_pseudo_id, MIN(PARSE_DATE('%Y%m%d', event_date)) as first_date
        FROM `cheongimun.analytics_515600551.events_*`
        WHERE _TABLE_SUFFIX BETWEEN '{start_str}' AND '{end_str}'
        GROUP BY user_pseudo_id
    ),
    d1 AS (
        SELECT DISTINCT f.user_pseudo_id
        FROM user_first f
        JOIN `cheongimun.analytics_515600551.events_*` e
            ON f.user_pseudo_id = e.user_pseudo_id
            AND PARSE_DATE('%Y%m%d', e.event_date) = DATE_ADD(f.first_date, INTERVAL 1 DAY)
        WHERE e._TABLE_SUFFIX BETWEEN '{start_str}' AND '{end_str}'
    )
    SELECT ROUND(COUNT(DISTINCT d.user_pseudo_id) / NULLIF(COUNT(DISTINCT f.user_pseudo_id), 0) * 100, 2) as d1
    FROM user_first f LEFT JOIN d1 d ON f.user_pseudo_id = d.user_pseudo_id
    """
    for row in client.query(query).result():
        data["d1"] = row.d1 or 0
    print(f"D1 Retention: {data['d1']}%")
except Exception as e:
    print(f"D1 error: {e}")

# Stickiness (DAU/MAU)
try:
    query = f"""
    WITH daily AS (
        SELECT COUNT(DISTINCT user_pseudo_id) as dau
        FROM `cheongimun.analytics_515600551.events_*`
        WHERE _TABLE_SUFFIX BETWEEN '{start_str}' AND '{end_str}'
        GROUP BY event_date
    )
    SELECT ROUND(AVG(dau), 0) as avg_dau FROM daily
    """
    for row in client.query(query).result():
        avg_dau = int(row.avg_dau) if row.avg_dau else 0
        if data["mau"]:
            data["stickiness"] = round(avg_dau / data["mau"] * 100, 2)
    print(f"Stickiness: {data['stickiness']}%")
except Exception as e:
    print(f"Stickiness error: {e}")

# Repurchase rate
try:
    query = f"""
    SELECT ROUND(
        COUNT(DISTINCT CASE WHEN order_count > 1 THEN customer_phone END) /
        NULLIF(COUNT(DISTINCT customer_phone), 0) * 100, 2
    ) as repurchase
    FROM (
        SELECT customer_phone, COUNT(*) as order_count
        FROM `cheongimun.supabase_sync.orders`
        WHERE payment_status = 'PAID' AND DATE(created_at) BETWEEN '{start_dash}' AND '{end_dash}'
        GROUP BY customer_phone
    )
    """
    for row in client.query(query).result():
        data["repurchase"] = row.repurchase or 0
    print(f"Repurchase: {data['repurchase']}%")
except Exception as e:
    print(f"Repurchase error: {e}")

# PostgreSQL for ad spend and AI cost
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
    print(f"PostgreSQL error: {e}")

# Calculate metrics
if data["revenue"] and data["paying_users"]:
    data["arppu"] = round(data["revenue"] / data["paying_users"])
if data["mau"] and data["paying_users"]:
    data["conversion"] = round(data["paying_users"] / data["mau"] * 100, 2)
if data["paying_users"] and ad_spend:
    data["cac"] = round(ad_spend / data["paying_users"])
if data["arppu"] and data["cac"]:
    data["ltv_cac"] = round(data["arppu"] / data["cac"], 2)
if data["revenue"] and ad_spend:
    data["roas"] = round(data["revenue"] / ad_spend, 2)
if data["revenue"] and ai_cost:
    data["margin"] = round((1 - ai_cost / data["revenue"]) * 100, 1)

# ARR calculation
arr = data["revenue"] * 12

print(f"All metrics: {data}")

# Send Slack message
now_str = datetime.now().strftime("%Y-%m-%d %H:%M")
payload = {
    "blocks": [
        {
            "type": "header",
            "text": {"type": "plain_text", "text": ":bar_chart: 투자 대시보드 일간 리포트", "emoji": True}
        },
        {
            "type": "context",
            "elements": [{"type": "mrkdwn", "text": f"*{now_str}* | 데이터 기간: {start_dash} ~ {end_dash}"}]
        },
        {"type": "divider"},
        {
            "type": "section",
            "fields": [
                {"type": "mrkdwn", "text": f":moneybag: *월 매출 (MRR)*\n₩{data['revenue']:,}"},
                {"type": "mrkdwn", "text": f":busts_in_silhouette: *MAU*\n{data['mau']:,}명"}
            ]
        },
        {
            "type": "section",
            "fields": [
                {"type": "mrkdwn", "text": f":dollar: *ARPPU*\n₩{data['arppu']:,}"},
                {"type": "mrkdwn", "text": f":shopping_cart: *결제 유저*\n{data['paying_users']:,}명"}
            ]
        },
        {"type": "divider"},
        {
            "type": "section",
            "fields": [
                {"type": "mrkdwn", "text": f":chart_with_upwards_trend: *ROAS*\n{data['roas']}x"},
                {"type": "mrkdwn", "text": f":chart: *LTV/CAC*\n{data['ltv_cac']}x"}
            ]
        },
        {
            "type": "section",
            "fields": [
                {"type": "mrkdwn", "text": f":bar_chart: *Gross Margin*\n{data['margin']}%"},
                {"type": "mrkdwn", "text": f":arrows_counterclockwise: *전환율*\n{data['conversion']}%"}
            ]
        },
        {"type": "divider"},
        {
            "type": "section",
            "fields": [
                {"type": "mrkdwn", "text": f":date: *D1 리텐션*\n{data['d1']}%"},
                {"type": "mrkdwn", "text": f":zap: *Stickiness*\n{data['stickiness']}%"}
            ]
        },
        {
            "type": "section",
            "fields": [
                {"type": "mrkdwn", "text": f":dart: *CAC*\n₩{data['cac']:,}"},
                {"type": "mrkdwn", "text": f":repeat: *재구매율*\n{data['repurchase']}%"}
            ]
        },
        {"type": "divider"},
        {
            "type": "actions",
            "elements": [{
                "type": "button",
                "text": {"type": "plain_text", "text": ":bar_chart: 대시보드 보기", "emoji": True},
                "url": "https://invest-board-seven.vercel.app/",
                "style": "primary"
            }]
        }
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
