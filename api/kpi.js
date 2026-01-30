const { BigQuery } = require('@google-cloud/bigquery');
const { Pool } = require('pg');

// Strict date validation to prevent injection
function validateDateString(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return null;
  // Only allow YYYY-MM-DD format with strict regex
  const dateRegex = /^(20\d{2})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
  if (!dateRegex.test(dateStr)) return null;
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return null;
  return dateStr;
}

// Allowed origins for CORS
const ALLOWED_ORIGINS = [
  'https://invest-board-seven.vercel.app',
  'https://invest-board-seven-eta.vercel.app',
  'http://localhost:3000',
  'http://127.0.0.1:3000'
];

// Calculate cohort retention for the last 2 months
async function calculateCohortRetention(bigquery, PROJECT, DATASET) {
  const now = new Date();
  const result = {};

  // Get last 2 months
  for (let i = 1; i <= 2; i++) {
    const cohortDate = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const cohortMonth = `${cohortDate.getFullYear()}-${String(cohortDate.getMonth() + 1).padStart(2, '0')}`;
    const cohortStartDate = cohortMonth + '-01';
    const cohortEndDate = new Date(cohortDate.getFullYear(), cohortDate.getMonth() + 1, 0).toISOString().slice(0, 10);

    try {
      // Get cohort users (first-time users in that month)
      const [cohortRows] = await bigquery.query({
        query: `WITH first_users AS (
                  SELECT COALESCE(phone, session_id) as user_id,
                         MIN(DATE(created_at, 'Asia/Seoul')) as first_date
                  FROM \`${PROJECT}.${DATASET}.free_saju_results\`
                  GROUP BY user_id
                  HAVING first_date BETWEEN '${cohortStartDate}' AND '${cohortEndDate}'
                )
                SELECT COUNT(DISTINCT user_id) as cohort_users
                FROM first_users`
      });

      const cohortUsers = parseInt(cohortRows[0]?.cohort_users) || 0;
      const prefix = `cohort${i}`;
      result[`${prefix}Month`] = cohortMonth;
      result[`${prefix}Users`] = cohortUsers;

      // Calculate monthly retention (M1 = next month, M2 = 2 months later, etc.)
      for (let m = 1; m <= 6; m++) {
        const retentionDate = new Date(cohortDate.getFullYear(), cohortDate.getMonth() + m, 1);
        if (retentionDate > now) break;

        const retentionStart = `${retentionDate.getFullYear()}-${String(retentionDate.getMonth() + 1).padStart(2, '0')}-01`;
        const retentionEnd = new Date(retentionDate.getFullYear(), retentionDate.getMonth() + 1, 0).toISOString().slice(0, 10);

        const [retRows] = await bigquery.query({
          query: `WITH first_users AS (
                    SELECT COALESCE(phone, session_id) as user_id,
                           MIN(DATE(created_at, 'Asia/Seoul')) as first_date
                    FROM \`${PROJECT}.${DATASET}.free_saju_results\`
                    GROUP BY user_id
                    HAVING first_date BETWEEN '${cohortStartDate}' AND '${cohortEndDate}'
                  ),
                  returning AS (
                    SELECT DISTINCT f.user_id
                    FROM first_users f
                    JOIN \`${PROJECT}.${DATASET}.free_saju_results\` e
                      ON COALESCE(e.phone, e.session_id) = f.user_id
                      AND DATE(e.created_at, 'Asia/Seoul') BETWEEN '${retentionStart}' AND '${retentionEnd}'
                  )
                  SELECT ROUND(COUNT(*) / NULLIF(${cohortUsers}, 0) * 100, 1) as retention
                  FROM returning`
        });

        result[`${prefix}M${m}`] = parseFloat(retRows[0]?.retention) || 0;
      }
    } catch (e) {
      console.log(`Cohort ${i} error:`, e.message);
    }
  }

  return result;
}

