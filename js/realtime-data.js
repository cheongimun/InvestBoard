(function() {
  'use strict';

  async function loadRealtimeData() {
    try {
      console.log('Loading realtime data from API...');
      const response = await fetch('/api/kpi');
      const result = await response.json();

      if (!result.success) {
        console.error('API Error:', result.error);
        return;
      }

      const data = result.data;
      console.log('Data loaded:', data);

      // Update date range display
      const dateElements = document.querySelectorAll('.badge-green');
      dateElements.forEach(el => {
        if (el.textContent.includes('데이터')) {
          el.textContent = `데이터: ${data.dataStart} ~ ${data.dataEnd} (실시간)`;
        }
      });

      // Format helpers
      const formatNumber = n => n?.toLocaleString('ko-KR') || '0';
      const formatWon = n => '₩' + formatNumber(n);
      const formatPercent = n => (n || 0).toFixed(2) + '%';
      const formatX = n => (n || 0).toFixed(2) + 'x';

      // Update all metric values by searching text content
      const updateText = (searchText, newValue) => {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
        while (walker.nextNode()) {
          const node = walker.currentNode;
          if (node.textContent.includes(searchText)) {
            node.textContent = node.textContent.replace(searchText, newValue);
          }
        }
      };

      // Revenue patterns
      const revenueStr = formatNumber(data.revenue);
      updateText('87,922,500', revenueStr);
      updateText('108,094,700', revenueStr);

      // MAU
      const mauStr = formatNumber(data.mau);
      updateText('60,000', mauStr);
      updateText('57,786', mauStr);
      updateText('66,099', mauStr);

      // ARPPU
      const arppuStr = formatNumber(data.arppu);
      updateText('35,843', arppuStr);
      updateText('35,924', arppuStr);

      // Paying users
      const payingStr = formatNumber(data.payingUsers);
      updateText('2,453', payingStr);
      updateText('3,009', payingStr);

      // Conversion rate
      updateText('4.11%', formatPercent(data.conversionRate));
      updateText('4.24%', formatPercent(data.conversionRate));
      updateText('4.55%', formatPercent(data.conversionRate));

      // CAC
      updateText('21,590', formatNumber(data.cac));
      updateText('20,580', formatNumber(data.cac));
      updateText('20,903', formatNumber(data.cac));

      // LTV/CAC
      updateText('1.66x', formatX(data.ltvCac));
      updateText('1.74x', formatX(data.ltvCac));
      updateText('1.72x', formatX(data.ltvCac));

      // ROAS
      updateText('1.66', data.roas?.toFixed(2) || '0');

      // Stickiness
      updateText('3.79%', formatPercent(data.stickiness));
      updateText('3.66%', formatPercent(data.stickiness));
      updateText('3.83%', formatPercent(data.stickiness));

      // D1 Retention
      updateText('4.45%', formatPercent(data.d1Retention));
      updateText('4.39%', formatPercent(data.d1Retention));

      // Gross Margin
      updateText('75.3%', data.grossMargin?.toFixed(1) + '%');
      updateText('85.7%', data.grossMargin?.toFixed(1) + '%');

      // Repurchase
      updateText('2.73%', formatPercent(data.repurchaseRate));
      updateText('2.92%', formatPercent(data.repurchaseRate));

      // ARR
      const arrEok = (data.arr / 100000000).toFixed(1);
      updateText('10.5억', arrEok + '억');
      updateText('10.6억', arrEok + '억');
      updateText('13.0억', arrEok + '억');

      console.log('Dashboard updated with realtime data');

    } catch (error) {
      console.error('Failed to load realtime data:', error);
    }
  }

  // Load on page ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadRealtimeData);
  } else {
    loadRealtimeData();
  }

  // Refresh every 5 minutes
  setInterval(loadRealtimeData, 5 * 60 * 1000);
})();
