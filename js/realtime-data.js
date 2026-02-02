(function() {
  'use strict';

  // Format helpers - shared across all update functions
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

  /**
   * Update dashboard with KPI data
   * This function can be called externally via window.updateDashboardWithData(data)
   * @param {Object} data - KPI data from /api/kpi endpoint
   */
  function updateDashboardWithData(data) {
    console.log('[Realtime] Updating dashboard with data:', data);

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
    // Use API-calculated CAC Payback or calculate locally
    const cacPayback = data.cacPaybackMonths || (data.arppu > 0 ? data.cac / data.arppu : 0);

    // Calculate cost metrics (실시간 연동)
    const adSpend = data.adSpend || 0;
    const aiCost = data.aiCost || 0;
    const grossProfit = data.revenue - aiCost;

    // 재구매율 및 결제자 참여도 계산 (API에서 실시간 데이터 사용)
    const repurchaseCustomers = data.repurchaseCustomers || 0;
    const totalPayers = data.payingUsers || 0;
    const repurchaseRate = totalPayers > 0 ? (repurchaseCustomers / totalPayers * 100) : 0;
    const avgPurchaseCount = data.avgPurchaseCount || 0;
    const paidD1Retention = data.paidD1Retention || 0;
    const paidUserEngagement = data.d1Retention > 0 && paidD1Retention > 0 ? (paidD1Retention / data.d1Retention) : 0;

    // 결제 퍼널 데이터 계산 (API에서 실시간 데이터 사용)
    const funnelAdClicks = data.funnelAdClicks || data.mau || 0;
    const funnelLanding = data.funnelLanding || funnelAdClicks;
    const funnelFreeComplete = data.funnelFreeComplete || data.engagedUsers || 0;
    const funnelPaidComplete = data.payingUsers || 0;

    // 퍼널 전환율 계산
    const funnelLandingRate = funnelAdClicks > 0 ? (funnelLanding / funnelAdClicks * 100) : 100;
    const funnelFreeRate = funnelAdClicks > 0 ? (funnelFreeComplete / funnelAdClicks * 100) : 0;
    const funnelPaidRate = funnelAdClicks > 0 ? (funnelPaidComplete / funnelAdClicks * 100) : 0;

    // 퍼널 드롭오프 계산
    const funnelLandingDrop = -(100 - funnelLandingRate);
    const funnelFreeDrop = funnelLanding > 0 ? -((funnelLanding - funnelFreeComplete) / funnelLanding * 100) : 0;
    const funnelPaidDrop = funnelFreeComplete > 0 ? -((funnelFreeComplete - funnelPaidComplete) / funnelFreeComplete * 100) : 0;

    // KPI value mappings for data-kpi attributes
    // KPI 정의서 v3.0 기준으로 업데이트
    const kpiFormats = {
      // === MAU 계층 구조 (GA4 하이브리드) ===
      mau: formatMan(data.mau),
      totalMau: formatNum(data.mau) + '명',
      ga4Mau: formatNum(data.ga4Mau || 0) + '명',
      estimatedMau: formatNum(data.estimatedMau || 0) + '명',
      engagedUsers: formatNum(data.engagedUsers || 0) + '명',
      mauSource: data.mauSource || 'unknown',
      visitorRatio: (data.visitorRatio || 2.20).toFixed(2) + 'x',
      payingMau: formatNum(data.payingMau || 0) + '명',
      freeOnlyMau: formatNum(data.freeOnlyMau || 0) + '명',
      payingRatio: formatPercent(data.payingRatio || 0),
      payingRatioShort: (data.payingRatio || 0).toFixed(1) + '%',

      // === 매출 지표 ===
      mrr: formatEok(data.revenue) + '원',
      mrrMan: formatManWon(data.revenue) + '원',
      arppu: formatWon(data.arppu),
      revenue: formatEok(data.revenue) + '원',
      arr: formatEokShort(data.arr) + '원',
      payingUsers: formatNum(data.payingUsers) + '명',
      newPayingUsers: formatNum(data.newPayingUsers || 0) + '명',

      // === CAC (KPI 정의서 섹션 7) ===
      cac: formatWon(data.cac),
      fullyLoadedCac: formatWon(data.fullyLoadedCac || data.cac),
      workingCac: formatWon(data.cac),  // 광고비 기준 CAC

      // === LTV (KPI 정의서 섹션 6) ===
      // LTV = ARPPU × Customer Lifespan × Gross Margin
      ltv: data.ltv ? formatWon(data.ltv) : formatWon(data.arppu) + '+',
      ltvCac: formatX(data.ltvCac),
      ltvCacFullyLoaded: data.fullyLoadedCac > 0 ? formatX(data.ltv / data.fullyLoadedCac) : formatX(data.ltvCac),

      // === Churn & Customer Lifespan (KPI 정의서 섹션 6.3) ===
      customerLifespan: (data.customerLifespan || 3).toFixed(1) + '개월',
      monthlyChurnRate: (data.monthlyChurnRate || 0).toFixed(1) + '%',
      churnRate90d: (data.churnRate90d || 0).toFixed(1) + '%',
      cacPaybackMonths: (data.cacPaybackMonths || 0).toFixed(1) + '개월',

      // === 전환율 & ROAS ===
      roas: formatX(data.roas),
      conversionRate: formatPercent(data.conversionRate),
      grossMargin: formatPercentShort(data.grossMargin),
      grossMarginWon: Math.round(data.grossMargin) + '원',

      // === 방문 리텐션 (Visit Retention - KPI 정의서 섹션 3.3.1) ===
      // 전체 사용자 대상, PMF 검증용
      d1Retention: formatPercent(data.d1Retention),
      d7Retention: formatPercent(data.d7Retention || 0),
      d30Retention: formatPercent(data.d30Retention || 0),

      // === 거래 리텐션 (Transaction Retention - KPI 정의서 섹션 3.3.2) ===
      // 유료 사용자만 대상, 투자자 Primary 보고 지표
      m1Retention: (data.m1Retention || 0).toFixed(1) + '%',
      m3Retention: (data.m3Retention || 0).toFixed(1) + '%',
      m6Retention: (data.m6Retention || 0).toFixed(1) + '%',

      // === Stickiness & 재구매율 ===
      stickiness: formatPercent(data.stickiness),
      repurchaseRate: formatPercent(data.repurchaseRate),

      // === Growth Projection Section ===
      mrrDesc: formatManWonUnit(data.revenue),
      roasDesc: 'ROAS ' + formatX(data.roas),
      mauShort: 'MAU ' + formatMan(data.mau),
      mrrShort: 'MRR ' + formatManWonUnit(data.revenue),
      roasShort: 'ROAS ' + formatX(data.roas),
      mauCurrent: formatMan(data.mau),
      mrrCurrent: formatEok(data.revenue),
      preseedStatus: ' 현재 | MAU ' + formatMan(data.mau) + ' | MRR ' + formatEok(data.revenue),

      // === Investor Tab Section (Pre-A 투자 기준) ===
      mrrAchieved: 'MRR ' + formatEok(data.revenue),
      mauStatus: formatMan(data.mau) + (data.mau >= 100000 ? ' ✓' : ' ✗'),
      conversionStatus: formatPercent(data.conversionRate) + (data.conversionRate >= 5 ? ' ✓' : ' ✗'),
      // D1 기준: Pre-A 30%
      d1Status: 'D1 ' + formatPercent(data.d1Retention) + (data.d1Retention >= 30 ? ' ✓' : data.d1Retention >= 20 ? ' △' : ' ✗'),
      // LTV:CAC 기준: Pre-A 3:1
      ltvCacStatus: formatX(data.ltvCac) + (data.ltvCac >= 3 ? ' ✓' : data.ltvCac >= 2 ? ' △' : ' ✗'),
      mrrPmfStatus: 'MRR ' + (data.revenue >= 300000000 ? '3억+ ✓' : formatManWonUnit(data.revenue)),
      // 거래 리텐션 상태 (투자자 Primary 지표)
      m1Status: 'M1 ' + (data.m1Retention || 0).toFixed(1) + '%' + ((data.m1Retention || 0) >= 20 ? ' ✓' : (data.m1Retention || 0) >= 10 ? ' △' : ' ✗'),
      m6Status: 'M6 ' + (data.m6Retention || 0).toFixed(1) + '%' + ((data.m6Retention || 0) >= 10 ? ' ✓' : (data.m6Retention || 0) >= 5 ? ' △' : ' ✗'),

      // === Valuation Table Section ===
      mauValuation: formatNum(data.mau) + '명',
      mrrValuation: formatManWonUnit(data.revenue),
      arrValuation: formatEokShort(data.arr) + '원',
      ltvValuation: formatWon(data.arppu),
      payingUsersValuation: formatNum(data.payingUsers) + '명',
      roasValuation: 'ROAS ' + formatX(data.roas),

      // === Gap Analysis Section (Pre-A 투자 기준) ===
      // D7 방문 리텐션: Good 10-15%
      d7GapStatus: (data.d7Retention || 0).toFixed(1) + '% → 10%+ 필요',
      d7Percent: Math.round((data.d7Retention || 0) / 10 * 100) + '%',
      // D30 방문 리텐션: Good 6-10%
      d30GapStatus: (data.d30Retention || 0).toFixed(1) + '% → 6%+ 필요',
      d30Percent: Math.round((data.d30Retention || 0) / 6 * 100) + '%',
      // 재구매율: Good 20-40%
      repurchaseGapStatus: formatPercent(data.repurchaseRate) + ' → 20%+ 필요',
      repurchasePercent: Math.round(data.repurchaseRate / 20 * 100) + '%',
      // LTV:CAC: Pre-A 목표 3:1
      ltvCacGapStatus: formatX(data.ltvCac) + ' → 3x+ 필요 (Pre-A)',
      ltvCacPercent: Math.round(data.ltvCac / 3 * 100) + '%',
      // D1 방문 리텐션: Pre-A 30%
      d1GapStatus: formatPercent(data.d1Retention) + ' → 30%+ 필요',
      d1Percent: Math.round(data.d1Retention / 30 * 100) + '%',
      mauGapStatus: formatMan(data.mau) + (data.mau >= 100000 ? ' (Pre-A 기준 충족)' : ' (Pre-A 기준 미달)'),
      mauPercent: Math.round(data.mau / 100000 * 100) + '%',
      // 전환율: Pre-A 목표 5%
      conversionGapStatus: formatPercent(data.conversionRate) + (data.conversionRate >= 5 ? ' (Pre-A 달성)' : ' → 5%+ 필요'),
      conversionPercent: Math.round(data.conversionRate / 5 * 100) + '%',
      // 거래 리텐션 M1: Good 20-30% (KPI 정의서 섹션 3.4)
      m1GapStatus: (data.m1Retention || 0).toFixed(1) + '% → 20%+ 필요',
      m1Percent: Math.round((data.m1Retention || 0) / 20 * 100) + '%',
      // 거래 리텐션 M6: Good 10-20% (KPI 정의서 섹션 3.4)
      m6GapStatus: (data.m6Retention || 0).toFixed(1) + '% → 10%+ 필요',
      m6Percent: Math.round((data.m6Retention || 0) / 10 * 100) + '%',

      // === Investor Criteria Cards (Pre-A 투자 기준) ===
      mauCriteria: formatMan(data.mau) + (data.mau >= 100000 ? ' ✓' : ' ✗'),
      // 전환율: Pre-A 목표 5%
      conversionCriteria: formatPercent(data.conversionRate) + (data.conversionRate >= 5 ? ' ✓' : ' ✗'),
      // D1 방문 리텐션: Pre-A 30%
      d1Criteria: formatPercent(data.d1Retention) + (data.d1Retention >= 30 ? ' ✓' : data.d1Retention >= 20 ? ' △' : ' ✗'),
      // LTV:CAC: Pre-A 목표 3:1
      ltvCacCriteria: formatX(data.ltvCac) + (data.ltvCac >= 3 ? ' ✓' : data.ltvCac >= 2 ? ' △' : ' ✗'),
      // 거래 리텐션 M1 (투자자 Primary 지표)
      m1Criteria: (data.m1Retention || 0).toFixed(1) + '%' + ((data.m1Retention || 0) >= 20 ? ' ✓' : (data.m1Retention || 0) >= 10 ? ' △' : ' ✗'),
      // Paying Ratio
      payingRatioCriteria: (data.payingRatio || 0).toFixed(1) + '%' + ((data.payingRatio || 0) >= 5 ? ' ✓' : (data.payingRatio || 0) >= 3 ? ' △' : ' ✗'),

      // Freemium metrics
      freeUsers: formatNum(freeUsers) + '명',
      paidUsers: formatNum(data.payingUsers) + '명',
      cacPayback: cacPayback < 2 ? '~' + Math.ceil(cacPayback) + '개월' : Math.round(cacPayback) + '개월',
      churnRate: '측정중',
      d7RetentionValue: data.d7Retention ? formatPercent(data.d7Retention) : '측정중',
      nrr: '측정필요',
      activationRate: '측정필요',

      // Cost metrics
      adSpendWon: formatWon(adSpend),
      adSpendMan: formatManWonUnit(adSpend),
      aiCostWon: formatWon(aiCost),
      aiCostMan: formatManWonUnit(aiCost),
      aiCostRatio: data.revenue > 0 ? (aiCost / data.revenue * 100).toFixed(1) + '%' : '0%',
      revenueWon: formatWon(data.revenue),
      grossProfitWon: formatWon(grossProfit),
      costPerQuery: data.payingUsers > 0 ? Math.round(aiCost / data.payingUsers) + '원' : '-',

      // 재구매율 및 결제자 참여도
      repurchaseRateValue: repurchaseRate.toFixed(2) + '%',
      avgPurchaseCount: avgPurchaseCount.toFixed(2) + '회',
      repurchaseCustomers: formatNum(repurchaseCustomers) + '명',
      totalPayersRef: formatNum(totalPayers),
      paidD1Retention: paidD1Retention.toFixed(1) + '%',
      d1RetentionRef: formatPercent(data.d1Retention),
      paidUserEngagement: paidUserEngagement.toFixed(1) + '배',
      paidUserEngagementRef: paidUserEngagement.toFixed(1) + '배',
      paidUserEngagementRef2: paidUserEngagement.toFixed(1) + '배',
      paidUserEngagementRef3: paidUserEngagement.toFixed(1) + '배',
      paidD1RetentionRef2: paidD1Retention.toFixed(1) + '%',
      conversionRateRef2: formatPercent(data.conversionRate),
      conversionRatePct: formatPercent(data.conversionRate),
      d1RetentionPct: formatPercent(data.d1Retention),
      stickinessRef: formatPercent(data.stickiness),
      stickinessPct: formatPercent(data.stickiness),
      grossMarginPct: formatPercentShort(data.grossMargin),

      // 결제 퍼널 데이터
      funnelAdClicks: formatNum(funnelAdClicks),
      funnelLanding: formatNum(funnelLanding),
      funnelLandingRate: funnelLandingRate.toFixed(1) + '%',
      funnelLandingDrop: funnelLandingDrop.toFixed(1) + '%',
      funnelFreeComplete: formatNum(funnelFreeComplete),
      funnelFreeRate: funnelFreeRate.toFixed(1) + '%',
      funnelFreeDrop: funnelFreeDrop.toFixed(1) + '%',
      funnelPaidComplete: formatNum(funnelPaidComplete),
      funnelPaidRate: funnelPaidRate.toFixed(2) + '%',
      funnelPaidDrop: funnelPaidDrop.toFixed(1) + '%',
      funnelMaxDrop: funnelFreeDrop.toFixed(1) + '%',

      // 코호트 리텐션 테이블 (API에서 실시간 데이터 사용)
      cohort1Month: data.cohort1Month || '-',
      cohort1Users: data.cohort1Users ? formatNum(data.cohort1Users) + '명' : '-',
      cohort1M0: '100%',
      cohort1M1: data.cohort1M1 ? data.cohort1M1.toFixed(1) + '%' : '-',
      cohort1M2: data.cohort1M2 ? data.cohort1M2.toFixed(1) + '%' : '-',
      cohort1M3: data.cohort1M3 ? data.cohort1M3.toFixed(1) + '%' : '-',
      cohort1M4: data.cohort1M4 ? data.cohort1M4.toFixed(1) + '%' : '-',
      cohort1M5: data.cohort1M5 ? data.cohort1M5.toFixed(1) + '%' : '-',
      cohort1M6: data.cohort1M6 ? data.cohort1M6.toFixed(1) + '%' : '-',
      cohort2Month: data.cohort2Month || '-',
      cohort2Users: data.cohort2Users ? formatNum(data.cohort2Users) + '명' : '-',
      cohort2M0: '100%',
      cohort2M1: data.cohort2M1 ? data.cohort2M1.toFixed(1) + '%' : '진행중',
      cohort2M2: data.cohort2M2 ? data.cohort2M2.toFixed(1) + '%' : '-',
      cohort2M3: data.cohort2M3 ? data.cohort2M3.toFixed(1) + '%' : '-',
      cohort2M4: data.cohort2M4 ? data.cohort2M4.toFixed(1) + '%' : '-',
      cohort2M5: data.cohort2M5 ? data.cohort2M5.toFixed(1) + '%' : '-',
      cohort2M6: data.cohort2M6 ? data.cohort2M6.toFixed(1) + '%' : '-',

      // NDR
      ndrValue: data.ndr ? data.ndr.toFixed(0) + '%' : '측정 중',
      ndrStatus: data.ndr ? (data.ndr >= 100 ? '확장 성장 중' : (data.ndr >= 80 ? '유지 수준' : '개선 필요')) : '3개월 이상 운영 데이터 필요',

      // === Pre-A 벤치마크 달성률 ===
      mauAchievement: (data.achievements?.mau || 0) + '%',
      mrrAchievement: (data.achievements?.mrr || 0) + '%',
      ltvCacAchievement: (data.achievements?.ltvCac || 0) + '%',
      conversionAchievement: (data.achievements?.conversionRate || 0) + '%',
      d1Achievement: (data.achievements?.d1Retention || 0) + '%',
      grossMarginAchievement: (data.achievements?.grossMargin || 0) + '%',

      // LTV/CAC X format (벤치마크 테이블용)
      ltvCacX: formatX(data.ltvCac)
    };

    // Update all elements with data-kpi attribute
    Object.keys(kpiFormats).forEach(key => {
      document.querySelectorAll(`[data-kpi="${key}"]`).forEach(el => {
        el.textContent = kpiFormats[key];
      });
    });

    // Update MAU source indicator
    const mauSourceEl = document.querySelector('[data-kpi="mauSource"]');
    if (mauSourceEl) {
      const sourceLabels = {
        'ga4': '🟢 GA4 실측',
        'hybrid': '🟡 GA4 + 추정',
        'estimated': '🟠 추정치',
        'fallback': '🔴 폴백'
      };
      mauSourceEl.textContent = sourceLabels[data.mauSource] || data.mauSource;
    }

    // NOTE: TreeWalker text replacement REMOVED (2026-02-02)
    // Reason: Pattern drift causes data binding to break when values change
    // Solution: Use ONLY data-kpi attribute binding (above)
    // All dynamic values should use <span data-kpi="keyName">-</span> pattern
    console.log('[Realtime] Using data-kpi attribute binding only (TreeWalker removed)');

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
      ltvBadge.className = ltvBadge.className.replace(/badge-(green|yellow|red)/g, '').trim() + ' ' + badgeClass;
    }

    // Update Paying Ratio progress bar
    const payingRatioProgress = document.getElementById('payingRatioProgress');
    if (payingRatioProgress) {
        const ratio = data.payingRatio || 0;
        // Benchmark: 3-5% average, 8%+ excellent
        const percent = Math.min((ratio / 8) * 100, 100);
        payingRatioProgress.style.width = percent + '%';
        payingRatioProgress.classList.remove('danger', 'warning', 'achieved', 'excellent');
        if (ratio >= 8) payingRatioProgress.classList.add('excellent');
        else if (ratio >= 5) payingRatioProgress.classList.add('achieved');
        else if (ratio >= 3) payingRatioProgress.classList.add('warning');
        else payingRatioProgress.classList.add('danger');
    }

    // Update status indicators based on thresholds
    updateStatusIndicators(data);

    // Update Gap Analysis progress bars
    updateGapAnalysisProgressBars(data);

    // Update benchmark achievement table
    updateBenchmarkTable(data, formatNum, formatWon, formatPercent, formatX);

    // Update KPI status indicators
    updateKpiStatusIndicators(data);

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

    // Update charts with real data
    if (typeof window.updateChartsWithData === 'function') {
      window.updateChartsWithData(data);
    }

    // Update achievement indicators
    updateAchievementIndicators(data);

    console.log('[Realtime] Dashboard fully updated with real data');
  }

  // Update achievement progress bars and status indicators
  function updateAchievementIndicators(data) {
    const achievements = data.achievements || {};

    // Update progress bars
    const progressMappings = {
      'mauAchievement': achievements.mau || 0,
      'mrrAchievement': achievements.mrr || 0,
      'ltvCacAchievement': achievements.ltvCac || 0,
      'conversionAchievement': achievements.conversionRate || 0,
      'd1Achievement': achievements.d1Retention || 0,
      'grossMarginAchievement': achievements.grossMargin || 0
    };

    Object.keys(progressMappings).forEach(key => {
      const progressEl = document.querySelector(`[data-progress="${key}"]`);
      if (progressEl) {
        const value = Math.min(progressMappings[key], 100);
        progressEl.style.width = value + '%';

        // Color based on achievement
        if (progressMappings[key] >= 100) {
          progressEl.style.background = 'linear-gradient(90deg, #10b981, #059669)';
        } else if (progressMappings[key] >= 80) {
          progressEl.style.background = 'linear-gradient(90deg, #f59e0b, #d97706)';
        } else {
          progressEl.style.background = 'linear-gradient(90deg, #ef4444, #dc2626)';
        }
      }
    });

    // Update status indicators
    const statusMappings = {
      'mau': achievements.mau || 0,
      'mrr': achievements.mrr || 0,
      'ltvCac': achievements.ltvCac || 0,
      'conversion': achievements.conversionRate || 0,
      'd1': achievements.d1Retention || 0,
      'grossMargin': achievements.grossMargin || 0
    };

    Object.keys(statusMappings).forEach(key => {
      const statusEl = document.querySelector(`[data-status="${key}"]`);
      if (statusEl) {
        const value = statusMappings[key];
        if (value >= 100) {
          statusEl.textContent = '🟢';
          statusEl.title = '목표 달성!';
        } else if (value >= 80) {
          statusEl.textContent = '🟡';
          statusEl.title = '목표 근접';
        } else {
          statusEl.textContent = '🔴';
          statusEl.title = '개선 필요';
        }
      }
    });
  }

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

      // Use the shared update function
      updateDashboardWithData(data);

    } catch (error) {
      console.error('[Realtime] Failed to load data:', error);
    }
  }

  // Update KPI status indicators based on Pre-A investment benchmarks
  function updateKpiStatusIndicators(data) {
    const indicators = {
      // MAU: Pre-A 100k target
      'mau-status': { value: data.mau, thresholds: [50000, 100000], classes: ['danger', 'warning', 'achieved'] },
      // D1: Pre-A 30% target
      'd1-status': { value: data.d1Retention, thresholds: [20, 30], classes: ['danger', 'warning', 'achieved'] },
      // LTV:CAC: Pre-A needs 3:1
      'ltvcac-status': { value: data.ltvCac, thresholds: [2, 3], classes: ['danger', 'warning', 'achieved'] },
      // M1 Transaction Retention: Good 20-30%
      'm1-status': { value: data.m1Retention || 0, thresholds: [10, 20], classes: ['danger', 'warning', 'achieved'] },
      // Conversion: Pre-A 5% target
      'conversion-status': { value: data.conversionRate, thresholds: [3, 5], classes: ['danger', 'warning', 'achieved'] }
    };

    Object.keys(indicators).forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        const config = indicators[id];
        let statusClass = config.classes[0]; // default danger
        if (config.value >= config.thresholds[1]) statusClass = config.classes[2];
        else if (config.value >= config.thresholds[0]) statusClass = config.classes[1];
        el.className = el.className.replace(/danger|warning|achieved|excellent/g, '').trim() + ' ' + statusClass;
      }
    });
  }

  function updateStatusIndicators(data) {
    const statusConfig = {
      mau: { value: data.mau, thresholds: [50000, 100000], labels: ['개선필요', '양호', 'Pre-A 달성'] },
      ltvCac: { value: data.ltvCac, thresholds: [2, 3], labels: ['개선필요', '양호', 'Pre-A 달성'] },
      cac: { value: data.cac, thresholds: [10000, 30000], labels: ['Pre-A 달성', '양호', '개선필요'], inverse: true },
      roas: { value: data.roas, thresholds: [1, 2], labels: ['개선필요', '양호', '우수'] },
      d1Retention: { value: data.d1Retention, thresholds: [20, 30], labels: ['개선필요', '양호', 'Pre-A 달성'] },
      stickiness: { value: data.stickiness, thresholds: [10, 20], labels: ['개선필요', '양호', 'Pre-A 달성'] },
      grossMargin: { value: data.grossMargin, thresholds: [50, 70], labels: ['개선필요', '양호', '우수'] }
    };
  }

  function updateGapAnalysisProgressBars(data) {
    // Pre-A 투자 기준 벤치마크
    const gapTargets = {
      // D7 방문 리텐션: Good 10-15%
      d7: { current: data.d7Retention || 0, target: 10, id: 'd7Progress' },
      // D30 방문 리텐션: Good 6-10%
      d30: { current: data.d30Retention || 0, target: 6, id: 'd30Progress' },
      // 재구매율: Good 20-40%
      repurchase: { current: data.repurchaseRate, target: 20, id: 'repurchaseProgress' },
      // LTV:CAC: Pre-A 목표 3:1
      ltvCac: { current: data.ltvCac, target: 3, id: 'ltvCacProgress' },
      // D1 방문 리텐션: Pre-A 30%
      d1: { current: data.d1Retention, target: 30, id: 'd1Progress' },
      // MAU: Pre-A 10만 목표
      mau: { current: data.mau / 100000 * 100, target: 100, id: 'mauProgress' },
      // 전환율: Pre-A 5% 목표
      conversion: { current: data.conversionRate / 5 * 100, target: 100, id: 'conversionProgress' },
      // 거래 리텐션 M1: Good 20-30%
      m1: { current: data.m1Retention || 0, target: 20, id: 'm1Progress' },
      // 거래 리텐션 M6: Good 10-20%
      m6: { current: data.m6Retention || 0, target: 10, id: 'm6Progress' }
    };

    Object.keys(gapTargets).forEach(key => {
      const gap = gapTargets[key];
      const el = document.getElementById(gap.id);
      if (el) {
        const percent = Math.min(Math.round(gap.current / gap.target * 100), 100);
        el.style.width = percent + '%';

        el.classList.remove('danger', 'warning', 'achieved', 'excellent');
        if (percent >= 100) {
          el.classList.add('achieved');
        } else if (percent >= 70) {
          el.classList.add('warning');
        } else {
          el.classList.add('danger');
        }
      }
    });

    console.log('[Realtime] Gap analysis progress bars updated');
  }

  function updateBenchmarkTable(data, formatNum, formatWon, formatPercent, formatX) {
    // Calculate paidD1Retention and paidUserEngagement from data (fix scope issue)
    const paidD1Retention = data.paidD1Retention || 0;
    const paidUserEngagement = data.d1Retention > 0 && paidD1Retention > 0 ? (paidD1Retention / data.d1Retention) : 0;

    // Pre-A 투자 기준 벤치마크
    const benchmarks = {
      mau: { target: 100000, type: 'min' },  // Pre-A: 10만
      revenue: { target: 300000000, type: 'min' },  // Pre-A: MRR 3억원
      arppu: { target: 20000, type: 'min' },
      // LTV:CAC: Pre-A 목표 3:1
      ltvCac: { target: 3.0, type: 'min' },
      cac: { target: 10000, type: 'max' },
      // 전환율: Pre-A 목표 5%
      conversionRate: { target: 5.0, type: 'min' },
      // Stickiness: Pre-A 목표 20%
      stickiness: { target: 20.0, type: 'min' },
      // D1 방문 리텐션: Good 30%
      d1Retention: { target: 30, type: 'min' },
      // D7 방문 리텐션: Good 10-15%
      d7Retention: { target: 10, type: 'min' },
      // D30 방문 리텐션: Good 6-10%
      d30Retention: { target: 6, type: 'min' },
      // 거래 리텐션 M1: Good 20-30%
      m1Retention: { target: 20, type: 'min' },
      // 재구매율: Good 20-40%
      repurchaseRate: { target: 20, type: 'min' },
      paidD1: { target: null, type: 'measure' }
    };

    function calculateAchievement(value, benchmark) {
      if (benchmark.type === 'measure' || benchmark.target === null) {
        return { percent: null, status: 'measure' };
      }

      let percent;
      if (benchmark.type === 'max') {
        percent = (benchmark.target / value) * 100;
      } else {
        percent = (value / benchmark.target) * 100;
      }

      let status;
      if (percent >= 150) {
        status = 'excellent';
      } else if (percent >= 100) {
        status = 'achieved';
      } else if (percent >= 70) {
        status = 'warning';
      } else {
        status = 'danger';
      }

      return { percent: Math.round(percent), status };
    }

    const achievements = {
      mau: calculateAchievement(data.mau, benchmarks.mau),
      revenue: calculateAchievement(data.revenue, benchmarks.revenue),
      arppu: calculateAchievement(data.arppu, benchmarks.arppu),
      ltvCac: calculateAchievement(data.ltvCac, benchmarks.ltvCac),
      cac: calculateAchievement(data.cac, benchmarks.cac),
      conversionRate: calculateAchievement(data.conversionRate, benchmarks.conversionRate),
      stickiness: calculateAchievement(data.stickiness, benchmarks.stickiness),
      d1Retention: calculateAchievement(data.d1Retention, benchmarks.d1Retention),
      d7Retention: calculateAchievement(data.d7Retention || 0, benchmarks.d7Retention),
      d30Retention: calculateAchievement(data.d30Retention || 0, benchmarks.d30Retention),
      m1Retention: calculateAchievement(data.m1Retention || 0, benchmarks.m1Retention),
      repurchaseRate: calculateAchievement(data.repurchaseRate, benchmarks.repurchaseRate),
      paidD1: { percent: null, status: 'measure' }
    };

    const statusLabels = {
      excellent: '초과달성',
      achieved: '달성',
      warning: '미달',
      danger: '미달',
      measure: '측정중'
    };

    const updates = {
      benchmarkMauValue: formatNum(data.mau) + '명',
      benchmarkMauPercent: achievements.mau.percent + '%',
      benchmarkMauStatus: statusLabels[achievements.mau.status],
      benchmarkMauMeaning: achievements.mau.percent >= 100 ? 'Pre-A 기준 달성' : 'Pre-A 목표 개선 필요',
      benchmarkRevenueValue: formatNum(data.revenue) + '원',
      benchmarkRevenuePercent: achievements.revenue.percent + '%',
      benchmarkRevenueStatus: statusLabels[achievements.revenue.status],
      benchmarkRevenueMeaning: achievements.revenue.percent >= 100 ? 'Pre-A 기준 달성' : 'Pre-A 목표 개선 필요',
      benchmarkArppuValue: formatWon(data.arppu),
      benchmarkArppuPercent: achievements.arppu.percent + '%',
      benchmarkArppuStatus: statusLabels[achievements.arppu.status],
      benchmarkArppuMeaning: achievements.arppu.percent >= 100 ? 'Pre-A 기준 달성' : '개선 필요',
      benchmarkLtvCacValue: formatX(data.ltvCac),
      benchmarkLtvCacPercent: achievements.ltvCac.percent + '%',
      benchmarkLtvCacStatus: statusLabels[achievements.ltvCac.status],
      benchmarkLtvCacMeaning: data.ltvCac >= 3.0 ? 'Pre-A 기준 달성' : `Pre-A 3x 목표 대비 ${achievements.ltvCac.percent}%`,
      benchmarkCacValue: formatWon(data.cac),
      benchmarkCacPercent: achievements.cac.percent + '%',
      benchmarkCacStatus: statusLabels[achievements.cac.status],
      benchmarkCacMeaning: achievements.cac.percent >= 100 ? 'Pre-A 기준 달성' : 'CAC 절감 필요',
      benchmarkConversionValue: formatPercent(data.conversionRate),
      benchmarkConversionPercent: achievements.conversionRate.percent + '%',
      benchmarkConversionStatus: statusLabels[achievements.conversionRate.status],
      benchmarkConversionMeaning: achievements.conversionRate.percent >= 100 ? 'Pre-A 기준 달성' : 'Pre-A 목표 개선 필요',
      benchmarkStickinessValue: formatPercent(data.stickiness),
      benchmarkStickinessPercent: achievements.stickiness.percent + '%',
      benchmarkStickinessStatus: statusLabels[achievements.stickiness.status],
      benchmarkStickinessMeaning: achievements.stickiness.percent >= 100 ? 'Pre-A 기준 달성' : 'Pre-A 목표 개선 필요',
      benchmarkD1Value: formatPercent(data.d1Retention),
      benchmarkD1Percent: '-',
      benchmarkD1Status: '측정중',
      benchmarkD1Meaning: '웹 한계',
      benchmarkPaidD1Value: paidD1Retention > 0 ? paidD1Retention.toFixed(1) + '%' : '측정중',
      benchmarkPaidD1Percent: '-',
      benchmarkPaidD1Status: paidUserEngagement > 0 ? '결제자 참여도 ' + paidUserEngagement.toFixed(1) + '배' : '측정중',
      benchmarkPaidD1Meaning: paidD1Retention > 0 ? '가치 검증' : '데이터 수집중'
    };

    Object.keys(updates).forEach(key => {
      document.querySelectorAll(`[data-kpi="${key}"]`).forEach(el => {
        el.textContent = updates[key];
      });
    });

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
        el.className = el.className.replace(/excellent|achieved|warning|danger/g, '').trim();
        el.classList.add(barUpdates[key].status);
      });
    });

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

    const achievedMetrics = [];
    const progressMetrics = [];
    const needsImprovementMetrics = [];

    // KPI 정의서 v3.0 기준 메트릭 이름
    const metricNames = {
      mau: 'MAU',
      revenue: 'MRR',
      arppu: 'ARPPU',
      ltvCac: 'LTV/CAC',
      cac: 'CAC',
      conversionRate: '전환율',
      stickiness: 'Stickiness',
      d1Retention: 'D1 방문 리텐션',
      d7Retention: 'D7 방문 리텐션',
      d30Retention: 'D30 방문 리텐션',
      m1Retention: 'M1 거래 리텐션',
      repurchaseRate: '재구매율',
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

    const totalMetrics = Object.keys(metricNames).length;
    const summaryUpdates = {
      achievedCount: achievedMetrics.length.toString(),
      achievedList: achievedMetrics.join(', ') || '-',
      progressCount: progressMetrics.length.toString(),
      progressList: progressMetrics.join(', ') || '-',
      needsImprovementCount: needsImprovementMetrics.length.toString(),
      needsImprovementList: needsImprovementMetrics.join(', ') || '-',
      achievementSummary: `${achievedMetrics.length}/${totalMetrics} 지표 달성`
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

  // Expose functions globally for external calls
  window.refreshDashboard = loadRealtimeData;
  window.updateDashboardWithData = updateDashboardWithData;
})();
