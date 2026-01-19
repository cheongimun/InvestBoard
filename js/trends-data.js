/**
 * 월별 추이 데이터 로더
 * 페이지 로드 시 /api/kpi-history에서 데이터를 가져와 차트와 테이블 업데이트
 */

(function() {
  'use strict';

  let trendsDataLoaded = false;
  let trendsCharts = {};

  // 포맷팅 헬퍼
  const formatNum = n => n?.toLocaleString('ko-KR') || '0';
  const formatMan = n => (n / 10000).toFixed(1) + '만';
  const formatEok = n => (n / 100000000).toFixed(2) + '억';
  const formatWon = n => formatNum(n) + '원';
  const formatPercent = n => (n || 0).toFixed(2) + '%';
  const formatX = n => (n || 0).toFixed(2) + 'x';

  // MoM 변화 표시 포맷
  function formatChange(value, inverse = false) {
    if (value === undefined || value === null) return '-';
    const isPositive = inverse ? value < 0 : value > 0;
    const arrow = value > 0 ? '▲' : value < 0 ? '▼' : '―';
    const colorClass = isPositive ? 'trend-up' : value < 0 ? (inverse ? 'trend-up' : 'trend-down') : 'trend-neutral';
    return `<span class="${colorClass}">${arrow} ${Math.abs(value).toFixed(1)}%</span>`;
  }

  // 히트맵 클래스 결정
  function getHeatmapClass(value, inverse = false) {
    if (value === undefined || value === null || value === 0) return '';
    const isPositive = inverse ? value < 0 : value > 0;
    const isStrong = Math.abs(value) > 10;
    if (isPositive) return isStrong ? 'heatmap-strong-positive' : 'heatmap-positive';
    return isStrong ? 'heatmap-strong-negative' : 'heatmap-negative';
  }

  // 차트 초기화
  function initCharts(data) {
    const labels = data.map(d => d.monthLabel);

    // MAU & MRR 추이 차트
    const mainCtx = document.getElementById('trendsMainChart')?.getContext('2d');
    if (mainCtx) {
      if (trendsCharts.main) trendsCharts.main.destroy();
      trendsCharts.main = new Chart(mainCtx, {
        type: 'line',
        data: {
          labels: labels,
          datasets: [{
            label: 'MAU (만명)',
            data: data.map(d => d.mau / 10000),
            borderColor: '#667eea',
            backgroundColor: 'rgba(102, 126, 234, 0.1)',
            fill: true,
            tension: 0.4,
            yAxisID: 'y'
          }, {
            label: 'MRR (억원)',
            data: data.map(d => d.revenue / 100000000),
            borderColor: '#10b981',
            backgroundColor: 'rgba(16, 185, 129, 0.1)',
            fill: true,
            tension: 0.4,
            yAxisID: 'y1'
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { position: 'bottom', labels: { color: '#888' } },
            tooltip: {
              callbacks: {
                label: function(ctx) {
                  const dataIndex = ctx.dataIndex;
                  const monthData = data[dataIndex];
                  if (ctx.datasetIndex === 0) {
                    const change = monthData.mauChange !== undefined ? ` (${monthData.mauChange > 0 ? '+' : ''}${monthData.mauChange}%)` : '';
                    return `MAU: ${formatMan(monthData.mau)}${change}`;
                  } else {
                    const change = monthData.revenueChange !== undefined ? ` (${monthData.revenueChange > 0 ? '+' : ''}${monthData.revenueChange}%)` : '';
                    return `MRR: ${formatEok(monthData.revenue)}원${change}`;
                  }
                }
              }
            }
          },
          scales: {
            y: {
              type: 'linear',
              position: 'left',
              title: { display: true, text: 'MAU (만명)', color: '#888' },
              grid: { color: 'rgba(255,255,255,0.05)' },
              beginAtZero: true
            },
            y1: {
              type: 'linear',
              position: 'right',
              title: { display: true, text: 'MRR (억원)', color: '#888' },
              grid: { drawOnChartArea: false },
              beginAtZero: true
            },
            x: { grid: { display: false }, ticks: { color: '#888' } }
          }
        }
      });
    }

    // CAC & LTV/CAC 차트
    const cacCtx = document.getElementById('trendsCacChart')?.getContext('2d');
    if (cacCtx) {
      if (trendsCharts.cac) trendsCharts.cac.destroy();
      trendsCharts.cac = new Chart(cacCtx, {
        type: 'line',
        data: {
          labels: labels,
          datasets: [{
            label: 'CAC (원)',
            data: data.map(d => d.cac),
            borderColor: '#ef4444',
            backgroundColor: 'rgba(239, 68, 68, 0.1)',
            fill: true,
            tension: 0.4,
            yAxisID: 'y'
          }, {
            label: 'LTV/CAC (x)',
            data: data.map(d => d.ltvCac),
            borderColor: '#f59e0b',
            backgroundColor: 'rgba(245, 158, 11, 0.1)',
            fill: false,
            tension: 0.4,
            yAxisID: 'y1'
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: { legend: { position: 'bottom', labels: { color: '#888' } } },
          scales: {
            y: {
              type: 'linear',
              position: 'left',
              title: { display: true, text: 'CAC (원)', color: '#888' },
              grid: { color: 'rgba(255,255,255,0.05)' }
            },
            y1: {
              type: 'linear',
              position: 'right',
              title: { display: true, text: 'LTV/CAC', color: '#888' },
              grid: { drawOnChartArea: false }
            },
            x: { grid: { display: false }, ticks: { color: '#888' } }
          }
        }
      });
    }

    // 전환율 & Stickiness 차트
    const convCtx = document.getElementById('trendsConversionChart')?.getContext('2d');
    if (convCtx) {
      if (trendsCharts.conversion) trendsCharts.conversion.destroy();
      trendsCharts.conversion = new Chart(convCtx, {
        type: 'line',
        data: {
          labels: labels,
          datasets: [{
            label: '전환율 (%)',
            data: data.map(d => d.conversionRate),
            borderColor: '#3b82f6',
            backgroundColor: 'rgba(59, 130, 246, 0.1)',
            fill: true,
            tension: 0.4,
            yAxisID: 'y'
          }, {
            label: 'Stickiness (%)',
            data: data.map(d => d.stickiness),
            borderColor: '#8b5cf6',
            backgroundColor: 'rgba(139, 92, 246, 0.1)',
            fill: true,
            tension: 0.4,
            yAxisID: 'y'
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: { legend: { position: 'bottom', labels: { color: '#888' } } },
          scales: {
            y: {
              type: 'linear',
              position: 'left',
              title: { display: true, text: '%', color: '#888' },
              grid: { color: 'rgba(255,255,255,0.05)' },
              beginAtZero: true
            },
            x: { grid: { display: false }, ticks: { color: '#888' } }
          }
        }
      });
    }
  }

  // 테이블 업데이트
  function updateTables(data) {
    // 상세 데이터 테이블
    const tbody = document.getElementById('trends-table-body');
    if (tbody) {
      tbody.innerHTML = data.slice().reverse().map(d => `
        <tr>
          <td><strong>${d.monthLabel}</strong></td>
          <td>${formatMan(d.mau)}</td>
          <td>${formatEok(d.revenue)}원</td>
          <td>${formatWon(d.arppu)}</td>
          <td>${formatNum(d.payingUsers)}명</td>
          <td>${formatPercent(d.conversionRate)}</td>
          <td>${formatWon(d.cac)}</td>
          <td>${formatX(d.ltvCac)}</td>
          <td>${formatX(d.roas)}</td>
          <td>${formatPercent(d.d1Retention)}</td>
          <td>${formatPercent(d.stickiness)}</td>
        </tr>
      `).join('');
    }

    // MoM 변화 히트맵 테이블
    const momBody = document.getElementById('trends-mom-body');
    if (momBody) {
      momBody.innerHTML = data.slice().reverse().map(d => `
        <tr>
          <td><strong>${d.monthLabel}</strong></td>
          <td class="${getHeatmapClass(d.mauChange)}">${formatChange(d.mauChange)}</td>
          <td class="${getHeatmapClass(d.revenueChange)}">${formatChange(d.revenueChange)}</td>
          <td class="${getHeatmapClass(d.arppuChange)}">${formatChange(d.arppuChange)}</td>
          <td class="${getHeatmapClass(d.conversionChange)}">${formatChange(d.conversionChange)}</td>
          <td class="${getHeatmapClass(d.cacChange, true)}">${formatChange(d.cacChange, true)}</td>
          <td class="${getHeatmapClass(d.ltvCacChange)}">${formatChange(d.ltvCacChange)}</td>
        </tr>
      `).join('');
    }
  }

  // 요약 카드 업데이트
  function updateSummaryCards(data) {
    const latest = data[data.length - 1];
    if (!latest) return;

    // MAU 성장
    const mauGrowth = document.getElementById('trends-mau-growth');
    const mauChange = document.getElementById('trends-mau-change');
    if (mauGrowth) {
      mauGrowth.textContent = formatMan(latest.mau);
      mauGrowth.className = 'value';
    }
    if (mauChange && latest.mauChange !== undefined) {
      const isPositive = latest.mauChange > 0;
      mauChange.innerHTML = `<span class="${isPositive ? 'trend-up' : 'trend-down'}">${isPositive ? '▲' : '▼'} ${Math.abs(latest.mauChange).toFixed(1)}% 전월 대비</span>`;
    }

    // MRR 성장
    const mrrGrowth = document.getElementById('trends-mrr-growth');
    const mrrChange = document.getElementById('trends-mrr-change');
    if (mrrGrowth) {
      mrrGrowth.textContent = formatEok(latest.revenue) + '원';
    }
    if (mrrChange && latest.revenueChange !== undefined) {
      const isPositive = latest.revenueChange > 0;
      mrrChange.innerHTML = `<span class="${isPositive ? 'trend-up' : 'trend-down'}">${isPositive ? '▲' : '▼'} ${Math.abs(latest.revenueChange).toFixed(1)}% 전월 대비</span>`;
    }

    // CAC 변화
    const cacGrowth = document.getElementById('trends-cac-growth');
    const cacChange = document.getElementById('trends-cac-change');
    if (cacGrowth) {
      cacGrowth.textContent = formatWon(latest.cac);
    }
    if (cacChange && latest.cacChange !== undefined) {
      const isPositive = latest.cacChange < 0; // CAC는 감소가 긍정적
      cacChange.innerHTML = `<span class="${isPositive ? 'trend-up' : 'trend-down'}">${latest.cacChange > 0 ? '▲' : '▼'} ${Math.abs(latest.cacChange).toFixed(1)}% 전월 대비</span>`;
    }

    // LTV/CAC 변화
    const ltvCacGrowth = document.getElementById('trends-ltvcac-growth');
    const ltvCacChange = document.getElementById('trends-ltvcac-change');
    if (ltvCacGrowth) {
      ltvCacGrowth.textContent = formatX(latest.ltvCac);
    }
    if (ltvCacChange && latest.ltvCacChange !== undefined) {
      const isPositive = latest.ltvCacChange > 0;
      ltvCacChange.innerHTML = `<span class="${isPositive ? 'trend-up' : 'trend-down'}">${isPositive ? '▲' : '▼'} ${Math.abs(latest.ltvCacChange).toFixed(1)}% 전월 대비</span>`;
    }
  }

  // 데이터 로드
  async function loadTrendsData() {
    if (trendsDataLoaded) return;

    try {
      console.log('[Trends] Fetching historical data...');
      const response = await fetch('/api/kpi-history?months=6');
      const result = await response.json();

      if (!result.success) {
        console.error('[Trends] API Error:', result.error);
        showError(result.error);
        return;
      }

      const data = result.data.filter(d => !d.error && d.mau > 0);
      console.log('[Trends] Data received:', data.length, 'months');

      if (data.length === 0) {
        showError('데이터가 없습니다');
        return;
      }

      // UI 업데이트
      initCharts(data);
      updateTables(data);
      updateSummaryCards(data);

      // 로딩 숨기고 콘텐츠 표시
      const loadingEl = document.getElementById('trends-loading');
      const contentEl = document.getElementById('trends-content');
      if (loadingEl) loadingEl.style.display = 'none';
      if (contentEl) contentEl.style.display = 'block';

      trendsDataLoaded = true;
      console.log('[Trends] Dashboard updated successfully');

    } catch (error) {
      console.error('[Trends] Failed to load data:', error);
      showError(error.message);
    }
  }

  function showError(message) {
    const loading = document.getElementById('trends-loading');
    if (loading) {
      loading.innerHTML = `
        <div style="font-size: 2rem; margin-bottom: 20px;">⚠️</div>
        <div style="color: #ef4444;">데이터 로드 실패</div>
        <div style="color: #888; margin-top: 10px; font-size: 0.85rem;">${message}</div>
        <button onclick="window.retryTrendsLoad()" style="margin-top: 20px; padding: 10px 20px; background: #667eea; color: white; border: none; border-radius: 8px; cursor: pointer;">다시 시도</button>
      `;
    }
  }

  // 재시도 함수
  window.retryTrendsLoad = function() {
    trendsDataLoaded = false;
    const loading = document.getElementById('trends-loading');
    if (loading) {
      loading.innerHTML = `
        <div style="font-size: 2rem; margin-bottom: 20px;">📊</div>
        <div style="color: #888;">월별 데이터를 불러오는 중...</div>
        <div style="margin-top: 20px; width: 200px; height: 4px; background: rgba(255,255,255,0.1); border-radius: 2px; margin: 20px auto;">
          <div style="width: 30%; height: 100%; background: linear-gradient(90deg, #667eea, #764ba2); border-radius: 2px; animation: loading 1.5s ease-in-out infinite;"></div>
        </div>
      `;
    }
    loadTrendsData();
  };

  // 페이지 로드 시 즉시 데이터 로드 (다른 탭 데이터처럼)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadTrendsData);
  } else {
    loadTrendsData();
  }

  // 외부 접근용
  window.loadTrendsData = loadTrendsData;

})();
