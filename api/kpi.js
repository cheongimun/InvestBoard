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
      payingMau: 0, freeOnlyMau: 0, payingRatio: 0,
      // New KPIs from additional tables
      netRevenue: 0, refundRate: 0, refundCount: 0, refundAmount: 0,
      totalUsers: 0, signupConversionRate: 0, churnRate: 0,
      paidD1Retention: 0, paidD7Retention: 0, paidD30Retention: 0,
      couponRedemptionRate: 0, couponROI: 0, couponIssuedCount: 0, couponUsedCount: 0,
      shareRate: 0, shareCount: 0, kFactor: 0,
      cohortRetention: [],
      dataStart: startDash, dataEnd: endDash, benchmarks
    };

    // === GA4 Hybrid MAU (옵션 1A) ===
    // GA4 데이터: 2026-01-22 이후
    // 이전 기간: session_id × visitorRatio(2.20) 추정
    const GA4_START_DATE = '2026-01-22';
    const VISITOR_RATIO = 2.20; // 실측 비율: GA4 MAU / Session MAU

    let ga4Mau = 0, estimatedMau = 0, engagedUsers = 0;

    // 1. GA4 MAU (2026-01-22 이후 실제 방문자)
    if (endDash >= GA4_START_DATE) {
      const ga4Start = startDash >= GA4_START_DATE ? startDash : GA4_START_DATE;
      const ga4StartSuffix = ga4Start.replace(/-/g, '');
      const ga4EndSuffix = endDash.replace(/-/g, '');

      try {
        const [ga4Rows] = await bigquery.query({
          query: `SELECT COUNT(DISTINCT user_pseudo_id) as mau
                  FROM \`${projectId}.analytics_515600551.events_*\`
                  WHERE _TABLE_SUFFIX BETWEEN '${ga4StartSuffix}' AND '${ga4EndSuffix}'`
        });
        if (ga4Rows[0]) ga4Mau = parseInt(ga4Rows[0].mau) || 0;
      } catch (e) {
        console.log('GA4 query error, using fallback:', e.message);
      }
    }

    // 2. Session-based MAU (전체 기간 - engaged users)
    const [sessionRows] = await bigquery.query({
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
    });
    if (sessionRows[0]) engagedUsers = parseInt(sessionRows[0].engaged) || 0;

    // 3. Estimated MAU (GA4 이전 기간)
    if (startDash < GA4_START_DATE) {
      const estimateEnd = endDash < GA4_START_DATE ? endDash : '2026-01-21';
      const [estRows] = await bigquery.query({
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
      });
      if (estRows[0]) {
        const preGa4Engaged = parseInt(estRows[0].engaged) || 0;
        estimatedMau = Math.round(preGa4Engaged * VISITOR_RATIO);
      }
    }

    // 4. Combined MAU (GA4 실측 + 추정치)
    data.mau = ga4Mau + estimatedMau;
    data.ga4Mau = ga4Mau;
    data.estimatedMau = estimatedMau;
    data.engagedUsers = engagedUsers;
    data.visitorRatio = VISITOR_RATIO;
    data.mauSource = ga4Mau > 0 && estimatedMau > 0 ? 'hybrid' : (ga4Mau > 0 ? 'ga4' : 'estimated');

    // Fallback: GA4 실패 시 전체 추정
    if (data.mau === 0 && engagedUsers > 0) {
      data.mau = Math.round(engagedUsers * VISITOR_RATIO);
      data.mauSource = 'fallback';
    }

    // Query Revenue & Paying Users
    const [revenueRows] = await bigquery.query({
      query: `SELECT SUM(total_amount) as revenue, COUNT(DISTINCT customer_phone) as paying_users
              FROM \`${projectId}.supabase_sync.orders\`
              WHERE payment_status = 'PAID' AND DATE(created_at) BETWEEN '${startDash}' AND '${endDash}'`
    });
    if (revenueRows[0]) {
      data.revenue = parseInt(revenueRows[0].revenue) || 0;
      data.payingUsers = parseInt(revenueRows[0].paying_users) || 0;
    }

    // MAU Hierarchy: Paying MAU (users who paid in period)
    data.payingMau = data.payingUsers;
    data.freeOnlyMau = Math.max(0, data.mau - data.payingUsers);
    data.payingRatio = data.mau > 0 ? Math.round(data.payingUsers / data.mau * 10000) / 100 : 0;

    // === Retention Queries (Improved: 3 tables + phone fallback + parallel execution) ===
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

    // Build retention query function
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

    // Build transaction retention query function
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

    // Execute all retention queries in parallel
    const [
      [d1Rows], [d7Rows], [d30Rows],
      [m1Rows], [m3Rows], [m6Rows]
    ] = await Promise.all([
      bigquery.query({ query: buildRetentionQuery(1) }),
      bigquery.query({ query: buildRetentionQuery(7) }),
      bigquery.query({ query: buildRetentionQuery(30) }),
      bigquery.query({ query: buildTxRetentionQuery(1, 30) }),
      bigquery.query({ query: buildTxRetentionQuery(31, 90) }),
      bigquery.query({ query: buildTxRetentionQuery(91, 180) })
    ]);

    // D1/D7/D30 Visit Retention
    if (d1Rows[0]) data.d1Retention = parseFloat(d1Rows[0].retention) || 0;
    if (d7Rows[0]) data.d7Retention = parseFloat(d7Rows[0].retention) || 0;
    if (d30Rows[0]) data.d30Retention = parseFloat(d30Rows[0].retention) || 0;

    // M1/M3/M6 Transaction Retention
    if (m1Rows[0]) data.m1Retention = parseFloat(m1Rows[0].retention) || 0;
    if (m3Rows[0]) data.m3Retention = parseFloat(m3Rows[0].retention) || 0;
    if (m6Rows[0]) data.m6Retention = parseFloat(m6Rows[0].retention) || 0;

    // Stickiness (DAU/MAU)
    const [stickinessRows] = await bigquery.query({
      query: `WITH daily AS (
                SELECT DATE(created_at) as date, COUNT(DISTINCT session_id) as dau
                FROM \`${projectId}.supabase_sync.free_saju_results\`
                WHERE DATE(created_at) BETWEEN '${startDash}' AND '${endDash}' AND session_id IS NOT NULL
                GROUP BY date
              )
              SELECT ROUND(AVG(dau), 0) as avg_dau FROM daily`
    });
    if (stickinessRows[0] && data.mau) {
      const avgDau = parseInt(stickinessRows[0].avg_dau) || 0;
      data.stickiness = Math.round(avgDau / data.mau * 10000) / 100;
      data.avgDau = avgDau;
    }

    // Repurchase Rate
    const [repurchaseRows] = await bigquery.query({
      query: `SELECT
                ROUND(COUNT(DISTINCT CASE WHEN order_count > 1 THEN customer_phone END) / NULLIF(COUNT(DISTINCT customer_phone), 0) * 100, 2) as repurchase,
                COUNT(DISTINCT CASE WHEN order_count > 1 THEN customer_phone END) as repurchase_customers
              FROM (
                SELECT customer_phone, COUNT(*) as order_count
                FROM \`${projectId}.supabase_sync.orders\`
                WHERE payment_status = 'PAID' AND DATE(created_at) BETWEEN '${startDash}' AND '${endDash}'
                GROUP BY customer_phone
              )`
    });
    if (repurchaseRows[0]) {
      data.repurchaseRate = parseFloat(repurchaseRows[0].repurchase) || 0;
      data.repurchaseCustomers = parseInt(repurchaseRows[0].repurchase_customers) || 0;
    }

    // PostgreSQL for ad spend and AI cost
    let adSpend = 52960184, aiCost = 21754819;
    try {
      const pool = new Pool({
        host: 'aws-1-ap-northeast-2.pooler.supabase.com',
        port: 6543,
        database: 'postgres',
        user: 'postgres.jlutbjmjpreauyanjzdd',
        password: process.env.SUPABASE_PASSWORD,
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 10000
      });
      const client = await pool.connect();

      const adResult = await client.query('SELECT SUM(spend) FROM adset_performance');
      if (adResult.rows[0]?.sum) adSpend = parseFloat(adResult.rows[0].sum);

      const aiResult = await client.query('SELECT SUM(cost_krw) FROM api_costs');
      if (aiResult.rows[0]?.sum) aiCost = parseFloat(aiResult.rows[0].sum);

      client.release();
      await pool.end();
    } catch (e) {
      console.log('PostgreSQL error, using defaults:', e.message);
    }

    // Calculate derived metrics
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
      const avgPurchases = 1 + (data.repurchaseRate / Math.max(100 - data.repurchaseRate, 1));
      data.ltv = Math.round(data.arppu * avgPurchases);
      data.ltvCac = Math.round(data.ltv / data.cac * 100) / 100;
      data.avgPurchases = Math.round(avgPurchases * 100) / 100;
    }
    if (data.revenue && adSpend) {
      data.roas = Math.round(data.revenue / adSpend * 100) / 100;
    }
    if (data.revenue && aiCost) {
      const paymentFee = data.revenue * 0.025;
      data.paymentFee = Math.round(paymentFee);
      data.grossMargin = Math.round((1 - (aiCost + paymentFee) / data.revenue) * 1000) / 10;
    }

    // ARR and cost data
    data.arr = data.revenue * 12;
    data.adSpend = adSpend;
    data.aiCost = aiCost;

    // === NEW: Transactions table - Net Revenue & Refund Rate ===
    // Try transactions table first, fallback to orders table data
    try {
      const [txRows] = await bigquery.query({
        query: `SELECT
                  COUNT(*) as total_tx,
                  SUM(CASE WHEN status = 'COMPLETED' OR status = 'PAID' THEN 1 ELSE 0 END) as completed_tx,
                  SUM(CASE WHEN status = 'REFUNDED' OR status = 'CANCELLED' THEN 1 ELSE 0 END) as refund_count,
                  SUM(CASE WHEN status = 'COMPLETED' OR status = 'PAID' THEN CAST(amount AS FLOAT64) ELSE 0 END) as gross_amount,
                  SUM(CASE WHEN status = 'REFUNDED' OR status = 'CANCELLED' THEN CAST(amount AS FLOAT64) ELSE 0 END) as refund_amount
                FROM \`${projectId}.supabase_sync.transactions\`
                WHERE DATE(created_at) BETWEEN '${startDash}' AND '${endDash}'`
      });
      if (txRows[0]) {
        const grossAmount = parseFloat(txRows[0].gross_amount) || 0;
        const refundAmount = parseFloat(txRows[0].refund_amount) || 0;
        const totalTx = parseInt(txRows[0].total_tx) || 0;
        const refundCount = parseInt(txRows[0].refund_count) || 0;

        data.netRevenue = Math.round(grossAmount - refundAmount);
        data.refundAmount = Math.round(refundAmount);
        data.refundCount = refundCount;
        data.refundRate = totalTx > 0 ? Math.round(refundCount / totalTx * 10000) / 100 : 0;
      }
    } catch (e) {
      console.log('Transactions query error, using orders table as fallback:', e.message);
    }

    // Fallback: If netRevenue is 0, use orders revenue (assume no refunds tracked)
    if (data.netRevenue === 0 && data.revenue > 0) {
      data.netRevenue = data.revenue;
      // 환불 데이터가 없으므로 환불율 0으로 표시 (실제 환불 없음 or 추적 안됨)
      data.refundRate = 0;
      data.refundCount = 0;
      data.refundAmount = 0;
    }

    // === NEW: Users table - Signup & Churn ===
    try {
      const [userRows] = await bigquery.query({
        query: `SELECT
                  COUNT(*) as total_users,
                  COUNT(CASE WHEN DATE(created_at) BETWEEN '${startDash}' AND '${endDash}' THEN 1 END) as new_users,
                  COUNT(CASE WHEN DATE(updated_at) < DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY) THEN 1 END) as churned_users
                FROM \`${projectId}.supabase_sync.users\``
      });
      if (userRows[0]) {
        data.totalUsers = parseInt(userRows[0].total_users) || 0;
        const newUsers = parseInt(userRows[0].new_users) || 0;
        const churnedUsers = parseInt(userRows[0].churned_users) || 0;

        data.signupConversionRate = data.mau > 0 ? Math.round(newUsers / data.mau * 10000) / 100 : 0;
        data.churnRate = data.totalUsers > 0 ? Math.round(churnedUsers / data.totalUsers * 10000) / 100 : 0;
        data.newUsers = newUsers;
      }
    } catch (e) {
      console.log('Users query error:', e.message);
    }

    // === NEW: Premium Results - Paid User Retention ===
    // Try premium_saju_results table first, then fallback to orders table
    try {
      const paidRetentionQuery = (intervalDays) => `
        WITH paid_users AS (
          SELECT DISTINCT COALESCE(phone, session_id) as user_id, MIN(DATE(created_at, 'Asia/Seoul')) as first_date
          FROM \`${projectId}.supabase_sync.premium_saju_results\`
          WHERE COALESCE(phone, session_id) IS NOT NULL
            AND DATE(created_at) BETWEEN '${startDash}' AND '${endDash}'
          GROUP BY user_id
        ),
        returned AS (
          SELECT DISTINCT p.user_id
          FROM paid_users p
          JOIN \`${projectId}.supabase_sync.premium_saju_results\` r
            ON COALESCE(r.phone, r.session_id) = p.user_id
            AND DATE(r.created_at, 'Asia/Seoul') = DATE_ADD(p.first_date, INTERVAL ${intervalDays} DAY)
        )
        SELECT
          COUNT(DISTINCT p.user_id) as cohort_size,
          COUNT(DISTINCT r.user_id) as returned_users,
          ROUND(COUNT(DISTINCT r.user_id) / NULLIF(COUNT(DISTINCT p.user_id), 0) * 100, 2) as retention
        FROM paid_users p
        LEFT JOIN returned r ON p.user_id = r.user_id
      `;

      const [[paidD1], [paidD7], [paidD30]] = await Promise.all([
        bigquery.query({ query: paidRetentionQuery(1) }),
        bigquery.query({ query: paidRetentionQuery(7) }),
        bigquery.query({ query: paidRetentionQuery(30) })
      ]);

      if (paidD1[0]) data.paidD1Retention = parseFloat(paidD1[0].retention) || 0;
      if (paidD7[0]) data.paidD7Retention = parseFloat(paidD7[0].retention) || 0;
      if (paidD30[0]) data.paidD30Retention = parseFloat(paidD30[0].retention) || 0;
    } catch (e) {
      console.log('Paid retention query (premium_saju_results) error, trying orders fallback:', e.message);

      // Fallback: Calculate paid user retention from orders table
      try {
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

        const [[paidD1Fallback], [paidD7Fallback], [paidD30Fallback]] = await Promise.all([
          bigquery.query({ query: paidRetentionOrdersQuery(1) }),
          bigquery.query({ query: paidRetentionOrdersQuery(7) }),
          bigquery.query({ query: paidRetentionOrdersQuery(30) })
        ]);

        if (paidD1Fallback[0]) data.paidD1Retention = parseFloat(paidD1Fallback[0].retention) || 0;
        if (paidD7Fallback[0]) data.paidD7Retention = parseFloat(paidD7Fallback[0].retention) || 0;
        if (paidD30Fallback[0]) data.paidD30Retention = parseFloat(paidD30Fallback[0].retention) || 0;
        console.log('Paid retention calculated from orders table');
      } catch (fallbackError) {
        console.log('Paid retention fallback (orders) also failed:', fallbackError.message);
      }
    }

    // === NEW: Coupons - Redemption Rate & ROI ===
    try {
      const [[couponRows], [usageRows]] = await Promise.all([
        bigquery.query({
          query: `SELECT COUNT(*) as issued, SUM(CAST(discount_amount AS FLOAT64)) as total_discount
                  FROM \`${projectId}.supabase_sync.coupons\`
                  WHERE DATE(created_at) BETWEEN '${startDash}' AND '${endDash}'`
        }),
        bigquery.query({
          query: `SELECT COUNT(*) as used, SUM(CAST(discount_applied AS FLOAT64)) as discount_used
                  FROM \`${projectId}.supabase_sync.coupon_usages\`
                  WHERE DATE(created_at) BETWEEN '${startDash}' AND '${endDash}'`
        })
      ]);

      if (couponRows[0] && usageRows[0]) {
        const issued = parseInt(couponRows[0].issued) || 0;
        const used = parseInt(usageRows[0].used) || 0;
        const discountUsed = parseFloat(usageRows[0].discount_used) || 0;

        data.couponIssuedCount = issued;
        data.couponUsedCount = used;
        data.couponRedemptionRate = issued > 0 ? Math.round(used / issued * 10000) / 100 : 0;
        // ROI: (revenue from coupon users - discount) / discount
        data.couponDiscountAmount = Math.round(discountUsed);
      }
    } catch (e) {
      console.log('Coupons query error:', e.message);
    }

    // === NEW: Share Logs - Share Rate & K-Factor ===
    try {
      const [[shareRows], [freeResultRows]] = await Promise.all([
        bigquery.query({
          query: `SELECT COUNT(*) as share_count, COUNT(DISTINCT session_id) as sharers
                  FROM \`${projectId}.supabase_sync.free_saju_share_logs\`
                  WHERE DATE(created_at) BETWEEN '${startDash}' AND '${endDash}'`
        }),
        bigquery.query({
          query: `SELECT COUNT(*) as free_count
                  FROM \`${projectId}.supabase_sync.free_saju_results\`
                  WHERE DATE(created_at) BETWEEN '${startDash}' AND '${endDash}'`
        })
      ]);

      if (shareRows[0] && freeResultRows[0]) {
        const shareCount = parseInt(shareRows[0].share_count) || 0;
        const sharers = parseInt(shareRows[0].sharers) || 0;
        const freeCount = parseInt(freeResultRows[0].free_count) || 0;

        data.shareCount = shareCount;
        data.shareRate = freeCount > 0 ? Math.round(shareCount / freeCount * 10000) / 100 : 0;
        // K-Factor approximation: shares per user * conversion rate
        // Simplified: (shareCount / sharers) * (invites that convert / total shares)
        // Using 10% conversion assumption for shares
        data.kFactor = sharers > 0 ? Math.round((shareCount / sharers) * 0.1 * 100) / 100 : 0;
      }
    } catch (e) {
      console.log('Share logs query error:', e.message);
    }

    // === NEW: Monthly Cohort Retention ===
    try {
      const [cohortRows] = await bigquery.query({
        query: `WITH user_cohorts AS (
                  SELECT
                    customer_phone,
                    DATE_TRUNC(MIN(DATE(created_at, 'Asia/Seoul')), MONTH) as cohort_month,
                    MIN(DATE(created_at, 'Asia/Seoul')) as first_order_date
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
      });

      if (cohortRows && cohortRows.length > 0) {
        data.cohortRetention = cohortRows.map(row => ({
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
    } catch (e) {
      console.log('Cohort retention query error:', e.message);
    }

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
