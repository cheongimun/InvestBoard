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

      // Calculate derived values
      const freeUsers = data.mau - data.payingUsers;
      const cacPayback = data.arppu > 0 ? data.cac / data.arppu : 0;

      // Calculate cost metrics (실시간 연동)
      const adSpend = data.adSpend || 0;
      const aiCost = data.aiCost || 0;
      const grossProfit = data.revenue - aiCost;

      // KPI value mappings for data-kpi attributes
      const kpiFormats = {
        mau: formatMan(data.mau),
        mrr: formatEok(data.revenue) + '원',
        mrrMan: formatManWon(data.revenue) + '원',
        arppu: formatWon(data.arppu),
        cac: formatWon(data.cac),
        ltv: formatWon(data.arppu) + '+',
        ltvCac: formatX(data.ltvCac),
        roas: formatX(data.roas),
        conversionRate: formatPercent(data.conversionRate),
        d1Retention: formatPercent(data.d1Retention),
        stickiness: formatPercent(data.stickiness),
        grossMargin: formatPercentShort(data.grossMargin) + '%',
        repurchaseRate: formatPercent(data.repurchaseRate),
        payingUsers: formatNum(data.payingUsers) + '명',
        arr: formatEokShort(data.arr) + '원',
        revenue: formatEok(data.revenue) + '원',
        // New freemium metrics
        freeUsers: formatNum(freeUsers) + '명',
        paidUsers: formatNum(data.payingUsers) + '명',
        cacPayback: cacPayback < 2 ? '~' + Math.ceil(cacPayback) + '개월' : Math.round(cacPayback) + '개월',
        churnRate: '측정중',
        d7Retention: '측정필요',
        d30Retention: '측정필요',
        nrr: '측정필요',
        activationRate: '측정필요',
        // Cost metrics (실시간 연동)
        adSpendWon: formatWon(adSpend),
        adSpendMan: formatManWonUnit(adSpend),
        aiCostWon: formatWon(aiCost),
        aiCostMan: formatManWonUnit(aiCost),
        aiCostRatio: data.revenue > 0 ? (aiCost / data.revenue * 100).toFixed(1) + '%' : '0%',
        revenueWon: formatWon(data.revenue),
        grossProfitWon: formatWon(grossProfit),
        costPerQuery: data.payingUsers > 0 ? Math.round(aiCost / data.payingUsers) + '원' : '-'
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
        // MAU patterns (all historical values)
        ['70,023명', formatNum(data.mau) + '명'],
        ['70,023', formatNum(data.mau)],
        ['66,099명', formatNum(data.mau) + '명'],
        ['66,099', formatNum(data.mau)],
        ['57,786명', formatNum(data.mau) + '명'],
        ['57,786', formatNum(data.mau)],
        ['7.0만명', formatMan(data.mau) + '명'],
        ['7.0만', formatMan(data.mau)],
        ['6.6만명', formatMan(data.mau) + '명'],
        ['6.6만', formatMan(data.mau)],
        ['6.0만', formatMan(data.mau)],
        ['60,000', formatNum(data.mau)],

        // MRR/Revenue patterns (all historical values)
        ['106,489,300원', formatNum(data.revenue) + '원'],
        ['106,489,300', formatNum(data.revenue)],
        ['108,094,700원', formatNum(data.revenue) + '원'],
        ['108,094,700', formatNum(data.revenue)],
        ['87,922,500원', formatNum(data.revenue) + '원'],
        ['87,922,500', formatNum(data.revenue)],
        ['86,631,200원', formatNum(data.revenue) + '원'],
        ['86,631,200', formatNum(data.revenue)],
        ['10,649만원', formatManWonUnit(data.revenue)],
        ['10,649만', formatManWon(data.revenue)],
        ['10,809만원', formatManWonUnit(data.revenue)],
        ['10,809만', formatManWon(data.revenue)],
        ['8,792만원', formatManWonUnit(data.revenue)],
        ['8,792만', formatManWon(data.revenue)],
        ['8,663만원', formatManWonUnit(data.revenue)],
        ['8,663만', formatManWon(data.revenue)],
        ['1.08억원', formatEok(data.revenue) + '원'],
        ['1.08억', formatEok(data.revenue)],
        ['1.06억', formatEok(data.revenue)],
        ['0.88억', formatEok(data.revenue)],
        ['0.87억', formatEok(data.revenue)],
        ['MRR 1.08억', 'MRR ' + formatEok(data.revenue)],
        ['MRR 0.88억', 'MRR ' + formatEok(data.revenue)],

        // ARR patterns
        ['12.8억원', formatEokShort(data.arr) + '원'],
        ['12.8억', formatEokShort(data.arr)],
        ['13.0억원', formatEokShort(data.arr) + '원'],
        ['13.0억', formatEokShort(data.arr)],
        ['10.6억원', formatEokShort(data.arr) + '원'],
        ['10.6억', formatEokShort(data.arr)],
        ['10.5억', formatEokShort(data.arr)],
        ['10.4억원', formatEokShort(data.arr) + '원'],
        ['10.4억', formatEokShort(data.arr)],

        // ARPPU patterns
        ['35,928원', formatWon(data.arppu)],
        ['35,928', formatNum(data.arppu)],
        ['35,924원', formatWon(data.arppu)],
        ['35,924', formatNum(data.arppu)],
        ['35,843원', formatWon(data.arppu)],
        ['35,843', formatNum(data.arppu)],
        ['34,820원+', formatWon(data.arppu) + '+'],
        ['34,820원', formatWon(data.arppu)],
        ['34,820', formatNum(data.arppu)],

        // Paying users
        ['2,964명', formatNum(data.payingUsers) + '명'],
        ['2,964', formatNum(data.payingUsers)],
        ['3,009명', formatNum(data.payingUsers) + '명'],
        ['3,009', formatNum(data.payingUsers)],
        ['2,453명', formatNum(data.payingUsers) + '명'],
        ['2,453', formatNum(data.payingUsers)],

        // CAC patterns
        ['22,967원', formatWon(data.cac)],
        ['22,967', formatNum(data.cac)],
        ['21,590원', formatWon(data.cac)],
        ['21,590', formatNum(data.cac)],
        ['20,903원', formatWon(data.cac)],
        ['20,903', formatNum(data.cac)],
        ['20,580원', formatWon(data.cac)],
        ['923원', formatWon(data.cac)],
        ['923', formatNum(data.cac)],

        // LTV/CAC patterns
        ['37.7x', formatX(data.ltvCac)],
        ['1.74x', formatX(data.ltvCac)],
        ['1.72x', formatX(data.ltvCac)],
        ['1.66x', formatX(data.ltvCac)],
        ['1.56x', formatX(data.ltvCac)],

        // ROAS patterns
        ['1.56x', formatX(data.roas)],
        ['1.42x', formatX(data.roas)],
        ['ROAS 1.56x', 'ROAS ' + formatX(data.roas)],
        ['ROAS 1.42x', 'ROAS ' + formatX(data.roas)],

        // Conversion rate patterns
        ['4.55%', formatPercent(data.conversionRate)],
        ['4.24%', formatPercent(data.conversionRate)],
        ['4.23%', formatPercent(data.conversionRate)],
        ['4.11%', formatPercent(data.conversionRate)],
        ['3.76%', formatPercent(data.conversionRate)],

        // D1 Retention patterns
        ['4.68%', formatPercent(data.d1Retention)],
        ['4.45%', formatPercent(data.d1Retention)],
        ['4.4%', formatPercent(data.d1Retention)],
        ['4.39%', formatPercent(data.d1Retention)],

        // Stickiness patterns
        ['4.1%', formatPercent(data.stickiness)],
        ['3.85%', formatPercent(data.stickiness)],
        ['3.83%', formatPercent(data.stickiness)],
        ['3.79%', formatPercent(data.stickiness)],
        ['3.66%', formatPercent(data.stickiness)],

        // Gross Margin patterns
        ['84.9%', formatPercentShort(data.grossMargin) + '%'],
        ['85.7%', formatPercentShort(data.grossMargin) + '%'],
        ['75.7%', formatPercentShort(data.grossMargin) + '%'],
        ['75.3%', formatPercentShort(data.grossMargin) + '%'],

        // Repurchase rate patterns
        ['2.94%', formatPercent(data.repurchaseRate)],
        ['2.92%', formatPercent(data.repurchaseRate)],
        ['2.8%', formatPercent(data.repurchaseRate)],
        ['2.73%', formatPercent(data.repurchaseRate)],

        // Net margin (순마진) patterns - calculated from revenue
        ['65,631,200원', formatNum(Math.round(data.revenue * data.grossMargin / 100)) + '원'],
        ['65,631,200', formatNum(Math.round(data.revenue * data.grossMargin / 100))]
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
        let status, badgeClass;
        if (data.ltvCac >= 3) {
          status = '달성';
          badgeClass = 'badge-green';
        } else if (data.ltvCac >= 2) {
          status = '목표: 3x 이상';
          badgeClass = 'badge-yellow';
        } else {
          status = 'Unit Economics 위험';
          badgeClass = 'badge-red';
        }
        ltvBadge.textContent = `LTV/CAC ${formatX(data.ltvCac)} (${status})`;
        // Update badge class
        ltvBadge.className = ltvBadge.className.replace(/badge-(green|yellow|red)/g, '').trim() + ' ' + badgeClass;
      }

      // Update status indicators based on thresholds
      updateStatusIndicators(data);

      // Update benchmark achievement table (달성률 요약)
      updateBenchmarkTable(data, formatNum, formatWon, formatPercent, formatX);

      // 데이터 출처 및 갱신 정보 업데이트
      const dataPeriodEl = document.getElementById('data-period');
      const dataUpdatedEl = document.getElementById('data-updated');
      const dataRealtimeEl = document.getElementById('data-realtime-status');

      if (dataPeriodEl && data.dataStart && data.dataEnd) {
        const startDate = data.dataStart.replace(/-/g, '.');
        const endDate = data.dataEnd.replace(/-/g, '.');
        const days = Math.round((new Date(data.dataEnd) - new Date(data.dataStart)) / (1000 * 60 * 60 * 24));
        dataPeriodEl.textContent = `${startDate} ~ ${endDate} (${days}일)`;
      }

      if (dataUpdatedEl) {
        const now = new Date();
        const updateTime = now.toLocaleString('ko-KR', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        });
        dataUpdatedEl.innerHTML = `${updateTime} <span style="color: #10b981;">(실시간)</span>`;
      }

      if (dataRealtimeEl) {
        dataRealtimeEl.textContent = '✓ API 연동 성공';
        dataRealtimeEl.style.color = '#10b981';
      }

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

  function updateBenchmarkTable(data, formatNum, formatWon, formatPercent, formatX) {
    // Pre-seed 벤치마크 기준값
    const benchmarks = {
      mau: { target: 50000, type: 'min' },           // 10,000 ~ 50,000 -> 50,000 상한 기준
      revenue: { target: 10000000, type: 'min' },   // 0 ~ 10,000,000 -> 1천만 상한 기준
      arppu: { target: 20000, type: 'min' },        // 20,000원+
      ltvCac: { target: 3.0, type: 'min' },         // 3.0x+
      cac: { target: 10000, type: 'max' },          // < 10,000원 (낮을수록 좋음)
      conversionRate: { target: 1.0, type: 'min' }, // 1%+
      stickiness: { target: 5.0, type: 'min' },     // 5%+
      d1Retention: { target: null, type: 'measure' }, // 측정 시작
      paidD1: { target: null, type: 'measure' }     // 측정중
    };

    // 달성률 계산 함수
    function calculateAchievement(value, benchmark) {
      if (benchmark.type === 'measure' || benchmark.target === null) {
        return { percent: null, status: 'measure' };
      }

      let percent;
      if (benchmark.type === 'max') {
        // 낮을수록 좋은 지표 (CAC)
        percent = (benchmark.target / value) * 100;
      } else {
        // 높을수록 좋은 지표
        percent = (value / benchmark.target) * 100;
      }

      let status;
      if (percent >= 150) {
        status = 'excellent'; // 초과달성
      } else if (percent >= 100) {
        status = 'achieved';  // 달성
      } else if (percent >= 70) {
        status = 'warning';   // 진행중/미달
      } else {
        status = 'danger';    // 개선필요
      }

      return { percent: Math.round(percent), status };
    }

    // 각 지표별 달성률 계산
    const achievements = {
      mau: calculateAchievement(data.mau, benchmarks.mau),
      revenue: calculateAchievement(data.revenue, benchmarks.revenue),
      arppu: calculateAchievement(data.arppu, benchmarks.arppu),
      ltvCac: calculateAchievement(data.ltvCac, benchmarks.ltvCac),
      cac: calculateAchievement(data.cac, benchmarks.cac),
      conversionRate: calculateAchievement(data.conversionRate, benchmarks.conversionRate),
      stickiness: calculateAchievement(data.stickiness, benchmarks.stickiness),
      d1Retention: calculateAchievement(data.d1Retention, benchmarks.d1Retention),
      paidD1: { percent: null, status: 'measure' }
    };

    // 상태별 텍스트 및 클래스 매핑
    const statusLabels = {
      excellent: '초과달성',
      achieved: '달성',
      warning: '미달',
      danger: '미달',
      measure: '측정중'
    };

    const statusMeanings = {
      excellent: 'Seed 수준',
      achieved: 'Pre-seed 달성',
      warning: '개선 필요',
      danger: '비용 절감 필요',
      measure: '웹 한계'
    };

    // DOM 업데이트
    const updates = {
      // MAU
      benchmarkMauValue: formatNum(data.mau) + '명',
      benchmarkMauPercent: achievements.mau.percent + '%',
      benchmarkMauStatus: statusLabels[achievements.mau.status],
      benchmarkMauMeaning: achievements.mau.percent >= 100 ? 'Seed 수준' : '개선 필요',

      // Revenue
      benchmarkRevenueValue: formatNum(data.revenue) + '원',
      benchmarkRevenuePercent: achievements.revenue.percent + '%',
      benchmarkRevenueStatus: statusLabels[achievements.revenue.status],
      benchmarkRevenueMeaning: achievements.revenue.percent >= 100 ? 'Seed 수준' : '개선 필요',

      // ARPPU
      benchmarkArppuValue: formatWon(data.arppu),
      benchmarkArppuPercent: achievements.arppu.percent + '%',
      benchmarkArppuStatus: statusLabels[achievements.arppu.status],
      benchmarkArppuMeaning: achievements.arppu.percent >= 100 ? 'Seed 수준' : '개선 필요',

      // LTV/CAC
      benchmarkLtvCacValue: formatX(data.ltvCac),
      benchmarkLtvCacPercent: achievements.ltvCac.percent + '%',
      benchmarkLtvCacStatus: statusLabels[achievements.ltvCac.status],
      benchmarkLtvCacMeaning: achievements.ltvCac.percent >= 100 ? '달성' : `3x 목표 대비 ${achievements.ltvCac.percent}%`,

      // CAC
      benchmarkCacValue: formatWon(data.cac),
      benchmarkCacPercent: achievements.cac.percent + '%',
      benchmarkCacStatus: statusLabels[achievements.cac.status],
      benchmarkCacMeaning: achievements.cac.percent >= 100 ? '달성' : '비용 절감 필요',

      // Conversion Rate
      benchmarkConversionValue: formatPercent(data.conversionRate),
      benchmarkConversionPercent: achievements.conversionRate.percent + '%',
      benchmarkConversionStatus: statusLabels[achievements.conversionRate.status],
      benchmarkConversionMeaning: achievements.conversionRate.percent >= 100 ? 'Seed 수준' : '개선 필요',

      // Stickiness
      benchmarkStickinessValue: formatPercent(data.stickiness),
      benchmarkStickinessPercent: achievements.stickiness.percent + '%',
      benchmarkStickinessStatus: statusLabels[achievements.stickiness.status],
      benchmarkStickinessMeaning: achievements.stickiness.percent >= 100 ? '달성' : '개선 필요',

      // D1 Retention
      benchmarkD1Value: formatPercent(data.d1Retention),
      benchmarkD1Percent: '-',
      benchmarkD1Status: '측정중',
      benchmarkD1Meaning: '웹 한계',

      // Paid D1
      benchmarkPaidD1Value: '11.6%',
      benchmarkPaidD1Percent: '-',
      benchmarkPaidD1Status: '결제자 참여도 2.8배',
      benchmarkPaidD1Meaning: '가치 검증'
    };

    // 텍스트 업데이트
    Object.keys(updates).forEach(key => {
      document.querySelectorAll(`[data-kpi="${key}"]`).forEach(el => {
        el.textContent = updates[key];
      });
    });

    // Progress bar 업데이트
    const barUpdates = {
      benchmarkMauBar: { percent: Math.min(achievements.mau.percent, 100), status: achievements.mau.status },
      benchmarkRevenueBar: { percent: Math.min(achievements.revenue.percent, 100), status: achievements.revenue.status },
      benchmarkArppuBar: { percent: Math.min(achievements.arppu.percent, 100), status: achievements.arppu.status },
      benchmarkLtvCacBar: { percent: Math.min(achievements.ltvCac.percent, 100), status: achievements.ltvCac.status },
      benchmarkCacBar: { percent: Math.min(achievements.cac.percent, 100), status: achievements.cac.status },
      benchmarkConversionBar: { percent: Math.min(achievements.conversionRate.percent, 100), status: achievements.conversionRate.status },
      benchmarkStickinessBar: { percent: Math.min(achievements.stickiness.percent, 100), status: achievements.stickiness.status },
      benchmarkD1Bar: { percent: 100, status: 'achieved' },
      benchmarkPaidD1Bar: { percent: 100, status: 'achieved' }
    };

    Object.keys(barUpdates).forEach(key => {
      document.querySelectorAll(`[data-kpi="${key}"]`).forEach(el => {
        el.style.width = barUpdates[key].percent + '%';
        // 상태에 따른 클래스 업데이트
        el.className = el.className.replace(/excellent|achieved|warning|danger/g, '').trim();
        el.classList.add(barUpdates[key].status);
      });
    });

    // Status badge 클래스 업데이트
    const statusBadges = {
      benchmarkMauStatus: achievements.mau.status,
      benchmarkRevenueStatus: achievements.revenue.status,
      benchmarkArppuStatus: achievements.arppu.status,
      benchmarkLtvCacStatus: achievements.ltvCac.status,
      benchmarkCacStatus: achievements.cac.status,
      benchmarkConversionStatus: achievements.conversionRate.status,
      benchmarkStickinessStatus: achievements.stickiness.status,
      benchmarkD1Status: 'achieved',
      benchmarkPaidD1Status: 'achieved'
    };

    Object.keys(statusBadges).forEach(key => {
      document.querySelectorAll(`[data-kpi="${key}"]`).forEach(el => {
        el.className = 'status-badge ' + statusBadges[key];
      });
    });

    // 달성률 요약 업데이트
    const achievedMetrics = [];
    const progressMetrics = [];
    const needsImprovementMetrics = [];

    const metricNames = {
      mau: 'MAU',
      revenue: 'MRR',
      arppu: 'ARPPU',
      ltvCac: 'LTV/CAC',
      cac: 'CAC',
      conversionRate: '전환율',
      stickiness: 'Stickiness',
      d1Retention: 'D1 리텐션',
      paidD1: '결제자 D1'
    };

    Object.keys(achievements).forEach(key => {
      const achievement = achievements[key];
      const name = metricNames[key];

      if (achievement.status === 'measure') {
        progressMetrics.push(name);
      } else if (achievement.percent >= 100) {
        achievedMetrics.push(name);
      } else if (achievement.percent >= 70) {
        progressMetrics.push(name);
      } else {
        needsImprovementMetrics.push(name);
      }
    });

    // 요약 카드 업데이트
    const summaryUpdates = {
      achievedCount: achievedMetrics.length.toString(),
      achievedList: achievedMetrics.join(', ') || '-',
      progressCount: progressMetrics.length.toString(),
      progressList: progressMetrics.join(', ') || '-',
      needsImprovementCount: needsImprovementMetrics.length.toString(),
      needsImprovementList: needsImprovementMetrics.join(', ') || '-',
      achievementSummary: `${achievedMetrics.length}/9 지표 달성`
    };

    Object.keys(summaryUpdates).forEach(key => {
      document.querySelectorAll(`[data-kpi="${key}"]`).forEach(el => {
        el.textContent = summaryUpdates[key];
      });
    });

    console.log('[Realtime] Benchmark table updated:', {
      achieved: achievedMetrics,
      progress: progressMetrics,
      needsImprovement: needsImprovementMetrics
    });
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