module.exports = async (req, res) => {
  // CORS headers - restrict to allowed origins
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGINS[0]);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  // Security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  // Disable caching for real-time data
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  try {
    // BigQuery setup
    const credentials = JSON.parse(
      Buffer.from(process.env.BIGQUERY_KEY, 'base64').toString('utf-8')
    );
    const bigquery = new BigQuery({ credentials, projectId: credentials.project_id });

    // Date range - accepts query parameters or defaults to last 30 days
    const { start, end } = req.query;

    let endDate, startDate;
    if (start && end) {
      // Validate and sanitize date inputs to prevent injection
      const validStart = validateDateString(start);
      const validEnd = validateDateString(end);
      if (!validStart || !validEnd) {
        return res.status(400).json({ success: false, error: 'Invalid date format. Use YYYY-MM-DD' });
      }
      startDate = new Date(validStart);
      endDate = new Date(validEnd);
      // Ensure start is before end
      if (startDate > endDate) {
        [startDate, endDate] = [endDate, startDate];
      }
      // Limit date range to prevent excessive queries (max 1 year)
      const maxRange = 365 * 24 * 60 * 60 * 1000;
      if (endDate - startDate > maxRange) {
        startDate = new Date(endDate - maxRange);
      }
    } else {
      // Default: last 30 days
      endDate = new Date();
      startDate = new Date(endDate - 30 * 24 * 60 * 60 * 1000);
    }

    const startDash = startDate.toISOString().slice(0, 10);
    const endDash = endDate.toISOString().slice(0, 10);

    const PROJECT = 'project-ddcf51fd-a5bd-4a6f-905';
    const DATASET = 'supabase_sync';
    // GA4 datasets:
    // - events_* tables: raw events from 2026-01-22 onwards
    // - ga4_historical_events: aggregated data from 2025-12-20 ~ 2026-01-21
    const GA4_PROJECT = PROJECT;
    const GA4_DATASET = 'analytics_515600551';
    const GA4_HISTORICAL_TABLE = 'ga4_historical_events';  // Historical aggregated data

    // KPI 정의서 v3.0 기준 데이터 구조
    // MAU 계층: Total MAU (전체 활성) > Paying MAU (유료 활성) > Free-only MAU
    // 리텐션 이원화: 방문 리텐션 (D1/D7/D30) + 거래 리텐션 (M1/M3/M6)
    const data = {
      // MAU 계층 구조 (KPI 정의서 섹션 2)
      mau: 0,              // Total MAU: 30일 내 핵심 행동을 한 모든 사용자
      payingMau: 0,        // Paying MAU: 결제 이력이 있고 30일 내 활동한 사용자
      freeOnlyMau: 0,      // Free-only MAU: Total MAU - Paying MAU
      payingRatio: 0,      // Paying Ratio: Paying MAU / Total MAU (%)

      // 매출 및 결제 지표
      revenue: 0,
      payingUsers: 0,      // 기간 내 결제한 유저 (=Paying MAU와 다를 수 있음)
      newPayingUsers: 0,   // 신규 유료 고객 (CAC 계산용)
      arppu: 0,            // ARPPU: 매출 / 유료 사용자 수

      // 전환율 (KPI 정의서 섹션 5)
      conversionRate: 0,   // Free-to-Paid Conversion: 유료 전환 사용자 / Total MAU

      // CAC (KPI 정의서 섹션 7) - Fully Loaded CAC
      cac: 0,
      fullyLoadedCac: 0,   // 마케팅 + 영업 + 무료 유저 지원 비용

      // LTV (KPI 정의서 섹션 6)
      ltv: 0,              // LTV = ARPPU × Customer Lifespan × Gross Margin
      ltvCac: 0,           // LTV:CAC Ratio

      // Customer Lifespan & Churn (KPI 정의서 섹션 6.3)
      customerLifespan: 3, // 고객 수명 (월)
      monthlyChurnRate: 0, // 월간 이탈률 (%)
      churnRate90d: 0,     // 90일 기준 Customer Churn

      // CAC Payback (KPI 정의서 섹션 8.4)
      cacPaybackMonths: 0,

      // ROAS & Margin
      roas: 0,
      grossMargin: 0,

      // 방문 리텐션 (Visit Retention) - KPI 정의서 섹션 3.3.1
      // 전체 사용자 대상, Day N에 핵심 행동 재수행 비율
      d1Retention: 0,      // D1 방문 리텐션
      d7Retention: 0,      // D7 방문 리텐션
      d30Retention: 0,     // D30 방문 리텐션

      // 거래 리텐션 (Transaction Retention) - KPI 정의서 섹션 3.3.2
      // 유료 사용자만 대상, 월간 재결제 비율 (투자자 Primary 보고 지표)
      m1Retention: 0,      // M1 거래 리텐션: 첫 결제 후 1개월 재결제
      m3Retention: 0,      // M3 거래 리텐션: 첫 결제 후 3개월 재결제
      m6Retention: 0,      // M6 거래 리텐션: 첫 결제 후 6개월 재결제

      // Stickiness & 재구매율 (KPI 정의서 섹션 4)
      stickiness: 0,       // DAU/MAU
      repurchaseRate: 0,   // 재구매율: 2회 이상 결제 / 전체 결제 고객

      // 메타데이터
      dataStart: startDash,
      dataEnd: endDash,
      engagedUsers: 0      // 핵심 행동 수행 사용자 (무료 사주 결과 조회)
    };

    // Format dates for GA4 table suffix (YYYYMMDD)
    const startSuffix = startDash.replace(/-/g, '');
    const endSuffix = endDash.replace(/-/g, '');

    // GA4 realtime data starts from 2026-01-22
    // GA4 historical aggregated data: 2025-12-20 ~ 2026-01-21
    // Use string comparison for dates to avoid timezone issues
    const GA4_START_STR = '2026-01-22';
    const GA4_HISTORICAL_START_STR = '2025-12-20';
    const GA4_HISTORICAL_END_STR = '2026-01-21';

    // Get MAU from GA4 sources (combines realtime + historical for true visitor count)
    let ga4RealtimeMau = 0;
    let ga4HistoricalMau = 0;

    // Query GA4 realtime if date range includes 2026-01-22+
    if (endDash >= GA4_START_STR) {
      try {
        const realtimeStartSuffix = startDash >= GA4_START_STR ? startSuffix : '20260122';
        const [realtimeResult] = await bigquery.query({
          query: `SELECT COUNT(DISTINCT user_pseudo_id) as mau
                  FROM \`${GA4_PROJECT}.${GA4_DATASET}.events_*\`
                  WHERE _TABLE_SUFFIX BETWEEN '${realtimeStartSuffix}' AND '${endSuffix}'`
        });
        ga4RealtimeMau = parseInt(realtimeResult[0]?.mau) || 0;
      } catch (e) {
        // GA4 realtime query failed, will use fallback
      }
    }

    // Calculate visitorRatio from GA4 realtime period
    // This ratio converts engaged users to estimated visitors
    // Default ~3.12 based on observed GA4 data
    let visitorRatio = 3.12;
    if (ga4RealtimeMau > 0) {
      try {
        const [realtimeEngaged] = await bigquery.query({
          query: `SELECT COUNT(DISTINCT COALESCE(phone, session_id)) as engaged
                  FROM \`${PROJECT}.${DATASET}.free_saju_results\`
                  WHERE DATE(created_at) >= '${GA4_START_STR}' AND DATE(created_at) <= '${endDash}'`
        });
        const rtEngaged = parseInt(realtimeEngaged[0]?.engaged) || 0;
        if (rtEngaged > 0) {
          visitorRatio = ga4RealtimeMau / rtEngaged;
        }
      } catch (e) {
        // Keep default ratio
      }
    }

    // Query GA4 historical if date range includes 2025-12-20 ~ 2026-01-21
    // Since ga4_historical_events has pre-aggregated dimension data, we use a ratio-based estimation
    const includesHistorical = startDash <= GA4_HISTORICAL_END_STR && endDash >= GA4_HISTORICAL_START_STR;

    if (includesHistorical) {
      try {
        // Get engaged users from historical period for ratio calculation
        const historicalStartDate = startDash < GA4_HISTORICAL_START_STR ? GA4_HISTORICAL_START_STR : startDash;
        const historicalEndDate = endDash > GA4_HISTORICAL_END_STR ? GA4_HISTORICAL_END_STR : endDash;

        const [historicalEngaged] = await bigquery.query({
          query: `SELECT COUNT(DISTINCT COALESCE(phone, session_id)) as engaged
                  FROM \`${PROJECT}.${DATASET}.free_saju_results\`
                  WHERE DATE(created_at) BETWEEN '${historicalStartDate}' AND '${historicalEndDate}'`
        });
        const histEngaged = parseInt(historicalEngaged[0]?.engaged) || 0;

        // Estimate historical MAU using the calculated ratio
        ga4HistoricalMau = Math.round(histEngaged * visitorRatio);
      } catch (e) {
        // GA4 historical query failed, will use fallback
      }
    }

    // Also estimate MAU for date range before GA4 historical data (before 2025-12-20)
    let preHistoricalMau = 0;
    const includesPreHistorical = startDash < GA4_HISTORICAL_START_STR;
    if (includesPreHistorical) {
      try {
        const preHistEndDate = endDash < GA4_HISTORICAL_START_STR ? endDash : '2025-12-19';
        const [engagedResult] = await bigquery.query({
          query: `SELECT COUNT(DISTINCT COALESCE(phone, session_id)) as engaged
                  FROM \`${PROJECT}.${DATASET}.free_saju_results\`
                  WHERE DATE(created_at) BETWEEN '${startDash}' AND '${preHistEndDate}'`
        });
        const engaged = parseInt(engagedResult[0]?.engaged) || 0;
        preHistoricalMau = Math.round(engaged * visitorRatio);
      } catch (e) {
        // Will use fallback
      }
    }

    // Combine all MAU sources (GA4 realtime + GA4 historical estimate + pre-historical estimate)
    data.mau = ga4RealtimeMau + ga4HistoricalMau + preHistoricalMau;

    // Fallback to free_saju_results with ratio if all sources returned 0
    if (data.mau === 0) {
      const [mauRows] = await bigquery.query({
        query: `SELECT COUNT(DISTINCT COALESCE(phone, session_id)) as engaged
                FROM \`${PROJECT}.${DATASET}.free_saju_results\`
                WHERE DATE(created_at) BETWEEN '${startDash}' AND '${endDash}'`
      });
      if (mauRows[0]) {
        const engaged = parseInt(mauRows[0].engaged) || 0;
        data.mau = Math.round(engaged * visitorRatio);
      }
    }

    // Query Engaged Users from free_saju_results (users who used free feature)
    const [engagedRows] = await bigquery.query({
      query: `SELECT COUNT(DISTINCT COALESCE(phone, session_id)) as engaged
              FROM \`${PROJECT}.${DATASET}.free_saju_results\`
              WHERE DATE(created_at) BETWEEN '${startDash}' AND '${endDash}'`
    });
    if (engagedRows[0]) data.engagedUsers = parseInt(engagedRows[0].engaged) || 0;

    // Query Revenue & Paying Users from orders
    const [revenueRows] = await bigquery.query({
      query: `SELECT
                SUM(total_amount) - SUM(IFNULL(cancelled_amount, 0)) as revenue,
                COUNT(DISTINCT customer_phone) as paying_users
              FROM \`${PROJECT}.${DATASET}.orders\`
              WHERE payment_status = 'PAID'
                AND DATE(created_at) BETWEEN '${startDash}' AND '${endDash}'`
    });
    if (revenueRows[0]) {
      data.revenue = parseInt(revenueRows[0].revenue) || 0;
      data.payingUsers = parseInt(revenueRows[0].paying_users) || 0;
    }

    // Paying MAU (KPI 정의서 섹션 2.2)
    // 결제 이력이 있고 30일 내 활동한 사용자
    try {
      const [payingMauRows] = await bigquery.query({
        query: `WITH paid_users AS (
                  SELECT DISTINCT customer_phone as phone
                  FROM \`${PROJECT}.${DATASET}.orders\`
                  WHERE payment_status = 'PAID'
                ),
                active_users AS (
                  SELECT DISTINCT COALESCE(phone, session_id) as user_id, phone
                  FROM \`${PROJECT}.${DATASET}.free_saju_results\`
                  WHERE DATE(created_at) BETWEEN '${startDash}' AND '${endDash}'
                )
                SELECT COUNT(DISTINCT a.phone) as paying_mau
                FROM active_users a
                JOIN paid_users p ON a.phone = p.phone
                WHERE a.phone IS NOT NULL`
      });
      if (payingMauRows[0]) {
        data.payingMau = parseInt(payingMauRows[0].paying_mau) || 0;
      }
    } catch (e) {
      console.log('Paying MAU query error:', e.message);
      data.payingMau = data.payingUsers; // Fallback
    }

    // Free-only MAU = Total MAU - Paying MAU
    data.freeOnlyMau = Math.max(0, data.mau - data.payingMau);

    // Paying Ratio = Paying MAU / Total MAU (%)
    if (data.mau > 0) {
      data.payingRatio = Math.round(data.payingMau / data.mau * 10000) / 100;
    }

    // Query NEW Paying Users (first-time customers in period) - for accurate CAC calculation
    // CAC = Ad Spend / NEW Customers (not all paying users)
    let newPayingUsers = 0;
    try {
      const [newPayingRows] = await bigquery.query({
        query: `WITH first_orders AS (
                  SELECT customer_phone,
                         MIN(DATE(created_at, 'Asia/Seoul')) as first_order_date
                  FROM \`${PROJECT}.${DATASET}.orders\`
                  WHERE payment_status = 'PAID'
                  GROUP BY customer_phone
                )
                SELECT COUNT(DISTINCT customer_phone) as new_customers
                FROM first_orders
                WHERE first_order_date BETWEEN '${startDash}' AND '${endDash}'`
      });
      if (newPayingRows[0]) {
        newPayingUsers = parseInt(newPayingRows[0].new_customers) || 0;
      }
    } catch (e) {
      console.log('New paying users query error:', e.message);
      newPayingUsers = data.payingUsers; // Fallback to all paying users
    }
    data.newPayingUsers = newPayingUsers;

    // D1 Retention - Calculate from free_saju_results (engaged users retention)
    // This is more meaningful than GA4 visitor retention for product metrics
    const [d1Rows] = await bigquery.query({
      query: `WITH user_first AS (
                SELECT COALESCE(phone, session_id) as user_id,
                       MIN(DATE(created_at, 'Asia/Seoul')) as first_date
                FROM \`${PROJECT}.${DATASET}.free_saju_results\`
                WHERE DATE(created_at) BETWEEN '${startDash}' AND '${endDash}'
                GROUP BY user_id
              ),
              d1_users AS (
                SELECT DISTINCT f.user_id
                FROM user_first f
                JOIN \`${PROJECT}.${DATASET}.free_saju_results\` e
                  ON COALESCE(e.phone, e.session_id) = f.user_id
                  AND DATE(e.created_at, 'Asia/Seoul') = DATE_ADD(f.first_date, INTERVAL 1 DAY)
              )
              SELECT ROUND(COUNT(DISTINCT d.user_id) / NULLIF(COUNT(DISTINCT f.user_id), 0) * 100, 2) as d1
              FROM user_first f
              LEFT JOIN d1_users d ON f.user_id = d.user_id`
    });
    if (d1Rows[0]) data.d1Retention = parseFloat(d1Rows[0].d1) || 0;

    // D7 Retention - Users who return 7 days after first use
    try {
      const [d7Rows] = await bigquery.query({
        query: `WITH user_first AS (
                  SELECT COALESCE(phone, session_id) as user_id,
                         MIN(DATE(created_at, 'Asia/Seoul')) as first_date
                  FROM \`${PROJECT}.${DATASET}.free_saju_results\`
                  WHERE DATE(created_at) BETWEEN '${startDash}' AND DATE_SUB('${endDash}', INTERVAL 7 DAY)
                  GROUP BY user_id
                ),
                d7_users AS (
                  SELECT DISTINCT f.user_id
                  FROM user_first f
                  JOIN \`${PROJECT}.${DATASET}.free_saju_results\` e
                    ON COALESCE(e.phone, e.session_id) = f.user_id
                    AND DATE(e.created_at, 'Asia/Seoul') = DATE_ADD(f.first_date, INTERVAL 7 DAY)
                )
                SELECT ROUND(COUNT(DISTINCT d.user_id) / NULLIF(COUNT(DISTINCT f.user_id), 0) * 100, 2) as d7
                FROM user_first f
                LEFT JOIN d7_users d ON f.user_id = d.user_id`
      });
      if (d7Rows[0]) data.d7Retention = parseFloat(d7Rows[0].d7) || 0;
    } catch (e) {
      console.log('D7 Retention query error:', e.message);
      data.d7Retention = 0;
    }

    // D30 Retention - Users who return 30 days after first use (투자자 필수 지표)
    try {
      const [d30Rows] = await bigquery.query({
        query: `WITH user_first AS (
                  SELECT COALESCE(phone, session_id) as user_id,
                         MIN(DATE(created_at, 'Asia/Seoul')) as first_date
                  FROM \`${PROJECT}.${DATASET}.free_saju_results\`
                  WHERE DATE(created_at) BETWEEN '${startDash}' AND DATE_SUB('${endDash}', INTERVAL 30 DAY)
                  GROUP BY user_id
                ),
                d30_users AS (
                  SELECT DISTINCT f.user_id
                  FROM user_first f
                  JOIN \`${PROJECT}.${DATASET}.free_saju_results\` e
                    ON COALESCE(e.phone, e.session_id) = f.user_id
                    AND DATE(e.created_at, 'Asia/Seoul') = DATE_ADD(f.first_date, INTERVAL 30 DAY)
                )
                SELECT ROUND(COUNT(DISTINCT d.user_id) / NULLIF(COUNT(DISTINCT f.user_id), 0) * 100, 2) as d30
                FROM user_first f
                LEFT JOIN d30_users d ON f.user_id = d.user_id`
      });
      if (d30Rows[0]) data.d30Retention = parseFloat(d30Rows[0].d30) || 0;
    } catch (e) {
      console.log('D30 Retention query error:', e.message);
      data.d30Retention = 0;
    }

    // Stickiness (DAU/MAU) - Calculate using GA4 data for true visitor stickiness
    let totalDau = 0;
    let dauDays = 0;

    // Get DAU from GA4 realtime if available
    if (endDash >= GA4_START_STR) {
      try {
        const realtimeStartSuffix = startDash >= GA4_START_STR ? startSuffix : '20260122';
        const [stickinessRows] = await bigquery.query({
          query: `WITH daily AS (
                    SELECT event_date as date,
                           COUNT(DISTINCT user_pseudo_id) as dau
                    FROM \`${GA4_PROJECT}.${GA4_DATASET}.events_*\`
                    WHERE _TABLE_SUFFIX BETWEEN '${realtimeStartSuffix}' AND '${endSuffix}'
                    GROUP BY date
                  )
                  SELECT SUM(dau) as total_dau, COUNT(*) as days FROM daily`
        });
        if (stickinessRows[0]) {
          totalDau += parseInt(stickinessRows[0].total_dau) || 0;
          dauDays += parseInt(stickinessRows[0].days) || 0;
        }
      } catch (e) { console.log('GA4 Stickiness error:', e.message); }
    }

    // Get DAU from GA4 historical if available
    if (startDash <= GA4_HISTORICAL_END_STR && endDash >= GA4_HISTORICAL_START_STR) {
      try {
        const historicalStartDate = startDash < GA4_HISTORICAL_START_STR ? '2025-12-20' : startDash;
        const historicalEndDate = endDash > GA4_HISTORICAL_END_STR ? '2026-01-21' : endDash;
        const [historicalDauRows] = await bigquery.query({
          query: `SELECT SUM(total_users) as total_dau, COUNT(DISTINCT date) as days
                  FROM \`${GA4_PROJECT}.${GA4_DATASET}.${GA4_HISTORICAL_TABLE}\`
                  WHERE PARSE_DATE('%Y%m%d', date) BETWEEN DATE('${historicalStartDate}') AND DATE('${historicalEndDate}')`
        });
        if (historicalDauRows[0]) {
          totalDau += parseInt(historicalDauRows[0].total_dau) || 0;
          dauDays += parseInt(historicalDauRows[0].days) || 0;
        }
      } catch (e) { console.log('GA4 historical DAU error:', e.message); }
    }

    // Calculate stickiness
    if (dauDays > 0 && data.mau > 0) {
      const avgDau = Math.round(totalDau / dauDays);
      data.stickiness = Math.round(avgDau / data.mau * 10000) / 100;
    }

    // Fallback Stickiness from free_saju_results if GA4 failed
    if (data.stickiness === 0 && data.mau > 0) {
      const [stickinessRows] = await bigquery.query({
        query: `WITH daily AS (
                  SELECT DATE(created_at, 'Asia/Seoul') as date,
                         COUNT(DISTINCT COALESCE(phone, session_id)) as dau
                  FROM \`${PROJECT}.${DATASET}.free_saju_results\`
                  WHERE DATE(created_at) BETWEEN '${startDash}' AND '${endDash}'
                  GROUP BY date
                )
                SELECT ROUND(AVG(dau), 0) as avg_dau FROM daily`
      });
      if (stickinessRows[0]) {
        const avgDau = parseInt(stickinessRows[0].avg_dau) || 0;
        data.stickiness = Math.round(avgDau / data.mau * 10000) / 100;
      }
    }

    // Repurchase Rate & Customer Metrics
    const [repurchaseRows] = await bigquery.query({
      query: `WITH order_stats AS (
                SELECT customer_phone, COUNT(*) as order_count
                FROM \`${PROJECT}.${DATASET}.orders\`
                WHERE payment_status = 'PAID'
                  AND DATE(created_at) BETWEEN '${startDash}' AND '${endDash}'
                GROUP BY customer_phone
              )
              SELECT
                ROUND(
                  COUNT(DISTINCT CASE WHEN order_count > 1 THEN customer_phone END) /
                  NULLIF(COUNT(DISTINCT customer_phone), 0) * 100, 2
                ) as repurchase,
                COUNT(DISTINCT CASE WHEN order_count > 1 THEN customer_phone END) as repurchase_customers,
                ROUND(AVG(order_count), 2) as avg_purchase_count
              FROM order_stats`
    });
    if (repurchaseRows[0]) {
      data.repurchaseRate = parseFloat(repurchaseRows[0].repurchase) || 0;
      data.repurchaseCustomers = parseInt(repurchaseRows[0].repurchase_customers) || 0;
      data.avgPurchaseCount = parseFloat(repurchaseRows[0].avg_purchase_count) || 1.0;
    }

    // Paid User D1 Retention (결제자 D1 리텐션)
    let paidD1Retention = 0;
    try {
      const [paidD1Rows] = await bigquery.query({
        query: `WITH paid_first AS (
                  SELECT customer_phone,
                         MIN(DATE(created_at, 'Asia/Seoul')) as first_date
                  FROM \`${PROJECT}.${DATASET}.orders\`
                  WHERE payment_status = 'PAID'
                    AND DATE(created_at) BETWEEN '${startDash}' AND '${endDash}'
                  GROUP BY customer_phone
                ),
                d1_paid AS (
                  SELECT DISTINCT f.customer_phone
                  FROM paid_first f
                  JOIN \`${PROJECT}.${DATASET}.free_saju_results\` e
                    ON e.phone = f.customer_phone
                    AND DATE(e.created_at, 'Asia/Seoul') = DATE_ADD(f.first_date, INTERVAL 1 DAY)
                )
                SELECT ROUND(COUNT(DISTINCT d.customer_phone) / NULLIF(COUNT(DISTINCT f.customer_phone), 0) * 100, 1) as paid_d1
                FROM paid_first f
                LEFT JOIN d1_paid d ON f.customer_phone = d.customer_phone`
      });
      if (paidD1Rows[0]?.paid_d1) paidD1Retention = parseFloat(paidD1Rows[0].paid_d1);
    } catch (e) {
      console.log('Paid D1 retention query error:', e.message);
    }
    data.paidD1Retention = paidD1Retention;

    // Transaction Retention M1/M3/M6 (거래 리텐션 - KPI 정의서 섹션 3.3.2)
    // 투자자 Primary 보고 지표: 첫 결제 월 기준, N개월 후 재결제 비율
    try {
      const [txRetentionRows] = await bigquery.query({
        query: `WITH first_payment_cohort AS (
                  SELECT
                    customer_phone,
                    DATE_FORMAT(MIN(DATE(created_at, 'Asia/Seoul')), '%Y-%m') as cohort_month,
                    MIN(DATE(created_at, 'Asia/Seoul')) as first_payment_date
                  FROM \`${PROJECT}.${DATASET}.orders\`
                  WHERE payment_status = 'PAID'
                  GROUP BY customer_phone
                ),
                monthly_payments AS (
                  SELECT DISTINCT
                    customer_phone,
                    DATE_FORMAT(DATE(created_at, 'Asia/Seoul'), '%Y-%m') as payment_month
                  FROM \`${PROJECT}.${DATASET}.orders\`
                  WHERE payment_status = 'PAID'
                ),
                cohort_stats AS (
                  SELECT
                    c.customer_phone,
                    c.cohort_month,
                    c.first_payment_date,
                    MAX(CASE WHEN DATE_DIFF(
                      PARSE_DATE('%Y-%m', p.payment_month),
                      PARSE_DATE('%Y-%m', c.cohort_month),
                      MONTH
                    ) = 1 THEN 1 ELSE 0 END) as m1_active,
                    MAX(CASE WHEN DATE_DIFF(
                      PARSE_DATE('%Y-%m', p.payment_month),
                      PARSE_DATE('%Y-%m', c.cohort_month),
                      MONTH
                    ) = 3 THEN 1 ELSE 0 END) as m3_active,
                    MAX(CASE WHEN DATE_DIFF(
                      PARSE_DATE('%Y-%m', p.payment_month),
                      PARSE_DATE('%Y-%m', c.cohort_month),
                      MONTH
                    ) = 6 THEN 1 ELSE 0 END) as m6_active
                  FROM first_payment_cohort c
                  LEFT JOIN monthly_payments p ON c.customer_phone = p.customer_phone
                  WHERE c.first_payment_date <= DATE_SUB(CURRENT_DATE(), INTERVAL 1 MONTH)
                  GROUP BY c.customer_phone, c.cohort_month, c.first_payment_date
                )
                SELECT
                  ROUND(SUM(m1_active) / NULLIF(COUNT(CASE WHEN first_payment_date <= DATE_SUB(CURRENT_DATE(), INTERVAL 1 MONTH) THEN customer_phone END), 0) * 100, 1) as m1_retention,
                  ROUND(SUM(m3_active) / NULLIF(COUNT(CASE WHEN first_payment_date <= DATE_SUB(CURRENT_DATE(), INTERVAL 3 MONTH) THEN customer_phone END), 0) * 100, 1) as m3_retention,
                  ROUND(SUM(m6_active) / NULLIF(COUNT(CASE WHEN first_payment_date <= DATE_SUB(CURRENT_DATE(), INTERVAL 6 MONTH) THEN customer_phone END), 0) * 100, 1) as m6_retention
                FROM cohort_stats`
      });
      if (txRetentionRows[0]) {
        data.m1Retention = parseFloat(txRetentionRows[0].m1_retention) || 0;
        data.m3Retention = parseFloat(txRetentionRows[0].m3_retention) || 0;
        data.m6Retention = parseFloat(txRetentionRows[0].m6_retention) || 0;
      }
    } catch (e) {
      console.log('Transaction retention query error:', e.message);
      // 데이터 부족 시 기본값 유지
    }

    // Churn Rate 90일 기준 (KPI 정의서 섹션 6.3)
    // 90일 내 재결제 없는 유료 사용자 비율
    try {
      const [churnRows] = await bigquery.query({
        query: `WITH active_customers_prev AS (
                  SELECT DISTINCT customer_phone
                  FROM \`${PROJECT}.${DATASET}.orders\`
                  WHERE payment_status = 'PAID'
                  AND DATE(created_at, 'Asia/Seoul') BETWEEN
                      DATE_SUB(DATE('${endDash}'), INTERVAL 120 DAY)
                      AND DATE_SUB(DATE('${endDash}'), INTERVAL 90 DAY)
                ),
                active_customers_curr AS (
                  SELECT DISTINCT customer_phone
                  FROM \`${PROJECT}.${DATASET}.orders\`
                  WHERE payment_status = 'PAID'
                  AND DATE(created_at, 'Asia/Seoul') >= DATE_SUB(DATE('${endDash}'), INTERVAL 90 DAY)
                )
                SELECT
                  COUNT(DISTINCT p.customer_phone) as prev_customers,
                  COUNT(DISTINCT c.customer_phone) as retained_customers,
                  ROUND(
                    (COUNT(DISTINCT p.customer_phone) - COUNT(DISTINCT c.customer_phone))
                    / NULLIF(COUNT(DISTINCT p.customer_phone), 0) * 100, 1
                  ) as churn_rate
                FROM active_customers_prev p
                LEFT JOIN active_customers_curr c ON p.customer_phone = c.customer_phone`
      });
      if (churnRows[0]?.churn_rate) {
        data.churnRate90d = parseFloat(churnRows[0].churn_rate);
        // 월간 이탈률 추정: 90일 이탈률을 월간으로 환산
        data.monthlyChurnRate = Math.round(data.churnRate90d / 3 * 10) / 10;
      }
    } catch (e) {
      console.log('Churn rate query error:', e.message);
    }

    // LLM Cost from BigQuery
    let aiCost = 0;
    try {
      const [llmCostRows] = await bigquery.query({
        query: `WITH costs AS (
                  SELECT
                    CASE
                      WHEN provider = 'anthropic' THEN
                        (prompt_tokens * 3 / 1000000) +
                        (completion_tokens * 15 / 1000000) +
                        (IFNULL(cache_read_tokens, 0) * 0.3 / 1000000) +
                        (IFNULL(cache_creation_tokens, 0) * 3.75 / 1000000)
                      WHEN provider = 'gemini' THEN
                        (prompt_tokens * 0.10 / 1000000) +
                        (completion_tokens * 0.40 / 1000000)
                      ELSE 0
                    END AS cost_usd
                  FROM \`${PROJECT}.${DATASET}.llm_request_logs\`
                  WHERE status = 'success'
                    AND DATE(created_at) BETWEEN '${startDash}' AND '${endDash}'
                )
                SELECT ROUND(SUM(cost_usd) * 1450, 0) as cost_krw FROM costs`
      });
      if (llmCostRows[0]?.cost_krw) aiCost = parseInt(llmCostRows[0].cost_krw);
    } catch (e) {
      console.log('LLM cost query error:', e.message);
    }

    // PostgreSQL for ad spend
    let adSpend = 52960184;
    let pool = null;
    let client = null;
    try {
      pool = new Pool({
        host: 'aws-1-ap-northeast-2.pooler.supabase.com',
        port: 6543,
        database: 'postgres',
        user: 'postgres.jlutbjmjpreauyanjzdd',
        password: process.env.SUPABASE_PASSWORD,
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 10000,
        max: 1
      });
      client = await pool.connect();

      const adResult = await client.query(
        'SELECT SUM(spend) FROM adset_performance WHERE performance_date BETWEEN $1 AND $2',
        [startDate, endDate]
      );
      if (adResult.rows[0]?.sum) adSpend = parseFloat(adResult.rows[0].sum);
    } catch (e) {
      console.log('PostgreSQL error, using defaults:', e.message);
    } finally {
      // Ensure proper cleanup
      if (client) {
        try { client.release(); } catch (e) { /* ignore */ }
      }
      if (pool) {
        try { await pool.end(); } catch (e) { /* ignore */ }
      }
    }

    // Calculate derived metrics
    if (data.revenue && data.payingUsers) {
      data.arppu = Math.round(data.revenue / data.payingUsers);
    }
    if (data.mau && data.payingUsers) {
      data.conversionRate = Math.round(data.payingUsers / data.mau * 10000) / 100;
    }

    // CAC Calculation (KPI 정의서 섹션 7)
    // Working CAC = 광고비만 / 신규 유료 고객 (마케팅 효율 분석용)
    // Fully Loaded CAC = (마케팅 + 영업 + 무료 유저 지원 비용) / 신규 유료 고객 (투자자 보고용)

    // Working CAC (광고비 기준)
    if (data.newPayingUsers && adSpend) {
      data.cac = Math.round(adSpend / data.newPayingUsers);
    } else if (data.payingUsers && adSpend) {
      data.cac = Math.round(adSpend / data.payingUsers);
    }

    // Fully Loaded CAC (KPI 정의서 섹션 7.2)
    // 무료 유저 지원 비용 = 총 운영 비용 × (Free-only MAU / Total MAU)
    const freeUserRatio = data.mau > 0 ? data.freeOnlyMau / data.mau : 0.95; // 기본 95%
    const estimatedOperatingCost = aiCost; // AI 비용을 운영 비용의 주요 항목으로 사용
    const freeUserSupportCost = Math.round(estimatedOperatingCost * freeUserRatio);

    if (data.newPayingUsers > 0) {
      data.fullyLoadedCac = Math.round((adSpend + freeUserSupportCost) / data.newPayingUsers);
    } else if (data.payingUsers > 0) {
      data.fullyLoadedCac = Math.round((adSpend + freeUserSupportCost) / data.payingUsers);
    } else {
      data.fullyLoadedCac = data.cac;
    }

    // LTV Calculation (KPI 정의서 섹션 6.2)
    // 투자자 표준 공식: LTV = ARPPU × Customer Lifespan × Gross Margin
    // Customer Lifespan = 1 / Monthly Churn Rate

    // Customer Lifespan 계산 우선순위:
    // 1. 실제 Churn Rate 90일 데이터 사용
    // 2. 거래 리텐션(M1) 기반 추정
    // 3. 재구매율 기반 추정
    // 4. 기본값 3개월 (초기 스타트업 보수적 추정)

    let customerLifespanMonths = 3; // Default conservative estimate

    if (data.monthlyChurnRate > 0) {
      // 실제 Churn Rate 데이터 사용 (가장 정확)
      customerLifespanMonths = Math.min(24, 1 / (data.monthlyChurnRate / 100));
    } else if (data.m1Retention > 0) {
      // 거래 리텐션 M1 기반 추정
      // M1 리텐션이 높을수록 고객 수명이 김
      const monthlyChurn = Math.max(0.1, 1 - (data.m1Retention / 100));
      customerLifespanMonths = Math.min(24, 1 / monthlyChurn);
    } else if (data.repurchaseRate > 0) {
      // 재구매율 기반 추정 (Fallback)
      const monthlyChurn = Math.max(0.1, 1 - (data.repurchaseRate / 100));
      customerLifespanMonths = Math.min(24, 1 / monthlyChurn);
    }
    data.customerLifespan = Math.round(customerLifespanMonths * 10) / 10;

    // LTV = ARPPU × Customer Lifespan × Gross Margin (KPI 정의서 공식)
    // Gross Margin 반영하여 실제 기여 이익 기반 LTV 계산
    if (data.arppu) {
      const grossMarginDecimal = (data.grossMargin || 70) / 100; // 기본 70%
      data.ltv = Math.round(data.arppu * customerLifespanMonths * grossMarginDecimal);
    }

    // LTV:CAC Ratio (투자자 핵심 지표)
    // Standard: 3:1 minimum, 5:1 healthy
    if (data.ltv && data.cac) {
      data.ltvCac = Math.round(data.ltv / data.cac * 100) / 100;
    }

    // ROAS (Blended) - Uses total revenue, not attributed revenue
    // Note: This is "Blended ROAS" including organic conversions
    if (data.revenue && adSpend) {
      data.roas = Math.round(data.revenue / adSpend * 100) / 100;
    }

    // Gross Margin
    if (data.revenue && aiCost) {
      data.grossMargin = Math.round((1 - aiCost / data.revenue) * 1000) / 10;
    } else {
      data.grossMargin = 85; // default if no AI cost data
    }

    // CAC Payback Period (months) - 투자자 핵심 지표
    // Payback = CAC / (Monthly ARPPU × Gross Margin)
    if (data.cac && data.arppu && data.grossMargin) {
      const monthlyGrossProfit = data.arppu * (data.grossMargin / 100);
      data.cacPaybackMonths = monthlyGrossProfit > 0 ? Math.round(data.cac / monthlyGrossProfit * 10) / 10 : 0;
    }

    // ARR
    data.arr = data.revenue * 12;
    data.adSpend = adSpend;
    data.aiCost = aiCost;
    data.freeUserSupportCost = freeUserSupportCost; // 무료 유저 지원 비용

    // Funnel data (funnelFreeComplete = engagedUsers)
    data.funnelFreeComplete = data.engagedUsers;
    data.funnelAdClicks = data.mau;  // Ad clicks = MAU (visitors)

    // KPI 정의서 v3.0 벤치마크 기준 (Consumer Transactional)
    // 투자자에게 보고할 때 사용하는 기준값들
    data.benchmarks = {
      category: 'Consumer Transactional',
      source: 'Lenny Rachitsky',
      visitRetention: {
        d1: { poor: 15, average: 25, good: 35, great: 40 },
        d7: { poor: 5, average: 10, good: 15, great: 20 },
        d30: { poor: 3, average: 6, good: 10, great: 15 },
        month6: { poor: 10, average: 20, good: 30, great: 50 }
      },
      transactionRetention: {
        m1: { poor: 10, average: 20, good: 25, great: 30 },
        m3: { poor: 5, average: 15, good: 20, great: 25 },
        m6: { poor: 3, average: 10, good: 15, great: 20 }
      },
      conversion: { poor: 2, average: 3, good: 5, great: 8 },
      ltvCac: { preseed: 1.5, seed: 2, seriesA: 3, ideal: 5 },
      stickiness: { good: 20, great: 35 },
      repurchase: { belowAvg: 20, good: 40, excellent: 50 }
    };

    // Cohort Retention Data (last 2 months)
    try {
      const cohortData = await calculateCohortRetention(bigquery, PROJECT, DATASET);
      Object.assign(data, cohortData);
    } catch (e) {
      console.log('Cohort calculation error:', e.message);
    }

    res.status(200).json({ success: true, data, updatedAt: new Date().toISOString() });

  } catch (error) {
    console.error('API Error:', error);
    // Don't expose internal error details to clients
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};
