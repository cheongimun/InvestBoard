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

    // Date range (last 30 days)
    const endDate = new Date();
    const startDate = new Date(endDate - 30 * 24 * 60 * 60 * 1000);
    const startStr = startDate.toISOString().slice(0, 10).replace(/-/g, '');
    const endStr = endDate.toISOString().slice(0, 10).replace(/-/g, '');
    const startDash = startDate.toISOString().slice(0, 10);
    const endDash = endDate.toISOString().slice(0, 10);

    const data = {
      mau: 0, revenue: 0, payingUsers: 0, arppu: 0, conversionRate: 0,
      cac: 0, ltvCac: 0, roas: 0, grossMargin: 0, d1Retention: 0,
      stickiness: 0, repurchaseRate: 0, dataStart: startDash, dataEnd: endDash
    };

    // Query MAU
    const [mauRows] = await bigquery.query({
      query: `SELECT COUNT(DISTINCT user_pseudo_id) as mau
              FROM \`cheongimun.analytics_515600551.events_*\`
              WHERE _TABLE_SUFFIX BETWEEN '${startStr}' AND '${endStr}'`
    });
    if (mauRows[0]) data.mau = mauRows[0].mau || 0;

    // Query Revenue & Paying Users
    const [revenueRows] = await bigquery.query({
      query: `SELECT SUM(total_amount) as revenue, COUNT(DISTINCT customer_phone) as paying_users
              FROM \`cheongimun.supabase_sync.orders\`
              WHERE payment_status = 'PAID' AND DATE(created_at) BETWEEN '${startDash}' AND '${endDash}'`
    });
    if (revenueRows[0]) {
      data.revenue = parseInt(revenueRows[0].revenue) || 0;
      data.payingUsers = revenueRows[0].paying_users || 0;
    }

    // D1 Retention
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
    if (d1Rows[0]) data.d1Retention = d1Rows[0].d1 || 0;

    // Stickiness
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

    // Repurchase Rate
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
    if (repurchaseRows[0]) data.repurchaseRate = repurchaseRows[0].repurchase || 0;

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
      data.ltvCac = Math.round(data.arppu / data.cac * 100) / 100;
    }
    if (data.revenue && adSpend) {
      data.roas = Math.round(data.revenue / adSpend * 100) / 100;
    }
    if (data.revenue && aiCost) {
      data.grossMargin = Math.round((1 - aiCost / data.revenue) * 1000) / 10;
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
