import os
import sys
import json
import requests
from datetime import datetime
from pathlib import Path

print("=== Starting Slack Report ===")

# Step 1: First call the dashboard API to refresh data
DASHBOARD_API = "https://invest-board-seven.vercel.app/api/kpi"
PREV_DATA_FILE = Path(__file__).parent / "previous_data.json"

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

# Step 2: Load previous data for comparison
print("Step 2: Loading previous data for comparison...")
prev_data = None
try:
    if PREV_DATA_FILE.exists():
        with open(PREV_DATA_FILE, 'r', encoding='utf-8') as f:
            prev_data = json.load(f)
        print(f"Previous data loaded: {prev_data.get('dataEnd', 'N/A')}")
    else:
        print("No previous data found (first run)")
except Exception as e:
    print(f"Failed to load previous data: {e}")

# Step 3: Calculate changes
def calc_change(current, previous, is_inverse=False):
    """Calculate change and return emoji indicator"""
    if previous is None or previous == 0:
        return "", ""

    diff = current - previous
    pct = (diff / previous) * 100

    if abs(pct) < 0.1:
        return "→", f"({pct:+.1f}%)"

    # For inverse metrics (like CAC), down is good
    if is_inverse:
        if diff < 0:
            return ":small_red_triangle_down:", f"({pct:+.1f}%)"  # down is good for CAC
        else:
            return ":small_red_triangle:", f"({pct:+.1f}%)"
    else:
        if diff > 0:
            return ":small_red_triangle:", f"({pct:+.1f}%)"  # up is good
        else:
            return ":small_red_triangle_down:", f"({pct:+.1f}%)"

def format_with_change(label, value, prev_value, format_str, is_inverse=False):
    """Format value with change indicator"""
    emoji, change = calc_change(value, prev_value, is_inverse)
    if change:
        return f"{label}\n{format_str} {emoji} {change}"
    return f"{label}\n{format_str}"

# Get previous values
prev_revenue = prev_data.get('revenue') if prev_data else None
prev_mau = prev_data.get('mau') if prev_data else None
prev_arppu = prev_data.get('arppu') if prev_data else None
prev_paying = prev_data.get('payingUsers') if prev_data else None
prev_roas = prev_data.get('roas') if prev_data else None
prev_ltvcac = prev_data.get('ltvCac') if prev_data else None
prev_gm = prev_data.get('grossMargin') if prev_data else None
prev_conv = prev_data.get('conversionRate') if prev_data else None
prev_d1 = prev_data.get('d1Retention') if prev_data else None
prev_sticky = prev_data.get('stickiness') if prev_data else None
prev_cac = prev_data.get('cac') if prev_data else None
prev_repurchase = prev_data.get('repurchaseRate') if prev_data else None

# Step 4: Build Slack message with comparisons
print("Step 3: Building Slack message with comparisons...")

now_str = datetime.now().strftime("%Y-%m-%d %H:%M")
start_dash = data['dataStart']
end_dash = data['dataEnd']

# Calculate change indicators
rev_emoji, rev_change = calc_change(data['revenue'], prev_revenue)
mau_emoji, mau_change = calc_change(data['mau'], prev_mau)
arppu_emoji, arppu_change = calc_change(data['arppu'], prev_arppu)
paying_emoji, paying_change = calc_change(data['payingUsers'], prev_paying)
roas_emoji, roas_change = calc_change(data['roas'], prev_roas)
ltvcac_emoji, ltvcac_change = calc_change(data['ltvCac'], prev_ltvcac)
gm_emoji, gm_change = calc_change(data['grossMargin'], prev_gm)
conv_emoji, conv_change = calc_change(data['conversionRate'], prev_conv)
d1_emoji, d1_change = calc_change(data['d1Retention'], prev_d1)
sticky_emoji, sticky_change = calc_change(data['stickiness'], prev_sticky)
cac_emoji, cac_change = calc_change(data['cac'], prev_cac, is_inverse=True)
repurchase_emoji, repurchase_change = calc_change(data['repurchaseRate'], prev_repurchase)

# Format values with changes
def fmt_with_change(value, emoji, change):
    if change:
        return f"{value} {emoji}{change}"
    return value

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
                {"type": "mrkdwn", "text": f":moneybag: *월 매출 (MRR)*\n₩{data['revenue']:,} {rev_emoji}{rev_change}"},
                {"type": "mrkdwn", "text": f":busts_in_silhouette: *MAU*\n{data['mau']:,}명 {mau_emoji}{mau_change}"}
            ]
        },
        {
            "type": "section",
            "fields": [
                {"type": "mrkdwn", "text": f":dollar: *ARPPU*\n₩{data['arppu']:,} {arppu_emoji}{arppu_change}"},
                {"type": "mrkdwn", "text": f":shopping_cart: *결제 유저*\n{data['payingUsers']:,}명 {paying_emoji}{paying_change}"}
            ]
        },
        {"type": "divider"},
        {
            "type": "section",
            "fields": [
                {"type": "mrkdwn", "text": f":chart_with_upwards_trend: *ROAS*\n{data['roas']}x {roas_emoji}{roas_change}"},
                {"type": "mrkdwn", "text": f":chart: *LTV/CAC*\n{data['ltvCac']}x {ltvcac_emoji}{ltvcac_change}"}
            ]
        },
        {
            "type": "section",
            "fields": [
                {"type": "mrkdwn", "text": f":bar_chart: *Gross Margin*\n{data['grossMargin']}% {gm_emoji}{gm_change}"},
                {"type": "mrkdwn", "text": f":arrows_counterclockwise: *전환율*\n{data['conversionRate']}% {conv_emoji}{conv_change}"}
            ]
        },
        {"type": "divider"},
        {
            "type": "section",
            "fields": [
                {"type": "mrkdwn", "text": f":date: *D1 리텐션*\n{data['d1Retention']}% {d1_emoji}{d1_change}"},
                {"type": "mrkdwn", "text": f":zap: *Stickiness*\n{data['stickiness']}% {sticky_emoji}{sticky_change}"}
            ]
        },
        {
            "type": "section",
            "fields": [
                {"type": "mrkdwn", "text": f":dart: *CAC*\n₩{data['cac']:,} {cac_emoji}{cac_change}"},
                {"type": "mrkdwn", "text": f":repeat: *재구매율*\n{data['repurchaseRate']}% {repurchase_emoji}{repurchase_change}"}
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

# Step 5: Send Slack message
print("Step 4: Sending Slack message...")

slack_url = os.environ.get("SLACK_WEBHOOK_URL")
if not slack_url:
    print("ERROR: SLACK_WEBHOOK_URL not set")
    sys.exit(1)

response = requests.post(slack_url, json=payload, timeout=30)
print(f"Slack response: {response.status_code}")

if response.status_code != 200:
    print(f"Slack error: {response.text}")
    sys.exit(1)

# Step 6: Save current data as previous for next run
print("Step 5: Saving current data for next comparison...")
try:
    with open(PREV_DATA_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"Data saved to {PREV_DATA_FILE}")
except Exception as e:
    print(f"Warning: Failed to save data: {e}")

print("=== SUCCESS: Dashboard synced and Slack message sent ===")
