const { BigQuery } = require('@google-cloud/bigquery');
const { Pool } = require('pg');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  try {
    const { months = 6 } = req.query;
    const numMonths = Math.min(parseInt(months) || 6, 12);

    // BigQuery setup
    const credentials = JSON.parse(
      Buffer.from(process.env.BIGQUERY_KEY, 'base64').toString('utf-8')
    );
    const bigquery = new BigQuery({ credentials, projectId: credentials.project_id });

    // Calculate date range (all months in one query)
    const endDate = new Date();
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - numMonths + 1);
    startDate.setDate(1);

    const startStr = startDate.toISOString().slice(0, 10).replace(/-/g, '');
    const endStr = endDate.toISOString().slice(0, 10).replace(/-/g, '');
    const startDateStr = startDate.toISOString().slice(0, 10);
    const endDateStr = endDate.toISOString().slice(0, 10);

    // Run all BigQuery queries in parallel
    const [mauResult, revenueResult, stickinessResult] = await Promise.all([
      // MAU by month
      bigquery.query({
        query: `
          SELECT
            FORMAT_DATE('%Y-%m', PARSE_DATE('%Y%m%d', event_date)) as month,
            COUNT(DISTINCT user_pseudo_id) as mau
          FROM \`cheongimun.analytics_515600551.events_*\`
          WHERE _TABLE_SUFFIX BETWEEN '${startStr}' AND '${endStr}'
          GROUP BY month
          ORDER BY month`
      }),
      // Revenue & Paying Users by month
      bigquery.query({
        query: `
          SELECT
            FORMAT_DATE('%Y-%m', DATE(created_at)) as month,
            SUM(total_amount) as revenue,
            COUNT(DISTINCT customer_phone) as paying_users
          FROM \`cheongimun.supabase_sync.orders\`
          WHERE payment_status = 'PAID'
            AND DATE(created_at) BETWEEN '${startDateStr}' AND '${endDateStr}'
          GROUP BY month
          ORDER BY month`
      }),
      // DAU for stickiness by month
      bigquery.query({
        query: `
          SELECT
            FORMAT_DATE('%Y-%m', PARSE_DATE('%Y%m%d', event_date)) as month,
            ROUND(AVG(dau), 0) as avg_dau
          FROM (
            SELECT event_date, COUNT(DISTINCT user_pseudo_id) as dau
            FROM \`cheongimun.analytics_515600551.events_*\`
            WHERE _TABLE_SUFFIX BETWEEN '${startStr}' AND '${endStr}'
            GROUP BY event_date
          )
          GROUP BY month
          ORDER BY month`
      })
    ]);

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
        connectionTimeoutMillis: 8000
      });
      const client = await pool.connect();

      const [adResult, aiResult] = await Promise.all([
        client.query(`
          SELECT TO_CHAR(DATE_TRUNC('month', performance_date), 'YYYY-MM') as month, SUM(spend) as spend
          FROM adset_performance
          WHERE performance_date >= $1
          GROUP BY DATE_TRUNC('month', performance_date)
          ORDER BY month`, [startDate]),
        client.query(`
          SELECT TO_CHAR(DATE_TRUNC('month', created_at), 'YYYY-MM') as month, SUM(cost_krw) as cost
          FROM api_costs
          WHERE created_at >= $1
          GROUP BY DATE_TRUNC('month', created_at)
          ORDER BY month`, [startDate])
      ]);

      adResult.rows.forEach(row => { adSpendByMonth[row.month] = parseFloat(row.spend) || 0; });
      aiResult.rows.forEach(row => { aiCostByMonth[row.month] = parseFloat(row.cost) || 0; });

      client.release();
      await pool.end();
    } catch (e) {
      console.log('PostgreSQL error:', e.message);
    }

    // Combine data by month
    const mauByMonth = {};
    const revenueByMonth = {};
    const payingByMonth = {};
    const dauByMonth = {};

    mauResult[0].forEach(row => { mauByMonth[row.month] = parseInt(row.mau) || 0; });
    revenueResult[0].forEach(row => {
      revenueByMonth[row.month] = parseInt(row.revenue) || 0;
      payingByMonth[row.month] = parseInt(row.paying_users) || 0;
    });
    stickinessResult[0].forEach(row => { dauByMonth[row.month] = parseInt(row.avg_dau) || 0; });

    // Build history array
    const history = [];
    for (let i = 0; i < numMonths; i++) {
      const date = new Date();
      date.setMonth(date.getMonth() - (numMonths - 1 - i));
      const month = date.toISOString().slice(0, 7);
      const monthLabel = `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}`;

      const mau = mauByMonth[month] || 0;
      const revenue = revenueByMonth[month] || 0;
      const payingUsers = payingByMonth[month] || 0;
      const avgDau = dauByMonth[month] || 0;
      const adSpend = adSpendByMonth[month] || 0;
      const aiCost = aiCostByMonth[month] || 0;

      const arppu = payingUsers > 0 ? Math.round(revenue / payingUsers) : 0;
      const conversionRate = mau > 0 ? Math.round(payingUsers / mau * 10000) / 100 : 0;
      const cac = payingUsers > 0 && adSpend > 0 ? Math.round(adSpend / payingUsers) : 0;
      const ltvCac = cac > 0 ? Math.round(arppu / cac * 100) / 100 : 0;
      const roas = adSpend > 0 ? Math.round(revenue / adSpend * 100) / 100 : 0;
      const grossMargin = revenue > 0 && aiCost > 0 ? Math.round((1 - aiCost / revenue) * 1000) / 10 : 85;
      const stickiness = mau > 0 ? Math.round(avgDau / mau * 10000) / 100 : 0;

      const data = {
        month, monthLabel, mau, revenue, payingUsers, arppu, conversionRate,
        cac, ltvCac, roas, grossMargin, stickiness, d1Retention: 4.5, repurchaseRate: 3.0,
        adSpend, aiCost
      };

      // Calculate MoM changes
      if (history.length > 0) {
        const prev = history[history.length - 1];
        data.mauChange = prev.mau > 0 ? Math.round((mau - prev.mau) / prev.mau * 1000) / 10 : 0;
        data.revenueChange = prev.revenue > 0 ? Math.round((revenue - prev.revenue) / prev.revenue * 1000) / 10 : 0;
        data.arppuChange = prev.arppu > 0 ? Math.round((arppu - prev.arppu) / prev.arppu * 1000) / 10 : 0;
        data.cacChange = prev.cac > 0 ? Math.round((cac - prev.cac) / prev.cac * 1000) / 10 : 0;
        data.ltvCacChange = prev.ltvCac > 0 ? Math.round((ltvCac - prev.ltvCac) / prev.ltvCac * 1000) / 10 : 0;
        data.conversionChange = prev.conversionRate > 0 ? Math.round((conversionRate - prev.conversionRate) / prev.conversionRate * 1000) / 10 : 0;
      }

      history.push(data);
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
