import os
import sys
import json
import requests
import psycopg2
from datetime import datetime, timedelta

print("=== Starting Slack Report ===")

# Configuration
DASHBOARD_API = "https://invest-board-seven.vercel.app/api/kpi"

# Step 1: Fetch current data from API
print("Step 1: Fetching dashboard data...")
try:
    api_response = requests.get(DASHBOARD_API, timeout=60)
    api_data = api_response.json()

    if not api_data.get('success'):
        print(f"API Error: {api_data.get('error')}")
        sys.exit(1)

    data = api_data['data']
    print(f"Data fetched: {data['dataStart']} ~ {data['dataEnd']}")
    print(f"MAU: {data['mau']:,}, Revenue: {data['revenue']:,}")

except Exception as e:
    print(f"Failed to fetch data: {e}")
    sys.exit(1)

# Step 2: Connect to Supabase and get previous data
print("Step 2: Connecting to Supabase...")
prev_data = None
try:
    conn = psycopg2.connect(
        host='aws-1-ap-northeast-2.pooler.supabase.com',
        port=6543,
        database='postgres',
        user='postgres.jlutbjmjpreauyanjzdd',
        password=os.environ.get('SUPABASE_PASSWORD'),
        connect_timeout=10
    )
    cursor = conn.cursor()

    # Get previous day's data
    cursor.execute("""
        SELECT mau, revenue, paying_users, arppu, conversion_rate, cac, ltv, ltv_cac,
               roas, gross_margin, d1_retention, stickiness, repurchase_rate, recorded_at
        FROM kpi_history
        ORDER BY recorded_at DESC
        LIMIT 1
    """)
    row = cursor.fetchone()

    if row:
        prev_data = {
            'mau': row[0], 'revenue': row[1], 'payingUsers': row[2], 'arppu': row[3],
            'conversionRate': row[4], 'cac': row[5], 'ltv': row[6], 'ltvCac': row[7],
            'roas': row[8], 'grossMargin': row[9], 'd1Retention': row[10],
            'stickiness': row[11], 'repurchaseRate': row[12], 'recordedAt': row[13]
        }
        print(f"Previous data loaded from: {prev_data['recordedAt']}")
    else:
        print("No previous data found in database")

except Exception as e:
    print(f"Supabase connection error: {e}")
    print("Continuing without comparison data...")

# Step 3: Calculate changes
def calc_change(current, previous, is_inverse=False):
    """Calculate change and return emoji + percentage"""
    if previous is None or previous == 0:
        return "", ""

    diff = current - float(previous)
    pct = (diff / float(previous)) * 100

    if abs(pct) < 0.5:
        return "➡️", f"({pct:+.1f}%)"

    if is_inverse:  # Lower is better (CAC)
        if diff < 0:
            return "✅", f"({pct:+.1f}%)"
        else:
            return "⚠️", f"({pct:+.1f}%)"
    else:  # Higher is better
        if diff > 0:
            return "📈", f"({pct:+.1f}%)"
        else:
            return "📉", f"({pct:+.1f}%)"

# Calculate all changes
changes = {}
metrics = ['mau', 'revenue', 'arppu', 'payingUsers', 'roas', 'ltvCac', 'grossMargin',
           'conversionRate', 'd1Retention', 'stickiness', 'repurchaseRate']
inverse_metrics = ['cac']

for m in metrics:
    prev_val = prev_data.get(m) if prev_data else None
    changes[m] = calc_change(data.get(m, 0), prev_val)

for m in inverse_metrics:
    prev_val = prev_data.get(m) if prev_data else None
    changes[m] = calc_change(data.get(m, 0), prev_val, is_inverse=True)

# Step 4: Generate investor summary comment
print("Step 3: Generating investor summary...")

def generate_investor_comment(data, prev_data, changes):
    """Generate AI-like investor summary based on metrics"""
    comments = []

    # Revenue trend
    if prev_data and prev_data.get('revenue'):
        rev_change = (data['revenue'] - prev_data['revenue']) / prev_data['revenue'] * 100
        if rev_change > 5:
            comments.append(f"📊 MRR {rev_change:.1f}% 성장 - 긍정적 트렌드")
        elif rev_change < -5:
            comments.append(f"⚠️ MRR {rev_change:.1f}% 하락 - 원인 분석 필요")

    # LTV/CAC analysis
    ltv_cac = data.get('ltvCac', 0)
    if ltv_cac >= 3:
        comments.append(f"✅ LTV/CAC {ltv_cac}x - 투자 적격 수준")
    elif ltv_cac >= 2:
        comments.append(f"🟡 LTV/CAC {ltv_cac}x - 양호, 3x 목표 추진")
    else:
        comments.append(f"⚠️ LTV/CAC {ltv_cac}x - 3x 미달, CAC 최적화 필요")

    # Retention analysis
    d1 = data.get('d1Retention', 0)
    if d1 < 10:
        comments.append(f"🔴 D1 리텐션 {d1}% - PMF 재검토 권장")

    # Gross Margin
    gm = data.get('grossMargin', 0)
    if gm >= 80:
        comments.append(f"✅ Gross Margin {gm}% - 우수한 수익구조")
    elif gm < 70:
        comments.append(f"⚠️ Gross Margin {gm}% - 비용구조 개선 필요")

    # Repurchase rate
    repurchase = data.get('repurchaseRate', 0)
    if repurchase < 5:
        comments.append(f"📌 재구매율 {repurchase}% - 고객 락인 전략 필요")

    if not comments:
        comments.append("📊 전체적으로 안정적인 지표 유지 중")

    return " | ".join(comments[:3])  # Max 3 comments

