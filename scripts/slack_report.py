import os
import sys
import requests
from datetime import datetime

print("=== Starting Slack Report ===")

# Step 1: First call the dashboard API to refresh data
DASHBOARD_API = "https://invest-board-seven.vercel.app/api/kpi"

print("Step 1: Refreshing dashboard data...")
try:
    api_response = requests.get(DASHBOARD_API, timeout=60)
    api_data = api_response.json()

    if not api_data.get('success'):
        print(f"API Error: {api_data.get('error')}")
        sys.exit(1)

    data = api_data['data']
    print(f"Dashboard data refreshed: {data['dataStart']} ~ {data['dataEnd']}")
    print(f"MAU: {data['mau']:,}, Revenue: {data['revenue']:,}")

except Exception as e:
    print(f"Failed to refresh dashboard: {e}")
    sys.exit(1)

# Step 2: Wait a moment to ensure dashboard cache is updated
import time
print("Step 2: Waiting for dashboard sync...")
time.sleep(5)

# Step 3: Send Slack message with the same data
print("Step 3: Sending Slack message...")

now_str = datetime.now().strftime("%Y-%m-%d %H:%M")
start_dash = data['dataStart']
end_dash = data['dataEnd']

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
                {"type": "mrkdwn", "text": f":shopping_cart: *결제 유저*\n{data['payingUsers']:,}명"}
            ]
        },
        {"type": "divider"},
        {
            "type": "section",
            "fields": [
                {"type": "mrkdwn", "text": f":chart_with_upwards_trend: *ROAS*\n{data['roas']}x"},
                {"type": "mrkdwn", "text": f":chart: *LTV/CAC*\n{data['ltvCac']}x"}
            ]
        },
        {
            "type": "section",
            "fields": [
                {"type": "mrkdwn", "text": f":bar_chart: *Gross Margin*\n{data['grossMargin']}%"},
                {"type": "mrkdwn", "text": f":arrows_counterclockwise: *전환율*\n{data['conversionRate']}%"}
            ]
        },
        {"type": "divider"},
        {
            "type": "section",
            "fields": [
                {"type": "mrkdwn", "text": f":date: *D1 리텐션*\n{data['d1Retention']}%"},
                {"type": "mrkdwn", "text": f":zap: *Stickiness*\n{data['stickiness']}%"}
            ]
        },
        {
            "type": "section",
            "fields": [
                {"type": "mrkdwn", "text": f":dart: *CAC*\n₩{data['cac']:,}"},
                {"type": "mrkdwn", "text": f":repeat: *재구매율*\n{data['repurchaseRate']}%"}
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
    print("=== SUCCESS: Dashboard synced and Slack message sent ===")
else:
    print(f"Slack error: {response.text}")
    sys.exit(1)
