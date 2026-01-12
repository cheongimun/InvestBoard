(function() {
  'use strict';

  // Format helpers
  const formatMan = n => (n / 10000).toFixed(1) + '만';
  const formatManWon = n => Math.round(n / 10000).toLocaleString('ko-KR') + '만';
  const formatWon = n => n.toLocaleString('ko-KR') + '원';
  const formatPercent = n => n.toFixed(2) + '%';
  const formatX = n => n.toFixed(2) + 'x';

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

      // Update date range badge
      const dateEl = document.querySelector('[data-kpi="dateRange"]');
      if (dateEl) {
        const now = new Date().toLocaleString('ko-KR', {
          year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit'
        });
        dateEl.textContent = `데이터: ${data.dataStart} ~ ${data.dataEnd} (갱신: ${now})`;
      }

      // KPI value mappings
      const kpiFormats = {
        mau: () => formatMan(data.mau),
        mrr: () => formatManWon(data.revenue),
        arppu: () => formatWon(data.arppu),
        cac: () => formatWon(data.cac),
        ltv: () => formatWon(data.arppu) + '+',
        ltvCac: () => formatX(data.ltvCac),
        roas: () => formatX(data.roas),
        conversionRate: () => formatPercent(data.conversionRate),
        d1Retention: () => formatPercent(data.d1Retention),
        stickiness: () => formatPercent(data.stickiness),
        grossMargin: () => data.grossMargin.toFixed(1) + '%',
        repurchaseRate: () => formatPercent(data.repurchaseRate),
        payingUsers: () => data.payingUsers.toLocaleString('ko-KR') + '명',
        arr: () => (data.arr / 100000000).toFixed(1) + '억'
      };

      // Update all elements with data-kpi attribute
      Object.keys(kpiFormats).forEach(key => {
        const elements = document.querySelectorAll(`[data-kpi="${key}"]`);
        elements.forEach(el => {
          const newValue = kpiFormats[key]();
          if (el.textContent !== newValue) {
            el.textContent = newValue;
            // Add update animation
            el.style.transition = 'color 0.3s';
            el.style.color = '#10b981';
            setTimeout(() => {
              el.style.color = '';
            }, 1000);
          }
        });
      });

      console.log('[Realtime] Dashboard updated successfully');

    } catch (error) {
      console.error('[Realtime] Failed to load data:', error);
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

  // Expose for manual refresh
  window.refreshDashboard = loadRealtimeData;
})();