investor_comment = generate_investor_comment(data, prev_data, changes)

# Step 5: Build Slack message
print("Step 4: Building Slack message...")

now_str = datetime.now().strftime("%Y-%m-%d %H:%M")

def fmt(emoji, change):
    if emoji and change:
        return f" {emoji}{change}"
    return ""

payload = {
    "blocks": [
        {
            "type": "header",
            "text": {"type": "plain_text", "text": "📊 투자 대시보드 일간 리포트", "emoji": True}
        },
        {
            "type": "context",
            "elements": [{"type": "mrkdwn", "text": f"*{now_str}* | 데이터: {data['dataStart']} ~ {data['dataEnd']}"}]
        },
        {"type": "divider"},
        {
            "type": "section",
            "fields": [
                {"type": "mrkdwn", "text": f"💰 *MRR*\n₩{data['revenue']:,}{fmt(*changes['revenue'])}"},
                {"type": "mrkdwn", "text": f"👥 *MAU*\n{data['mau']:,}명{fmt(*changes['mau'])}"}
            ]
        },
        {
            "type": "section",
            "fields": [
                {"type": "mrkdwn", "text": f"💵 *ARPPU*\n₩{data['arppu']:,}{fmt(*changes['arppu'])}"},
                {"type": "mrkdwn", "text": f"🛒 *결제 유저*\n{data['payingUsers']:,}명{fmt(*changes['payingUsers'])}"}
            ]
        },
        {"type": "divider"},
        {
            "type": "section",
            "fields": [
                {"type": "mrkdwn", "text": f"📈 *ROAS*\n{data['roas']}x{fmt(*changes['roas'])}"},
                {"type": "mrkdwn", "text": f"📊 *LTV/CAC*\n{data['ltvCac']}x{fmt(*changes['ltvCac'])}"}
            ]
        },
        {
            "type": "section",
            "fields": [
                {"type": "mrkdwn", "text": f"💹 *Gross Margin*\n{data['grossMargin']}%{fmt(*changes['grossMargin'])}"},
                {"type": "mrkdwn", "text": f"🔄 *전환율*\n{data['conversionRate']}%{fmt(*changes['conversionRate'])}"}
            ]
        },
        {"type": "divider"},
        {
            "type": "section",
            "fields": [
                {"type": "mrkdwn", "text": f"📅 *D1 리텐션*\n{data['d1Retention']}%{fmt(*changes['d1Retention'])}"},
                {"type": "mrkdwn", "text": f"⚡ *Stickiness*\n{data['stickiness']}%{fmt(*changes['stickiness'])}"}
            ]
        },
        {
            "type": "section",
            "fields": [
                {"type": "mrkdwn", "text": f"🎯 *CAC*\n₩{data['cac']:,}{fmt(*changes['cac'])}"},
                {"type": "mrkdwn", "text": f"🔁 *재구매율*\n{data['repurchaseRate']}%{fmt(*changes['repurchaseRate'])}"}
            ]
        },
        {"type": "divider"},
        {
            "type": "section",
            "text": {"type": "mrkdwn", "text": f"*🤖 투자자 인사이트*\n{investor_comment}"}
        },
        {"type": "divider"},
        {
            "type": "actions",
            "elements": [{
                "type": "button",
                "text": {"type": "plain_text", "text": "📊 대시보드 보기", "emoji": True},
                "url": "https://invest-board-seven.vercel.app/",
                "style": "primary"
            }]
        }
    ]
}

# Step 6: Send Slack message
print("Step 5: Sending Slack message...")

slack_url = os.environ.get("SLACK_WEBHOOK_URL")
if not slack_url:
    print("ERROR: SLACK_WEBHOOK_URL not set")
    sys.exit(1)

response = requests.post(slack_url, json=payload, timeout=30)
print(f"Slack response: {response.status_code}")

if response.status_code != 200:
    print(f"Slack error: {response.text}")
    sys.exit(1)

# Step 7: Save current data to Supabase for next comparison
print("Step 6: Saving data to Supabase...")
try:
    if conn:
        cursor.execute("""
            INSERT INTO kpi_history
            (data_start, data_end, mau, revenue, paying_users, arppu, conversion_rate,
             cac, ltv, ltv_cac, roas, gross_margin, d1_retention, stickiness,
             repurchase_rate, arr, ad_spend, ai_cost)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """, (
            data['dataStart'], data['dataEnd'], data['mau'], data['revenue'],
            data['payingUsers'], data['arppu'], data['conversionRate'],
            data['cac'], data.get('ltv', data['arppu']), data['ltvCac'], data['roas'],
            data['grossMargin'], data['d1Retention'], data['stickiness'],
            data['repurchaseRate'], data['arr'], data['adSpend'], data['aiCost']
        ))
        conn.commit()
        print("Data saved to kpi_history table")
        cursor.close()
        conn.close()
except Exception as e:
    print(f"Failed to save data: {e}")

print("=== SUCCESS: Dashboard synced and Slack message sent ===")
