const { BigQuery } = require('@google-cloud/bigquery');
const { Pool } = require('pg');

module.exports = async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

  try {
    // BigQuery setup
    const credentials = JSON.parse(
      Buffer.from(process.env.BIGQUERY_KEY, 'base64').toString('utf-8')
    );
    const bigquery = new BigQuery({ credentials, projectId: credentials.project_id });

    // Date range (last 30 days)
    const endDate = new Date();
    const startDate = new Date(endDate - 30 * 24 * 60 * 60 * 1000);
    const startStr = startDate.toISOString().slice(0, 10).replace(/-/g, '');
    const endStr = endDate.toISOString().slice(0, 10).replace(/-/g, '');
    const startDash = startDate.toISOString().slice(0, 10);
    const endDash = endDate.toISOString().slice(0, 10);

    // KPI 정의서 v3.0 기준 데이터 구조
    const data = {
      // MAU 계층 구조
      mau: 0,
      payingMau: 0,
      freeOnlyMau: 0,
      payingRatio: 0,

      // 매출 지표
      revenue: 0,
      payingUsers: 0,
      newPayingUsers: 0,
      arppu: 0,
      arr: 0,

      // 전환율
      conversionRate: 0,

      // Unit Economics
      cac: 0,
      fullyLoadedCac: 0,
      ltv: 0,
      ltvCac: 0,
      customerLifespan: 3,
      cacPaybackMonths: 0,

      // ROAS & Margin
      roas: 0,
      grossMargin: 0,

      // 방문 리텐션
      d1Retention: 0,
      d7Retention: 0,
      d30Retention: 0,

      // 거래 리텐션
      m1Retention: 0,
      m3Retention: 0,
      m6Retention: 0,

      // Stickiness & 재구매
      stickiness: 0,
      repurchaseRate: 0,

      // Churn
      monthlyChurnRate: 0,
      churnRate90d: 0,

      // 메타데이터
      dataStart: startDash,
      dataEnd: endDash,
      engagedUsers: 0
    };

    // Query MAU from GA4
    try {
      const [mauRows] = await bigquery.query({
        query: `SELECT COUNT(DISTINCT user_pseudo_id) as mau
                FROM \`cheongimun.analytics_515600551.events_*\`
                WHERE _TABLE_SUFFIX BETWEEN '${startStr}' AND '${endStr}'`
      });
      if (mauRows[0]) data.mau = parseInt(mauRows[0].mau) || 0;
    } catch (e) {
      console.log('MAU query error:', e.message);
    }

    // Query Revenue & Paying Users
    try {
      const [revenueRows] = await bigquery.query({
        query: `SELECT SUM(total_amount) as revenue, COUNT(DISTINCT customer_phone) as paying_users
                FROM \`cheongimun.supabase_sync.orders\`
                WHERE payment_status = 'PAID' AND DATE(created_at) BETWEEN '${startDash}' AND '${endDash}'`
      });
      if (revenueRows[0]) {
        data.revenue = parseInt(revenueRows[0].revenue) || 0;
        data.payingUsers = parseInt(revenueRows[0].paying_users) || 0;
      }
    } catch (e) {
      console.log('Revenue query error:', e.message);
    }

    // Query Engaged Users (핵심 행동 수행자)
    try {
      const [engagedRows] = await bigquery.query({
        query: `SELECT COUNT(DISTINCT COALESCE(phone, session_id)) as engaged
                FROM \`cheongimun.supabase_sync.free_saju_results\`
                WHERE DATE(created_at) BETWEEN '${startDash}' AND '${endDash}'`
      });
      if (engagedRows[0]) data.engagedUsers = parseInt(engagedRows[0].engaged) || 0;
    } catch (e) {
      console.log('Engaged users query error:', e.message);
    }

    // Paying MAU (결제 이력 있고 30일 내 활동)
    try {
      const [payingMauRows] = await bigquery.query({
        query: `SELECT COUNT(DISTINCT o.customer_phone) as paying_mau
                FROM \`cheongimun.supabase_sync.orders\` o
                WHERE o.payment_status = 'PAID'
                AND EXISTS (
                  SELECT 1 FROM \`cheongimun.supabase_sync.free_saju_results\` f
                  WHERE f.phone = o.customer_phone
                  AND DATE(f.created_at) BETWEEN '${startDash}' AND '${endDash}'
                )`
      });
      if (payingMauRows[0]) {
        data.payingMau = parseInt(payingMauRows[0].paying_mau) || 0;
      }
    } catch (e) {
      console.log('Paying MAU query error:', e.message);
      data.payingMau = data.payingUsers; // Fallback
    }

    // Free-only MAU
    data.freeOnlyMau = Math.max(0, data.mau - data.payingMau);

    // Paying Ratio
    if (data.mau > 0) {
      data.payingRatio = Math.round(data.payingMau / data.mau * 10000) / 100;
    }

    // D1 Retention
    try {
      const [d1Rows] = await bigquery.query({
        query: `WITH user_first AS (
                  SELECT user_pseudo_id, MIN(PARSE_DATE('%Y%m%d', event_date)) as first_date
                  FROM \`cheongimun.analytics_515600551.events_*\`
                  WHERE _TABLE_SUFFIX BETWEEN '${startStr}' AND '${endStr}'
                  GROUP BY user_pseudo_id
                ),
                d1 AS (
                  SELECT DISTINCT f.user_pseudo_id
                  FROM user_first f
                  JOIN \`cheongimun.analytics_515600551.events_*\` e
                    ON f.user_pseudo_id = e.user_pseudo_id
                    AND PARSE_DATE('%Y%m%d', e.event_date) = DATE_ADD(f.first_date, INTERVAL 1 DAY)
                  WHERE e._TABLE_SUFFIX BETWEEN '${startStr}' AND '${endStr}'
                )
                SELECT ROUND(COUNT(DISTINCT d.user_pseudo_id) / NULLIF(COUNT(DISTINCT f.user_pseudo_id), 0) * 100, 2) as d1
                FROM user_first f LEFT JOIN d1 d ON f.user_pseudo_id = d.user_pseudo_id`
      });
      if (d1Rows[0]) data.d1Retention = parseFloat(d1Rows[0].d1) || 0;
    } catch (e) {
      console.log('D1 Retention query error:', e.message);
    }

    // D7 Retention
    try {
      const [d7Rows] = await bigquery.query({
        query: `WITH user_first AS (
                  SELECT user_pseudo_id, MIN(PARSE_DATE('%Y%m%d', event_date)) as first_date
                  FROM \`cheongimun.analytics_515600551.events_*\`
                  WHERE _TABLE_SUFFIX BETWEEN '${startStr}' AND '${endStr}'
                  GROUP BY user_pseudo_id
                ),
                d7 AS (
                  SELECT DISTINCT f.user_pseudo_id
                  FROM user_first f
                  JOIN \`cheongimun.analytics_515600551.events_*\` e
                    ON f.user_pseudo_id = e.user_pseudo_id
                    AND PARSE_DATE('%Y%m%d', e.event_date) = DATE_ADD(f.first_date, INTERVAL 7 DAY)
                  WHERE e._TABLE_SUFFIX BETWEEN '${startStr}' AND '${endStr}'
                )
                SELECT ROUND(COUNT(DISTINCT d.user_pseudo_id) / NULLIF(COUNT(DISTINCT f.user_pseudo_id), 0) * 100, 2) as d7
                FROM user_first f LEFT JOIN d7 d ON f.user_pseudo_id = d.user_pseudo_id`
      });
      if (d7Rows[0]) data.d7Retention = parseFloat(d7Rows[0].d7) || 0;
    } catch (e) {
      console.log('D7 Retention query error:', e.message);
    }

    // D30 Retention
    try {
      const [d30Rows] = await bigquery.query({
        query: `WITH user_first AS (
                  SELECT user_pseudo_id, MIN(PARSE_DATE('%Y%m%d', event_date)) as first_date
                  FROM \`cheongimun.analytics_515600551.events_*\`
                  WHERE _TABLE_SUFFIX BETWEEN '${startStr}' AND '${endStr}'
                  GROUP BY user_pseudo_id
                ),
                d30 AS (
                  SELECT DISTINCT f.user_pseudo_id
                  FROM user_first f
                  JOIN \`cheongimun.analytics_515600551.events_*\` e
                    ON f.user_pseudo_id = e.user_pseudo_id
                    AND PARSE_DATE('%Y%m%d', e.event_date) = DATE_ADD(f.first_date, INTERVAL 30 DAY)
                  WHERE e._TABLE_SUFFIX BETWEEN '${startStr}' AND '${endStr}'
                )
                SELECT ROUND(COUNT(DISTINCT d.user_pseudo_id) / NULLIF(COUNT(DISTINCT f.user_pseudo_id), 0) * 100, 2) as d30
                FROM user_first f LEFT JOIN d30 d ON f.user_pseudo_id = d.user_pseudo_id`
      });
      if (d30Rows[0]) data.d30Retention = parseFloat(d30Rows[0].d30) || 0;
    } catch (e) {
      console.log('D30 Retention query error:', e.message);
    }

    // Transaction Retention (M1/M3/M6)
    try {
      const [txRetentionRows] = await bigquery.query({
        query: `WITH first_purchase AS (
                  SELECT customer_phone, MIN(DATE(created_at)) as first_date
                  FROM \`cheongimun.supabase_sync.orders\`
                  WHERE payment_status = 'PAID'
                  GROUP BY customer_phone
                ),
                m1 AS (
                  SELECT DISTINCT fp.customer_phone
                  FROM first_purchase fp
                  JOIN \`cheongimun.supabase_sync.orders\` o
                    ON fp.customer_phone = o.customer_phone
                    AND o.payment_status = 'PAID'
                    AND DATE(o.created_at) BETWEEN DATE_ADD(fp.first_date, INTERVAL 25 DAY)
                                               AND DATE_ADD(fp.first_date, INTERVAL 35 DAY)
                ),
                m3 AS (
                  SELECT DISTINCT fp.customer_phone
                  FROM first_purchase fp
                  JOIN \`cheongimun.supabase_sync.orders\` o
                    ON fp.customer_phone = o.customer_phone
                    AND o.payment_status = 'PAID'
                    AND DATE(o.created_at) BETWEEN DATE_ADD(fp.first_date, INTERVAL 80 DAY)
                                               AND DATE_ADD(fp.first_date, INTERVAL 100 DAY)
                ),
                m6 AS (
                  SELECT DISTINCT fp.customer_phone
                  FROM first_purchase fp
                  JOIN \`cheongimun.supabase_sync.orders\` o
                    ON fp.customer_phone = o.customer_phone
                    AND o.payment_status = 'PAID'
                    AND DATE(o.created_at) BETWEEN DATE_ADD(fp.first_date, INTERVAL 170 DAY)
                                               AND DATE_ADD(fp.first_date, INTERVAL 190 DAY)
                )
                SELECT
                  ROUND(COUNT(DISTINCT m1.customer_phone) / NULLIF(COUNT(DISTINCT fp.customer_phone), 0) * 100, 1) as m1_retention,
                  ROUND(COUNT(DISTINCT m3.customer_phone) / NULLIF(COUNT(DISTINCT fp.customer_phone), 0) * 100, 1) as m3_retention,
                  ROUND(COUNT(DISTINCT m6.customer_phone) / NULLIF(COUNT(DISTINCT fp.customer_phone), 0) * 100, 1) as m6_retention
                FROM first_purchase fp
                LEFT JOIN m1 ON fp.customer_phone = m1.customer_phone
                LEFT JOIN m3 ON fp.customer_phone = m3.customer_phone
                LEFT JOIN m6 ON fp.customer_phone = m6.customer_phone`
      });
      if (txRetentionRows[0]) {
        data.m1Retention = parseFloat(txRetentionRows[0].m1_retention) || 0;
        data.m3Retention = parseFloat(txRetentionRows[0].m3_retention) || 0;
        data.m6Retention = parseFloat(txRetentionRows[0].m6_retention) || 0;
      }
    } catch (e) {
      console.log('Transaction retention query error:', e.message);
    }

    // Stickiness (DAU/MAU)
    try {
      const [stickinessRows] = await bigquery.query({
        query: `WITH daily AS (
                  SELECT COUNT(DISTINCT user_pseudo_id) as dau
                  FROM \`cheongimun.analytics_515600551.events_*\`
                  WHERE _TABLE_SUFFIX BETWEEN '${startStr}' AND '${endStr}'
                  GROUP BY event_date
                )
                SELECT ROUND(AVG(dau), 0) as avg_dau FROM daily`
      });
      if (stickinessRows[0] && data.mau) {
        const avgDau = parseInt(stickinessRows[0].avg_dau) || 0;
        data.stickiness = Math.round(avgDau / data.mau * 10000) / 100;
      }
    } catch (e) {
      console.log('Stickiness query error:', e.message);
    }

    // Repurchase Rate
    try {
      const [repurchaseRows] = await bigquery.query({
        query: `SELECT ROUND(
                  COUNT(DISTINCT CASE WHEN order_count > 1 THEN customer_phone END) /
                  NULLIF(COUNT(DISTINCT customer_phone), 0) * 100, 2
                ) as repurchase
                FROM (
                  SELECT customer_phone, COUNT(*) as order_count
                  FROM \`cheongimun.supabase_sync.orders\`
                  WHERE payment_status = 'PAID' AND DATE(created_at) BETWEEN '${startDash}' AND '${endDash}'
                  GROUP BY customer_phone
                )`
      });
      if (repurchaseRows[0]) data.repurchaseRate = parseFloat(repurchaseRows[0].repurchase) || 0;
    } catch (e) {
      console.log('Repurchase rate query error:', e.message);
    }

    // New Paying Users (신규 유료 고객)
    try {
      const [newPayingRows] = await bigquery.query({
        query: `WITH first_purchase AS (
                  SELECT customer_phone, MIN(DATE(created_at)) as first_date
                  FROM \`cheongimun.supabase_sync.orders\`
                  WHERE payment_status = 'PAID'
                  GROUP BY customer_phone
                )
                SELECT COUNT(*) as new_paying
                FROM first_purchase
                WHERE first_date BETWEEN '${startDash}' AND '${endDash}'`
      });
      if (newPayingRows[0]) data.newPayingUsers = parseInt(newPayingRows[0].new_paying) || 0;
    } catch (e) {
      console.log('New paying users query error:', e.message);
    }

    // Churn Rate (90일)
    try {
      const [churnRows] = await bigquery.query({
        query: `WITH active_90_days_ago AS (
                  SELECT DISTINCT COALESCE(phone, session_id) as user_id
                  FROM \`cheongimun.supabase_sync.free_saju_results\`
                  WHERE DATE(created_at) BETWEEN DATE_SUB(CURRENT_DATE(), INTERVAL 120 DAY)
                                             AND DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY)
                ),
                still_active AS (
                  SELECT DISTINCT a.user_id
                  FROM active_90_days_ago a
                  JOIN \`cheongimun.supabase_sync.free_saju_results\` f
                    ON COALESCE(f.phone, f.session_id) = a.user_id
                    AND DATE(f.created_at) >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
                )
                SELECT ROUND((1 - COUNT(DISTINCT s.user_id) / NULLIF(COUNT(DISTINCT a.user_id), 0)) * 100, 1) as churn_rate
                FROM active_90_days_ago a
                LEFT JOIN still_active s ON a.user_id = s.user_id`
      });
      if (churnRows[0]) {
        data.churnRate90d = parseFloat(churnRows[0].churn_rate) || 0;
        data.monthlyChurnRate = Math.round(data.churnRate90d / 3 * 10) / 10;
      }
    } catch (e) {
      console.log('Churn rate query error:', e.message);
    }

    // PostgreSQL for ad spend and AI cost
    let adSpend = 52960184, aiCost = 21754819;
    let pool, client;
    try {
      pool = new Pool({
        host: 'aws-1-ap-northeast-2.pooler.supabase.com',
        port: 6543,
        database: 'postgres',
        user: 'postgres.jlutbjmjpreauyanjzdd',
        password: process.env.SUPABASE_PASSWORD,
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 10000
      });
      client = await pool.connect();

      const adResult = await client.query('SELECT SUM(spend) FROM adset_performance');
      if (adResult.rows[0]?.sum) adSpend = parseFloat(adResult.rows[0].sum);

      const aiResult = await client.query('SELECT SUM(cost_krw) FROM api_costs');
      if (aiResult.rows[0]?.sum) aiCost = parseFloat(aiResult.rows[0].sum);
    } catch (e) {
      console.log('PostgreSQL error, using defaults:', e.message);
    } finally {
      if (client) try { client.release(); } catch (e) {}
      if (pool) try { await pool.end(); } catch (e) {}
    }

    // Calculate derived metrics
    if (data.revenue && data.payingUsers) {
      data.arppu = Math.round(data.revenue / data.payingUsers);
    }
    if (data.mau && data.payingUsers) {
      data.conversionRate = Math.round(data.payingUsers / data.mau * 10000) / 100;
    }

    // CAC
    if (data.newPayingUsers && adSpend) {
      data.cac = Math.round(adSpend / data.newPayingUsers);
    } else if (data.payingUsers && adSpend) {
      data.cac = Math.round(adSpend / data.payingUsers);
    }

    // Fully Loaded CAC
    const freeUserRatio = data.mau > 0 ? data.freeOnlyMau / data.mau : 0.95;
    const freeUserSupportCost = Math.round(aiCost * freeUserRatio);
    if (data.newPayingUsers > 0) {
      data.fullyLoadedCac = Math.round((adSpend + freeUserSupportCost) / data.newPayingUsers);
    } else if (data.payingUsers > 0) {
      data.fullyLoadedCac = Math.round((adSpend + freeUserSupportCost) / data.payingUsers);
    } else {
      data.fullyLoadedCac = data.cac;
    }

    // Customer Lifespan
    let customerLifespanMonths = 3;
    if (data.monthlyChurnRate > 0) {
      customerLifespanMonths = Math.min(24, 1 / (data.monthlyChurnRate / 100));
    } else if (data.m1Retention > 0) {
      const monthlyChurn = Math.max(0.1, 1 - (data.m1Retention / 100));
      customerLifespanMonths = Math.min(24, 1 / monthlyChurn);
    }
    data.customerLifespan = Math.round(customerLifespanMonths * 10) / 10;

    // LTV = ARPPU × Customer Lifespan × Gross Margin
    if (data.arppu) {
      const grossMarginDecimal = 0.85; // 기본 85%
      data.ltv = Math.round(data.arppu * customerLifespanMonths * grossMarginDecimal);
    }

    // LTV:CAC
    if (data.ltv && data.cac) {
      data.ltvCac = Math.round(data.ltv / data.cac * 100) / 100;
    }

    // CAC Payback
    if (data.arppu && data.cac) {
      data.cacPaybackMonths = Math.round(data.cac / data.arppu * 10) / 10;
    }

    // ROAS
    if (data.revenue && adSpend) {
      data.roas = Math.round(data.revenue / adSpend * 100) / 100;
    }

    // Gross Margin
    if (data.revenue && aiCost) {
      const paymentFee = data.revenue * 0.025;
      data.grossMargin = Math.round((1 - (aiCost + paymentFee) / data.revenue) * 1000) / 10;
    } else {
      data.grossMargin = 85;
    }

    // ARR
    data.arr = data.revenue * 12;
    data.adSpend = adSpend;
    data.aiCost = aiCost;

    res.status(200).json({ success: true, data, updatedAt: new Date().toISOString() });

  } catch (error) {
    console.error('API Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};
