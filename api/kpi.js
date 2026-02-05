const { BigQuery } = require('@google-cloud/bigquery');
const { Pool } = require('pg');

module.exports = async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  try {
    // BigQuery setup
    const credentials = JSON.parse(
      Buffer.from(process.env.BIGQUERY_KEY, 'base64').toString('utf-8')
    );
    const bigquery = new BigQuery({ credentials, projectId: credentials.project_id });
    const projectId = credentials.project_id;

    // Date range from query params or default 30 days
    const days = parseInt(req.query.days) || 30;
    const endDate = req.query.end ? new Date(req.query.end) : new Date();
    const startDate = req.query.start ? new Date(req.query.start) : new Date(endDate - days * 24 * 60 * 60 * 1000);
    const startDash = startDate.toISOString().slice(0, 10);
    const endDash = endDate.toISOString().slice(0, 10);

    // Pre-A benchmarks (targets)
    const benchmarks = {
      mau: 100000,           // Pre-A: 10만 MAU
      mrr: 300000000,        // Pre-A: 3억 MRR
      ltvCac: 3.0,           // Pre-A: 3:1
      conversionRate: 5.0,   // Pre-A: 5%
      d1Retention: 30,       // Pre-A: 30%
      grossMargin: 70        // Pre-A: 70%
    };

    const data = {
      mau: 0, revenue: 0, payingUsers: 0, arppu: 0, conversionRate: 0,
      cac: 0, ltvCac: 0, roas: 0, grossMargin: 0, d1Retention: 0,
      d7Retention: 0, d30Retention: 0, m1Retention: 0, m3Retention: 0, m6Retention: 0,
      stickiness: 0, repurchaseRate: 0,
      // 분석팀 정의: D1/D7/D30 재구매율 (코호트 기반)
      repurchaseD1: 0, repurchaseD7: 0, repurchaseD30: 0,
      payingMau: 0, freeOnlyMau: 0, payingRatio: 0,
      netRevenue: 0, refundRate: 0, refundCount: 0, refundAmount: 0,
      totalUsers: 0, signupConversionRate: 0, churnRate: 0,
      paidD1Retention: 0, paidD7Retention: 0, paidD30Retention: 0,
      couponRedemptionRate: 0, couponROI: 0, couponIssuedCount: 0, couponUsedCount: 0,
      shareRate: 0, shareCount: 0, sharers: 0, freeUsers: 0, kFactor: 0,
      cohortRetention: [],
      dataStart: startDash, dataEnd: endDash, benchmarks
    };

    // === CONSTANTS ===
    const GA4_START_DATE = '2026-01-22';
    const VISITOR_RATIO = 2.20;

    // === QUERY DEFINITIONS ===
    const ga4Start = startDash >= GA4_START_DATE ? startDash : GA4_START_DATE;
    const ga4StartSuffix = ga4Start.replace(/-/g, '');
    const ga4EndSuffix = endDash.replace(/-/g, '');
    const estimateEnd = endDash < GA4_START_DATE ? endDash : '2026-01-21';

    // Common subquery for all free results tables
    const allFreeResultsQuery = `
      SELECT COALESCE(phone, session_id) as user_id, created_at
      FROM \`${projectId}.supabase_sync.free_saju_results\`
      WHERE COALESCE(phone, session_id) IS NOT NULL
      UNION ALL
      SELECT COALESCE(phone, session_id) as user_id, created_at
      FROM \`${projectId}.supabase_sync.free_love_saju_results\`
      WHERE COALESCE(phone, session_id) IS NOT NULL
      UNION ALL
      SELECT COALESCE(phone, session_id) as user_id, created_at
      FROM \`${projectId}.supabase_sync.free_marriage_saju_results\`
      WHERE COALESCE(phone, session_id) IS NOT NULL
    `;

    const buildRetentionQuery = (intervalDays) => `
      WITH all_visits AS (${allFreeResultsQuery}),
      user_first AS (
        SELECT user_id, MIN(DATE(created_at, 'Asia/Seoul')) as first_date
        FROM all_visits
        WHERE DATE(created_at, 'Asia/Seoul') BETWEEN '${startDash}' AND '${endDash}'
        GROUP BY user_id
      ),
      returned AS (
        SELECT DISTINCT f.user_id
        FROM user_first f
        JOIN all_visits e ON f.user_id = e.user_id
          AND DATE(e.created_at, 'Asia/Seoul') = DATE_ADD(f.first_date, INTERVAL ${intervalDays} DAY)
      )
      SELECT
        COUNT(DISTINCT f.user_id) as cohort_size,
        COUNT(DISTINCT r.user_id) as returned_users,
        ROUND(COUNT(DISTINCT r.user_id) / NULLIF(COUNT(DISTINCT f.user_id), 0) * 100, 2) as retention
      FROM user_first f
      LEFT JOIN returned r ON f.user_id = r.user_id
    `;

    const buildTxRetentionQuery = (startDay, endDay) => `
      WITH first_order AS (
        SELECT customer_phone, MIN(DATE(created_at, 'Asia/Seoul')) as first_date
        FROM \`${projectId}.supabase_sync.orders\`
        WHERE payment_status = 'PAID' AND DATE(created_at, 'Asia/Seoul') BETWEEN '${startDash}' AND '${endDash}'
        GROUP BY customer_phone
      ),
      repeat_orders AS (
        SELECT DISTINCT f.customer_phone
        FROM first_order f
        JOIN \`${projectId}.supabase_sync.orders\` o
          ON f.customer_phone = o.customer_phone
          AND o.payment_status = 'PAID'
          AND DATE(o.created_at, 'Asia/Seoul') BETWEEN DATE_ADD(f.first_date, INTERVAL ${startDay} DAY) AND DATE_ADD(f.first_date, INTERVAL ${endDay} DAY)
      )
      SELECT
        COUNT(DISTINCT f.customer_phone) as cohort_size,
        COUNT(DISTINCT r.customer_phone) as repeat_customers,
        ROUND(COUNT(DISTINCT r.customer_phone) / NULLIF(COUNT(DISTINCT f.customer_phone), 0) * 100, 2) as retention
      FROM first_order f
      LEFT JOIN repeat_orders r ON f.customer_phone = r.customer_phone
    `;

    const paidRetentionOrdersQuery = (intervalDays) => `
      WITH first_order AS (
        SELECT customer_phone, MIN(DATE(created_at, 'Asia/Seoul')) as first_date
        FROM \`${projectId}.supabase_sync.orders\`
        WHERE payment_status = 'PAID' AND DATE(created_at) BETWEEN '${startDash}' AND '${endDash}'
        GROUP BY customer_phone
      ),
      returned AS (
        SELECT DISTINCT f.customer_phone
        FROM first_order f
        JOIN \`${projectId}.supabase_sync.orders\` o
          ON f.customer_phone = o.customer_phone
          AND o.payment_status = 'PAID'
          AND DATE(o.created_at, 'Asia/Seoul') = DATE_ADD(f.first_date, INTERVAL ${intervalDays} DAY)
      )
      SELECT
        COUNT(DISTINCT f.customer_phone) as cohort_size,
        COUNT(DISTINCT r.customer_phone) as returned_users,
        ROUND(COUNT(DISTINCT r.customer_phone) / NULLIF(COUNT(DISTINCT f.customer_phone), 0) * 100, 2) as retention
      FROM first_order f
      LEFT JOIN returned r ON f.customer_phone = r.customer_phone
    `;

    // === PARALLEL EXECUTION: ALL QUERIES AT ONCE ===
    const queryPromises = {
      // Core metrics
      ga4: endDash >= GA4_START_DATE ? bigquery.query({
        query: `SELECT COUNT(DISTINCT user_pseudo_id) as mau
                FROM \`${projectId}.analytics_515600551.events_*\`
                WHERE _TABLE_SUFFIX BETWEEN '${ga4StartSuffix}' AND '${ga4EndSuffix}'`
      }).catch(e => { console.log('GA4 error:', e.message); return [[{}]]; }) : Promise.resolve([[{}]]),

      session: bigquery.query({
        query: `SELECT COUNT(DISTINCT session_id) as engaged
                FROM (
                  SELECT session_id FROM \`${projectId}.supabase_sync.free_saju_results\`
                  WHERE DATE(created_at) BETWEEN '${startDash}' AND '${endDash}' AND session_id IS NOT NULL
                  UNION ALL
                  SELECT session_id FROM \`${projectId}.supabase_sync.free_love_saju_results\`
                  WHERE DATE(created_at) BETWEEN '${startDash}' AND '${endDash}' AND session_id IS NOT NULL
                  UNION ALL
                  SELECT session_id FROM \`${projectId}.supabase_sync.free_marriage_saju_results\`
                  WHERE DATE(created_at) BETWEEN '${startDash}' AND '${endDash}' AND session_id IS NOT NULL
                )`
      }),

      estimated: startDash < GA4_START_DATE ? bigquery.query({
        query: `SELECT COUNT(DISTINCT session_id) as engaged
                FROM (
                  SELECT session_id FROM \`${projectId}.supabase_sync.free_saju_results\`
                  WHERE DATE(created_at) BETWEEN '${startDash}' AND '${estimateEnd}' AND session_id IS NOT NULL
                  UNION ALL
                  SELECT session_id FROM \`${projectId}.supabase_sync.free_love_saju_results\`
                  WHERE DATE(created_at) BETWEEN '${startDash}' AND '${estimateEnd}' AND session_id IS NOT NULL
                  UNION ALL
                  SELECT session_id FROM \`${projectId}.supabase_sync.free_marriage_saju_results\`
                  WHERE DATE(created_at) BETWEEN '${startDash}' AND '${estimateEnd}' AND session_id IS NOT NULL
                )`
      }) : Promise.resolve([[{ engaged: 0 }]]),

      revenue: bigquery.query({
        query: `SELECT SUM(total_amount) as revenue, COUNT(DISTINCT customer_phone) as paying_users
                FROM \`${projectId}.supabase_sync.orders\`
                WHERE payment_status = 'PAID' AND DATE(created_at) BETWEEN '${startDash}' AND '${endDash}'`
      }),

      stickiness: bigquery.query({
        query: `WITH daily AS (
                  SELECT DATE(created_at) as date, COUNT(DISTINCT session_id) as dau
                  FROM \`${projectId}.supabase_sync.free_saju_results\`
                  WHERE DATE(created_at) BETWEEN '${startDash}' AND '${endDash}' AND session_id IS NOT NULL
                  GROUP BY date
                )
                SELECT ROUND(AVG(dau), 0) as avg_dau FROM daily`
      }),

      // 기존 재구매율 (기간 내 2회+)
      repurchase: bigquery.query({
        query: `SELECT
                  ROUND(COUNT(DISTINCT CASE WHEN order_count > 1 THEN customer_phone END) / NULLIF(COUNT(DISTINCT customer_phone), 0) * 100, 2) as repurchase,
                  COUNT(DISTINCT CASE WHEN order_count > 1 THEN customer_phone END) as repurchase_customers,
                  SUM(order_count) as total_orders,
                  COUNT(DISTINCT customer_phone) as total_customers
                FROM (
                  SELECT customer_phone, COUNT(*) as order_count
                  FROM \`${projectId}.supabase_sync.orders\`
                  WHERE payment_status = 'PAID' AND DATE(created_at) BETWEEN '${startDash}' AND '${endDash}'
                  GROUP BY customer_phone
                )`
      }),

      // 분석팀 정의: D1/D7/D30 재구매율 (첫 구매 후 N일 이내 재구매 비율)
      repurchaseD1: bigquery.query({
        query: `WITH first_purchase AS (
                  SELECT CAST(customer_phone AS STRING) as phone, MIN(DATE(created_at, 'Asia/Seoul')) as first_date
                  FROM \`${projectId}.supabase_sync.orders\`
                  WHERE payment_status = 'PAID' AND customer_phone IS NOT NULL
                  GROUP BY phone
                ),
                repurchased AS (
                  SELECT DISTINCT fp.phone
                  FROM first_purchase fp
                  JOIN \`${projectId}.supabase_sync.orders\` o
                    ON CAST(o.customer_phone AS STRING) = fp.phone
                    AND o.payment_status = 'PAID'
                    AND DATE(o.created_at, 'Asia/Seoul') = DATE_ADD(fp.first_date, INTERVAL 1 DAY)
                )
                SELECT
                  COUNT(DISTINCT fp.phone) as cohort_size,
                  COUNT(DISTINCT r.phone) as repurchased,
                  ROUND(COUNT(DISTINCT r.phone) / NULLIF(COUNT(DISTINCT fp.phone), 0) * 100, 2) as rate
                FROM first_purchase fp
                LEFT JOIN repurchased r ON fp.phone = r.phone
                WHERE fp.first_date BETWEEN '${startDash}' AND '${endDash}'`
      }),

      repurchaseD7: bigquery.query({
        query: `WITH first_purchase AS (
                  SELECT CAST(customer_phone AS STRING) as phone, MIN(DATE(created_at, 'Asia/Seoul')) as first_date
                  FROM \`${projectId}.supabase_sync.orders\`
                  WHERE payment_status = 'PAID' AND customer_phone IS NOT NULL
                  GROUP BY phone
                ),
                repurchased AS (
                  SELECT DISTINCT fp.phone
                  FROM first_purchase fp
                  JOIN \`${projectId}.supabase_sync.orders\` o
                    ON CAST(o.customer_phone AS STRING) = fp.phone
                    AND o.payment_status = 'PAID'
                    AND DATE(o.created_at, 'Asia/Seoul') BETWEEN DATE_ADD(fp.first_date, INTERVAL 1 DAY) AND DATE_ADD(fp.first_date, INTERVAL 7 DAY)
                )
                SELECT
                  COUNT(DISTINCT fp.phone) as cohort_size,
                  COUNT(DISTINCT r.phone) as repurchased,
                  ROUND(COUNT(DISTINCT r.phone) / NULLIF(COUNT(DISTINCT fp.phone), 0) * 100, 2) as rate
                FROM first_purchase fp
                LEFT JOIN repurchased r ON fp.phone = r.phone
                WHERE fp.first_date BETWEEN '${startDash}' AND '${endDash}'`
      }),

      repurchaseD30: bigquery.query({
        query: `WITH first_purchase AS (
                  SELECT CAST(customer_phone AS STRING) as phone, MIN(DATE(created_at, 'Asia/Seoul')) as first_date
                  FROM \`${projectId}.supabase_sync.orders\`
                  WHERE payment_status = 'PAID' AND customer_phone IS NOT NULL
                  GROUP BY phone
                ),
                repurchased AS (
                  SELECT DISTINCT fp.phone
                  FROM first_purchase fp
                  JOIN \`${projectId}.supabase_sync.orders\` o
                    ON CAST(o.customer_phone AS STRING) = fp.phone
                    AND o.payment_status = 'PAID'
                    AND DATE(o.created_at, 'Asia/Seoul') BETWEEN DATE_ADD(fp.first_date, INTERVAL 1 DAY) AND DATE_ADD(fp.first_date, INTERVAL 30 DAY)
                )
                SELECT
                  COUNT(DISTINCT fp.phone) as cohort_size,
                  COUNT(DISTINCT r.phone) as repurchased,
                  ROUND(COUNT(DISTINCT r.phone) / NULLIF(COUNT(DISTINCT fp.phone), 0) * 100, 2) as rate
                FROM first_purchase fp
                LEFT JOIN repurchased r ON fp.phone = r.phone
                WHERE fp.first_date BETWEEN '${startDash}' AND '${endDash}'`
      }),

      // Retention queries
      d1: bigquery.query({ query: buildRetentionQuery(1) }),
      d7: bigquery.query({ query: buildRetentionQuery(7) }),
      d30: bigquery.query({ query: buildRetentionQuery(30) }),
      m1: bigquery.query({ query: buildTxRetentionQuery(1, 30) }),
      m3: bigquery.query({ query: buildTxRetentionQuery(31, 90) }),
      m6: bigquery.query({ query: buildTxRetentionQuery(91, 180) }),

      // Paid retention (using orders table directly for speed)
      paidD1: bigquery.query({ query: paidRetentionOrdersQuery(1) }),
      paidD7: bigquery.query({ query: paidRetentionOrdersQuery(7) }),
      paidD30: bigquery.query({ query: paidRetentionOrdersQuery(30) }),

      // Users
      users: bigquery.query({
        query: `SELECT
                  COUNT(*) as total_users,
                  COUNT(CASE WHEN DATE(created_at) BETWEEN '${startDash}' AND '${endDash}' THEN 1 END) as new_users
                FROM \`${projectId}.supabase_sync.users\``
      }).catch(e => { console.log('Users error:', e.message); return [[{}]]; }),

      // 분석팀 정의: 공유율 = DISTINCT 공유 사용자 / 무료 사용자 수
      // 공유 로그는 ip_address로 사용자 식별 (분석팀 정의)
      share: bigquery.query({
        query: `SELECT COUNT(*) as share_count, COUNT(DISTINCT ip_address) as sharers
                FROM \`${projectId}.supabase_sync.free_saju_share_logs\`
                WHERE DATE(created_at) BETWEEN '${startDash}' AND '${endDash}'`
      }).catch(e => { console.log('Share error:', e.message); return [[{}]]; }),

      // 무료 사용자 수 (공유율 분모: DISTINCT 사용자)
      freeUsers: bigquery.query({
        query: `SELECT COUNT(DISTINCT session_id) as free_users
                FROM (
                  SELECT session_id FROM \`${projectId}.supabase_sync.free_saju_results\`
                  WHERE DATE(created_at) BETWEEN '${startDash}' AND '${endDash}' AND session_id IS NOT NULL
                  UNION ALL
                  SELECT session_id FROM \`${projectId}.supabase_sync.free_love_saju_results\`
                  WHERE DATE(created_at) BETWEEN '${startDash}' AND '${endDash}' AND session_id IS NOT NULL
                  UNION ALL
                  SELECT session_id FROM \`${projectId}.supabase_sync.free_marriage_saju_results\`
                  WHERE DATE(created_at) BETWEEN '${startDash}' AND '${endDash}' AND session_id IS NOT NULL
                )`
      }),

      freeCount: bigquery.query({
        query: `SELECT COUNT(*) as free_count
                FROM \`${projectId}.supabase_sync.free_saju_results\`
                WHERE DATE(created_at) BETWEEN '${startDash}' AND '${endDash}'`
      }),

      // Cohort retention
      cohort: bigquery.query({
        query: `WITH user_cohorts AS (
                  SELECT
                    customer_phone,
                    DATE_TRUNC(MIN(DATE(created_at, 'Asia/Seoul')), MONTH) as cohort_month
                  FROM \`${projectId}.supabase_sync.orders\`
                  WHERE payment_status = 'PAID'
                  GROUP BY customer_phone
                ),
                user_activities AS (
                  SELECT
                    o.customer_phone,
                    c.cohort_month,
                    DATE_DIFF(DATE_TRUNC(DATE(o.created_at, 'Asia/Seoul'), MONTH), c.cohort_month, MONTH) as month_number
                  FROM \`${projectId}.supabase_sync.orders\` o
                  JOIN user_cohorts c ON o.customer_phone = c.customer_phone
                  WHERE o.payment_status = 'PAID'
                )
                SELECT
                  FORMAT_DATE('%Y-%m', cohort_month) as cohort,
                  COUNT(DISTINCT CASE WHEN month_number = 0 THEN customer_phone END) as m0,
                  COUNT(DISTINCT CASE WHEN month_number = 1 THEN customer_phone END) as m1,
                  COUNT(DISTINCT CASE WHEN month_number = 2 THEN customer_phone END) as m2,
                  COUNT(DISTINCT CASE WHEN month_number = 3 THEN customer_phone END) as m3
                FROM user_activities
                GROUP BY cohort_month
                ORDER BY cohort_month DESC
                LIMIT 6`
      }).catch(e => { console.log('Cohort error:', e.message); return [[]]; })
    };

    // PostgreSQL for ad spend and AI cost (parallel with BigQuery)
    const pgPromise = (async () => {
      let adSpend = 52960184, aiCost = 21754819;
      try {
        const pool = new Pool({
          host: 'aws-1-ap-northeast-2.pooler.supabase.com',
          port: 6543,
          database: 'postgres',
          user: 'postgres.jlutbjmjpreauyanjzdd',
          password: process.env.SUPABASE_PASSWORD,
          ssl: { rejectUnauthorized: false },
          connectionTimeoutMillis: 5000
        });
        const client = await pool.connect();
        const [adResult, aiResult] = await Promise.all([
          client.query('SELECT SUM(spend) FROM adset_performance'),
          client.query('SELECT SUM(cost_krw) FROM api_costs')
        ]);
        if (adResult.rows[0]?.sum) adSpend = parseFloat(adResult.rows[0].sum);
        if (aiResult.rows[0]?.sum) aiCost = parseFloat(aiResult.rows[0].sum);
        client.release();
        await pool.end();
      } catch (e) {
        console.log('PostgreSQL error:', e.message);
      }
      return { adSpend, aiCost };
    })();

    // === EXECUTE ALL IN PARALLEL ===
    const [results, pgData] = await Promise.all([
      Promise.all(Object.values(queryPromises)),
      pgPromise
    ]);

    // Map results back to named keys
    const keys = Object.keys(queryPromises);
    const queryResults = {};
    keys.forEach((key, i) => { queryResults[key] = results[i]; });

    // === PROCESS RESULTS ===
    const { adSpend, aiCost } = pgData;

    // MAU
    const ga4Mau = parseInt(queryResults.ga4[0]?.[0]?.mau) || 0;
    const engagedUsers = parseInt(queryResults.session[0]?.[0]?.engaged) || 0;
    const preGa4Engaged = parseInt(queryResults.estimated[0]?.[0]?.engaged) || 0;
    const estimatedMau = Math.round(preGa4Engaged * VISITOR_RATIO);

    data.mau = ga4Mau + estimatedMau;
    data.ga4Mau = ga4Mau;
    data.estimatedMau = estimatedMau;
    data.engagedUsers = engagedUsers;
    data.visitorRatio = VISITOR_RATIO;
    data.mauSource = ga4Mau > 0 && estimatedMau > 0 ? 'hybrid' : (ga4Mau > 0 ? 'ga4' : 'estimated');

    if (data.mau === 0 && engagedUsers > 0) {
      data.mau = Math.round(engagedUsers * VISITOR_RATIO);
      data.mauSource = 'fallback';
    }

    // Revenue
    if (queryResults.revenue[0]?.[0]) {
      data.revenue = parseInt(queryResults.revenue[0][0].revenue) || 0;
      data.payingUsers = parseInt(queryResults.revenue[0][0].paying_users) || 0;
    }

    data.payingMau = data.payingUsers;
    data.freeOnlyMau = Math.max(0, data.mau - data.payingUsers);
    data.payingRatio = data.mau > 0 ? Math.round(data.payingUsers / data.mau * 10000) / 100 : 0;

    // Retention
    if (queryResults.d1[0]?.[0]) data.d1Retention = parseFloat(queryResults.d1[0][0].retention) || 0;
    if (queryResults.d7[0]?.[0]) data.d7Retention = parseFloat(queryResults.d7[0][0].retention) || 0;
    if (queryResults.d30[0]?.[0]) data.d30Retention = parseFloat(queryResults.d30[0][0].retention) || 0;
    if (queryResults.m1[0]?.[0]) data.m1Retention = parseFloat(queryResults.m1[0][0].retention) || 0;
    if (queryResults.m3[0]?.[0]) data.m3Retention = parseFloat(queryResults.m3[0][0].retention) || 0;
    if (queryResults.m6[0]?.[0]) data.m6Retention = parseFloat(queryResults.m6[0][0].retention) || 0;

    // Paid retention
    if (queryResults.paidD1[0]?.[0]) data.paidD1Retention = parseFloat(queryResults.paidD1[0][0].retention) || 0;
    if (queryResults.paidD7[0]?.[0]) data.paidD7Retention = parseFloat(queryResults.paidD7[0][0].retention) || 0;
    if (queryResults.paidD30[0]?.[0]) data.paidD30Retention = parseFloat(queryResults.paidD30[0][0].retention) || 0;

    // Stickiness
    if (queryResults.stickiness[0]?.[0] && data.mau) {
      const avgDau = parseInt(queryResults.stickiness[0][0].avg_dau) || 0;
      data.stickiness = Math.round(avgDau / data.mau * 10000) / 100;
      data.avgDau = avgDau;
    }

    // Repurchase (기존: 기간 내 2회+)
    if (queryResults.repurchase[0]?.[0]) {
      data.repurchaseRate = parseFloat(queryResults.repurchase[0][0].repurchase) || 0;
      data.repurchaseCustomers = parseInt(queryResults.repurchase[0][0].repurchase_customers) || 0;
      data.totalOrders = parseInt(queryResults.repurchase[0][0].total_orders) || 0;
      data.totalCustomers = parseInt(queryResults.repurchase[0][0].total_customers) || 0;
      // 실제 평균 구매 횟수 (분석팀 정의)
      data.avgPurchasesReal = data.totalCustomers > 0
        ? Math.round(data.totalOrders / data.totalCustomers * 100) / 100
        : 1;
    }

    // 분석팀 정의: D1/D7/D30 재구매율 (코호트 기반)
    if (queryResults.repurchaseD1[0]?.[0]) {
      data.repurchaseD1 = parseFloat(queryResults.repurchaseD1[0][0].rate) || 0;
    }
    if (queryResults.repurchaseD7[0]?.[0]) {
      data.repurchaseD7 = parseFloat(queryResults.repurchaseD7[0][0].rate) || 0;
    }
    if (queryResults.repurchaseD30[0]?.[0]) {
      data.repurchaseD30 = parseFloat(queryResults.repurchaseD30[0][0].rate) || 0;
    }

    // Users
    if (queryResults.users[0]?.[0]) {
      data.totalUsers = parseInt(queryResults.users[0][0].total_users) || 0;
      data.newUsers = parseInt(queryResults.users[0][0].new_users) || 0;
      data.signupConversionRate = data.mau > 0 ? Math.round(data.newUsers / data.mau * 10000) / 100 : 0;
    }

    // 분석팀 정의: 공유율 = DISTINCT 공유 사용자 / 무료 사용자 수
    if (queryResults.share[0]?.[0]) {
      const shareCount = parseInt(queryResults.share[0][0].share_count) || 0;
      const sharers = parseInt(queryResults.share[0][0].sharers) || 0;
      const freeUsers = parseInt(queryResults.freeUsers?.[0]?.[0]?.free_users) || 0;

      data.shareCount = shareCount;
      data.sharers = sharers;
      data.freeUsers = freeUsers;
      // 분석팀 정의: DISTINCT 공유 사용자 / 무료 사용자 수
      data.shareRate = freeUsers > 0 ? Math.round(sharers / freeUsers * 10000) / 100 : 0;
      // K-Factor: 공유당 평균 신규 유입 추정 (공유 횟수 / 공유 사용자 × 전환율 가정 0.1)
      data.kFactor = sharers > 0 ? Math.round((shareCount / sharers) * 0.1 * 100) / 100 : 0;
    }

    // Cohort retention
    if (queryResults.cohort[0]?.length > 0) {
      data.cohortRetention = queryResults.cohort[0].map(row => ({
        cohort: row.cohort,
        m0: parseInt(row.m0) || 0,
        m1: parseInt(row.m1) || 0,
        m2: parseInt(row.m2) || 0,
        m3: parseInt(row.m3) || 0,
        m1Rate: row.m0 > 0 ? Math.round(row.m1 / row.m0 * 100) : 0,
        m2Rate: row.m0 > 0 ? Math.round(row.m2 / row.m0 * 100) : 0,
        m3Rate: row.m0 > 0 ? Math.round(row.m3 / row.m0 * 100) : 0
      }));
    }

    // === DERIVED METRICS ===
    if (data.revenue && data.payingUsers) {
      data.arppu = Math.round(data.revenue / data.payingUsers);
    }
    if (data.mau && data.payingUsers) {
      data.conversionRate = Math.round(data.payingUsers / data.mau * 10000) / 100;
    }
    if (data.payingUsers && adSpend) {
      data.cac = Math.round(adSpend / data.payingUsers);
    }
    if (data.arppu && data.cac) {
      // 분석팀 정의: 실제 평균 구매 횟수 (총 주문 수 / 구매자 수)
      const avgPurchases = data.avgPurchasesReal || 1;
      data.ltv = Math.round(data.arppu * avgPurchases);
      data.ltvCac = Math.round(data.ltv / data.cac * 100) / 100;
      data.avgPurchases = avgPurchases;
    }
    if (data.revenue && adSpend) {
      data.roas = Math.round(data.revenue / adSpend * 100) / 100;
    }
    if (data.revenue && aiCost) {
      const paymentFee = data.revenue * 0.025;
      data.paymentFee = Math.round(paymentFee);
      data.grossMargin = Math.round((1 - (aiCost + paymentFee) / data.revenue) * 1000) / 10;
    }

    // Net revenue fallback
    if (data.netRevenue === 0 && data.revenue > 0) {
      data.netRevenue = data.revenue;
    }

    // ARR and cost data
    data.arr = data.revenue * 12;
    data.adSpend = adSpend;
    data.aiCost = aiCost;

    // Achievement percentages vs Pre-A benchmarks
    data.achievements = {
      mau: Math.round(data.mau / benchmarks.mau * 100),
      mrr: Math.round(data.revenue / benchmarks.mrr * 100),
      ltvCac: Math.round(data.ltvCac / benchmarks.ltvCac * 100),
      conversionRate: Math.round(data.conversionRate / benchmarks.conversionRate * 100),
      d1Retention: Math.round(data.d1Retention / benchmarks.d1Retention * 100),
      grossMargin: Math.round(data.grossMargin / benchmarks.grossMargin * 100)
    };

    res.status(200).json({ success: true, data, updatedAt: new Date().toISOString() });

  } catch (error) {
    console.error('API Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};
