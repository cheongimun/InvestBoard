const { BigQuery } = require('@google-cloud/bigquery');
const { Pool } = require('pg');

module.exports = async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  try {
    // Query parameters: ?months=12 (last N months)
    const { months = 12 } = req.query;

    // BigQuery setup
    const credentials = JSON.parse(
      Buffer.from(process.env.BIGQUERY_KEY, 'base64').toString('utf-8')
    );
    const bigquery = new BigQuery({ credentials, projectId: credentials.project_id });

    // Generate monthly date ranges
    const dateRanges = [];
    for (let i = parseInt(months) - 1; i >= 0; i--) {
      const date = new Date();
      date.setMonth(date.getMonth() - i);
      const monthStart = new Date(date.getFullYear(), date.getMonth(), 1);
      const monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 0);

      dateRanges.push({
        month: date.toISOString().slice(0, 7),
        monthLabel: `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}`,
        start: monthStart.toISOString().slice(0, 10),
        end: monthEnd.toISOString().slice(0, 10),
        startStr: monthStart.toISOString().slice(0, 10).replace(/-/g, ''),
        endStr: monthEnd.toISOString().slice(0, 10).replace(/-/g, '')
      });
    }

    // PostgreSQL - Get ad spend and AI costs by month
    let adSpendByMonth = {}, aiCostByMonth = {};
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

      // Get ad spend by month
      const adResult = await client.query(`
        SELECT DATE_TRUNC('month', performance_date) as month, SUM(spend) as spend
        FROM adset_performance
        GROUP BY DATE_TRUNC('month', performance_date)
        ORDER BY month DESC
      `);
      adResult.rows.forEach(row => {
        const month = row.month.toISOString().slice(0, 7);
        adSpendByMonth[month] = parseFloat(row.spend) || 0;
      });

      // Get AI costs by month
      const aiResult = await client.query(`
        SELECT DATE_TRUNC('month', created_at) as month, SUM(cost_krw) as cost
        FROM api_costs
        GROUP BY DATE_TRUNC('month', created_at)
        ORDER BY month DESC
      `);
      aiResult.rows.forEach(row => {
        const month = row.month.toISOString().slice(0, 7);
        aiCostByMonth[month] = parseFloat(row.cost) || 0;
      });

      client.release();
      await pool.end();
    } catch (e) {
      console.log('PostgreSQL error:', e.message);
    }

    const history = [];

    // Query each month
    for (const range of dateRanges) {
      const data = {
        month: range.month,
        monthLabel: range.monthLabel,
        mau: 0,
        revenue: 0,
        payingUsers: 0,
        arppu: 0,
        conversionRate: 0,
        cac: 0,
        ltvCac: 0,
        roas: 0,
        grossMargin: 0,
        d1Retention: 0,
        stickiness: 0,
        repurchaseRate: 0,
        adSpend: 0,
        aiCost: 0
      };

      try {
        // Query MAU
        const [mauRows] = await bigquery.query({
          query: `SELECT COUNT(DISTINCT user_pseudo_id) as mau
                  FROM \`cheongimun.analytics_515600551.events_*\`
                  WHERE _TABLE_SUFFIX BETWEEN '${range.startStr}' AND '${range.endStr}'`
        });
        if (mauRows[0]) data.mau = parseInt(mauRows[0].mau) || 0;

        // Query Revenue & Paying Users
        const [revenueRows] = await bigquery.query({
          query: `SELECT SUM(total_amount) as revenue, COUNT(DISTINCT customer_phone) as paying_users
                  FROM \`cheongimun.supabase_sync.orders\`
                  WHERE payment_status = 'PAID' AND DATE(created_at) BETWEEN '${range.start}' AND '${range.end}'`
        });
        if (revenueRows[0]) {
          data.revenue = parseInt(revenueRows[0].revenue) || 0;
          data.payingUsers = parseInt(revenueRows[0].paying_users) || 0;
        }

        // Query D1 Retention
        const [d1Rows] = await bigquery.query({
          query: `WITH user_first AS (
                    SELECT user_pseudo_id, MIN(PARSE_DATE('%Y%m%d', event_date)) as first_date
                    FROM \`cheongimun.analytics_515600551.events_*\`
                    WHERE _TABLE_SUFFIX BETWEEN '${range.startStr}' AND '${range.endStr}'
                    GROUP BY user_pseudo_id
                  ),
                  d1 AS (
                    SELECT DISTINCT f.user_pseudo_id
                    FROM user_first f
                    JOIN \`cheongimun.analytics_515600551.events_*\` e
                      ON f.user_pseudo_id = e.user_pseudo_id
                      AND PARSE_DATE('%Y%m%d', e.event_date) = DATE_ADD(f.first_date, INTERVAL 1 DAY)
                    WHERE e._TABLE_SUFFIX BETWEEN '${range.startStr}' AND '${range.endStr}'
                  )
                  SELECT ROUND(COUNT(DISTINCT d.user_pseudo_id) / NULLIF(COUNT(DISTINCT f.user_pseudo_id), 0) * 100, 2) as d1
                  FROM user_first f LEFT JOIN d1 d ON f.user_pseudo_id = d.user_pseudo_id`
        });
        if (d1Rows[0]) data.d1Retention = parseFloat(d1Rows[0].d1) || 0;

        // Query Stickiness (DAU/MAU)
        const [stickinessRows] = await bigquery.query({
          query: `WITH daily AS (
                    SELECT event_date, COUNT(DISTINCT user_pseudo_id) as dau
                    FROM \`cheongimun.analytics_515600551.events_*\`
                    WHERE _TABLE_SUFFIX BETWEEN '${range.startStr}' AND '${range.endStr}'
                    GROUP BY event_date
                  )
                  SELECT ROUND(AVG(dau), 0) as avg_dau FROM daily`
        });
        if (stickinessRows[0] && data.mau > 0) {
          const avgDau = parseInt(stickinessRows[0].avg_dau) || 0;
          data.stickiness = Math.round(avgDau / data.mau * 10000) / 100;
        }

        // Query Repurchase Rate
        const [repurchaseRows] = await bigquery.query({
          query: `SELECT ROUND(
                    COUNT(DISTINCT CASE WHEN order_count > 1 THEN customer_phone END) /
                    NULLIF(COUNT(DISTINCT customer_phone), 0) * 100, 2
                  ) as repurchase
                  FROM (
                    SELECT customer_phone, COUNT(*) as order_count
                    FROM \`cheongimun.supabase_sync.orders\`
                    WHERE payment_status = 'PAID' AND DATE(created_at) BETWEEN '${range.start}' AND '${range.end}'
                    GROUP BY customer_phone
                  )`
        });
        if (repurchaseRows[0]) data.repurchaseRate = parseFloat(repurchaseRows[0].repurchase) || 0;

        // Add PostgreSQL data
        data.adSpend = adSpendByMonth[range.month] || 0;
        data.aiCost = aiCostByMonth[range.month] || 0;

        // Calculate derived metrics
        if (data.revenue > 0 && data.payingUsers > 0) {
          data.arppu = Math.round(data.revenue / data.payingUsers);
        }
        if (data.mau > 0 && data.payingUsers > 0) {
          data.conversionRate = Math.round(data.payingUsers / data.mau * 10000) / 100;
        }
        if (data.payingUsers > 0 && data.adSpend > 0) {
          data.cac = Math.round(data.adSpend / data.payingUsers);
        }
        if (data.arppu > 0 && data.cac > 0) {
          data.ltvCac = Math.round(data.arppu / data.cac * 100) / 100;
        }
        if (data.revenue > 0 && data.adSpend > 0) {
          data.roas = Math.round(data.revenue / data.adSpend * 100) / 100;
        }
        if (data.revenue > 0 && data.aiCost > 0) {
          data.grossMargin = Math.round((1 - data.aiCost / data.revenue) * 1000) / 10;
        }

        // Calculate MoM changes
        if (history.length > 0) {
          const prev = history[history.length - 1];
          data.mauChange = prev.mau > 0 ? Math.round((data.mau - prev.mau) / prev.mau * 1000) / 10 : 0;
          data.revenueChange = prev.revenue > 0 ? Math.round((data.revenue - prev.revenue) / prev.revenue * 1000) / 10 : 0;
          data.arppuChange = prev.arppu > 0 ? Math.round((data.arppu - prev.arppu) / prev.arppu * 1000) / 10 : 0;
          data.cacChange = prev.cac > 0 ? Math.round((data.cac - prev.cac) / prev.cac * 1000) / 10 : 0;
          data.ltvCacChange = prev.ltvCac > 0 ? Math.round((data.ltvCac - prev.ltvCac) / prev.ltvCac * 1000) / 10 : 0;
          data.conversionChange = prev.conversionRate > 0 ? Math.round((data.conversionRate - prev.conversionRate) / prev.conversionRate * 1000) / 10 : 0;
        }

        history.push(data);
      } catch (monthError) {
        console.error(`Error processing month ${range.month}:`, monthError.message);
        history.push({ ...data, error: monthError.message });
      }
    }

    res.status(200).json({
      success: true,
      data: history,
      count: history.length,
      updatedAt: new Date().toISOString()
    });

  } catch (error) {
    console.error('API Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};
