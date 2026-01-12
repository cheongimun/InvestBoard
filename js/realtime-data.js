(function() {
  'use strict';

  async function loadRealtimeData() {
    try {
      console.log('[Realtime] Fetching data from API...');
      const response = await fetch('/api/kpi');
      const result = await response.json();

      if (!result.success) {
        console.error('[Realtime] API Error:', result.error);
        return;
      }

      const data = result.data;
      console.log('[Realtime] Data received:', data);

      // Format helpers
      const formatMan = n => (n / 10000).toFixed(1) + '만';
      const formatManWon = n => Math.round(n / 10000).toLocaleString('ko-KR') + '만';
      const formatManWonUnit = n => Math.round(n / 10000).toLocaleString('ko-KR') + '만원';
      const formatEok = n => (n / 100000000).toFixed(2) + '억';
      const formatEokShort = n => (n / 100000000).toFixed(1) + '억';
      const formatWon = n => n.toLocaleString('ko-KR') + '원';
      const formatNum = n => n.toLocaleString('ko-KR');
      const formatPercent = n => n.toFixed(2) + '%';
      const formatPercentShort = n => n.toFixed(1) + '%';
      const formatX = n => n.toFixed(2) + 'x';
      const formatXShort = n => n.toFixed(1) + 'x';

      // Update date range badge
      const dateEl = document.querySelector('[data-kpi="dateRange"]');
      if (dateEl) {
        const now = new Date().toLocaleString('ko-KR', {
          year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit'
        });
        dateEl.textContent = `데이터: ${data.dataStart} ~ ${data.dataEnd} (갱신: ${now})`;
      }

      // KPI value mappings for data-kpi attributes
      const kpiFormats = {
        mau: formatMan(data.mau),
        mrr: formatManWon(data.revenue),
        arppu: formatWon(data.arppu),
        cac: formatWon(data.cac),
        ltv: formatWon(data.arppu) + '+',
        ltvCac: formatX(data.ltvCac),
        roas: formatX(data.roas),
        conversionRate: formatPercent(data.conversionRate),
        d1Retention: formatPercent(data.d1Retention),
        stickiness: formatPercent(data.stickiness),
        grossMargin: formatPercentShort(data.grossMargin),
        repurchaseRate: formatPercent(data.repurchaseRate),
        payingUsers: formatNum(data.payingUsers) + '명',
        arr: formatEokShort(data.arr)
      };

      // Update all elements with data-kpi attribute
      Object.keys(kpiFormats).forEach(key => {
        document.querySelectorAll(`[data-kpi="${key}"]`).forEach(el => {
          el.textContent = kpiFormats[key];
        });
      });

      // Comprehensive text replacement patterns
      // [old pattern, new value]
      const replacements = [
        // MAU patterns
        ['6.6만명', formatMan(data.mau) + '명'],
        ['6.6만', formatMan(data.mau)],
        ['6.0만', formatMan(data.mau)],
        ['60,000', formatNum(data.mau)],
        ['66,099명', formatNum(data.mau) + '명'],
        ['66,099', formatNum(data.mau)],
        ['57,786', formatNum(data.mau)],

        // MRR/Revenue patterns
        ['8,663만원', formatManWonUnit(data.revenue)],
        ['8,663만', formatManWon(data.revenue)],
        ['8,792만원', formatManWonUnit(data.revenue)],
        ['8,792만', formatManWon(data.revenue)],
        ['87,922,500', formatNum(data.revenue)],
        ['108,094,700', formatNum(data.revenue)],
        ['0.88억', formatEok(data.revenue)],
        ['MRR 0.88억', 'MRR ' + formatEok(data.revenue)],

        // ARR patterns
        ['10.4억원', formatEokShort(data.arr) + '원'],
        ['10.4억', formatEokShort(data.arr)],
        ['10.5억', formatEokShort(data.arr)],
        ['10.6억', formatEokShort(data.arr)],
        ['13.0억', formatEokShort(data.arr)],

        // ARPPU patterns
        ['34,820원+', formatWon(data.arppu) + '+'],
        ['34,820원', formatWon(data.arppu)],
        ['34,820', formatNum(data.arppu)],
        ['35,843원', formatWon(data.arppu)],
        ['35,843', formatNum(data.arppu)],
        ['35,924원', formatWon(data.arppu)],
        ['35,924', formatNum(data.arppu)],

        // Paying users
        ['2,453명', formatNum(data.payingUsers) + '명'],
        ['2,453', formatNum(data.payingUsers)],
        ['3,009명', formatNum(data.payingUsers) + '명'],
        ['3,009', formatNum(data.payingUsers)],

        // CAC patterns
        ['923원', formatWon(data.cac)],
        ['923', formatNum(data.cac)],
        ['21,590원', formatWon(data.cac)],
        ['21,590', formatNum(data.cac)],
        ['20,580원', formatWon(data.cac)],
        ['20,903원', formatWon(data.cac)],

        // LTV/CAC patterns
        ['37.7x', formatX(data.ltvCac)],
        ['1.66x', formatX(data.ltvCac)],
        ['1.74x', formatX(data.ltvCac)],
        ['1.72x', formatX(data.ltvCac)],

        // ROAS patterns
        ['1.42x', formatX(data.roas)],
        ['ROAS 1.42x', 'ROAS ' + formatX(data.roas)],

        // Conversion rate patterns
        ['3.76%', formatPercent(data.conversionRate)],
        ['4.11%', formatPercent(data.conversionRate)],
        ['4.24%', formatPercent(data.conversionRate)],
        ['4.55%', formatPercent(data.conversionRate)],

        // D1 Retention patterns
        ['4.4%', formatPercent(data.d1Retention)],
        ['4.45%', formatPercent(data.d1Retention)],
        ['4.39%', formatPercent(data.d1Retention)],

        // Stickiness patterns
        ['4.1%', formatPercent(data.stickiness)],
        ['3.79%', formatPercent(data.stickiness)],
        ['3.66%', formatPercent(data.stickiness)],
        ['3.83%', formatPercent(data.stickiness)],

        // Gross Margin patterns
        ['75.7%', formatPercentShort(data.grossMargin) + '%'],
        ['75.3%', formatPercentShort(data.grossMargin) + '%'],
        ['85.7%', formatPercentShort(data.grossMargin) + '%'],

        // Repurchase rate patterns
        ['2.73%', formatPercent(data.repurchaseRate)],
        ['2.92%', formatPercent(data.repurchaseRate)],
        ['2.8%', formatPercent(data.repurchaseRate)]
      ];

      // Perform text replacements in the DOM
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
        null,
        false
      );

      const textNodes = [];
      while (walker.nextNode()) {
        textNodes.push(walker.currentNode);
      }

      textNodes.forEach(node => {
        let text = node.textContent;
        let changed = false;

        replacements.forEach(([oldVal, newVal]) => {
          if (text.includes(oldVal)) {
            text = text.split(oldVal).join(newVal);
            changed = true;
          }
        });

        if (changed) {
          node.textContent = text;
        }
      });

      // Update LTV/CAC badge in header
      const ltvBadge = document.querySelector('[data-kpi="ltvCacBadge"]');
      if (ltvBadge) {
        const status = data.ltvCac >= 3 ? '달성' : '목표: 3x 이상';
        ltvBadge.textContent = `LTV/CAC ${formatX(data.ltvCac)} (${status})`;
      }

      // Update status indicators based on thresholds
      updateStatusIndicators(data);

      console.log('[Realtime] Dashboard fully updated with real data');

    } catch (error) {
      console.error('[Realtime] Failed to load data:', error);
    }
  }

  function updateStatusIndicators(data) {
    // Update status dots and text based on real values
    const statusConfig = {
      mau: { value: data.mau, thresholds: [50000, 100000], labels: ['양호', '우수'] },
      ltvCac: { value: data.ltvCac, thresholds: [1, 3], labels: ['개선필요', '양호', '우수'] },
      cac: { value: data.cac, thresholds: [10000, 30000], labels: ['우수', '양호', '개선필요'], inverse: true },
      roas: { value: data.roas, thresholds: [1, 2], labels: ['개선필요', '양호', '우수'] },
      d1Retention: { value: data.d1Retention, thresholds: [10, 20], labels: ['개선필요', '양호', '우수'] },
      stickiness: { value: data.stickiness, thresholds: [5, 10], labels: ['개선필요', '양호', '우수'] },
      grossMargin: { value: data.grossMargin, thresholds: [50, 70], labels: ['개선필요', '양호', '우수'] }
    };

    // This could be extended to update status badges dynamically
  }

  // Load on page ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadRealtimeData);
  } else {
    loadRealtimeData();
  }

  // Refresh every 5 minutes
  setInterval(loadRealtimeData, 5 * 60 * 1000);

  // Expose for manual refresh
  window.refreshDashboard = loadRealtimeData;
})();
