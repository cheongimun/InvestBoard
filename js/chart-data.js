/**
 * 차트 데이터 실시간 연동
 * KPI API에서 데이터를 가져와 모든 차트를 업데이트
 */

(function() {
  'use strict';

  // 차트 인스턴스 저장
  let chartInstances = {};

  // 포맷팅 헬퍼
  const formatMan = n => (n / 10000).toFixed(1);
  const formatEok = n => (n / 100000000).toFixed(2);

  // Pre-A 벤치마크 기준값 (투자 기준)
  const BENCHMARKS = {
    mau: 100000,          // 10만 (Pre-A 기준)
    revenue: 300000000,   // 3억원 MRR (Pre-A 기준)
    arppu: 30000,         // 3만원 (Pre-A 기준)
    ltvCac: 3.0,          // 3:1 (Pre-A 기준)
    cac: 15000,           // 1.5만원 이하 (낮을수록 좋음)
    conversionRate: 5.0,  // 5% (Pre-A 기준)
    stickiness: 10.0      // 10% (Pre-A 기준)
  };

  // 달성률 계산 (퍼센트)
  function calcAchievement(value, benchmark, inverse = false) {
    if (!value || !benchmark) return 0;
    if (inverse) {
      return Math.round((benchmark / value) * 100);
    }
    return Math.round((value / benchmark) * 100);
  }

  // 차트 데이터 업데이트 함수
  async function updateChartsWithRealData() {
    try {
      console.log('[Charts] Fetching KPI data for charts...');
      const response = await fetch('/api/kpi');
      const result = await response.json();

      if (!result.success) {
        console.error('[Charts] API Error:', result.error);
        return;
      }

      const data = result.data;
      console.log('[Charts] Updating charts with real data:', data);

      // 달성률 계산
      const achievements = {
        mau: calcAchievement(data.mau, BENCHMARKS.mau),
        revenue: calcAchievement(data.revenue, BENCHMARKS.revenue),
        arppu: calcAchievement(data.arppu, BENCHMARKS.arppu),
        ltvCac: calcAchievement(data.ltvCac, BENCHMARKS.ltvCac),
        cac: calcAchievement(data.cac, BENCHMARKS.cac, true),  // CAC는 낮을수록 좋음
        conversionRate: calcAchievement(data.conversionRate, BENCHMARKS.conversionRate),
        stickiness: calcAchievement(data.stickiness, BENCHMARKS.stickiness)
      };

      // 1. 벤치마크 레이더 차트 업데이트
      updateBenchmarkChart(achievements);

      // 2. 단계별 위치 차트 업데이트
      updateStageChart(data);

      // 3. ARPPU 비교 차트 업데이트
      updateArppuChart(data);

      // 4. 성장 곡선 차트 업데이트
      updateGrowthChart(data);

      // 5. 투자사별 적합도 레이더 차트 업데이트
      updateInvestorFitChart(data);

      console.log('[Charts] All charts updated with real data');

    } catch (error) {
      console.error('[Charts] Failed to update charts:', error);
    }
  }

  // 벤치마크 레이더 차트 업데이트
  function updateBenchmarkChart(achievements) {
    const canvas = document.getElementById('benchmarkChart');
    if (!canvas) return;

    // 기존 차트 제거
    if (chartInstances.benchmark) {
      chartInstances.benchmark.destroy();
    }

    const ctx = canvas.getContext('2d');
    chartInstances.benchmark = new Chart(ctx, {
      type: 'radar',
      data: {
        labels: ['MAU', 'MRR', 'ARPPU', 'LTV/CAC', 'CAC', '유료전환율', 'Stickiness'],
        datasets: [{
          label: '달성률 (%)',
          data: [
            achievements.mau,
            achievements.revenue,
            achievements.arppu,
            achievements.ltvCac,
            achievements.cac,
            achievements.conversionRate,
            achievements.stickiness
          ],
          borderColor: '#667eea',
          backgroundColor: 'rgba(102, 126, 234, 0.2)',
          pointBackgroundColor: '#667eea'
        }, {
          label: 'Pre-A 기준 (100%)',
          data: [100, 100, 100, 100, 100, 100, 100],
          borderColor: 'rgba(255,255,255,0.3)',
          backgroundColor: 'transparent',
          borderDash: [5, 5],
          pointRadius: 0
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          r: {
            beginAtZero: true,
            max: 500,
            grid: { color: 'rgba(255,255,255,0.1)' },
            angleLines: { color: 'rgba(255,255,255,0.1)' },
            pointLabels: { color: '#888', font: { size: 11 } }
          }
        },
        plugins: { legend: { position: 'bottom', labels: { color: '#888' } } }
      }
    });
  }

  // 단계별 위치 차트 업데이트
  function updateStageChart(data) {
    const canvas = document.getElementById('stageChart');
    if (!canvas) return;

    if (chartInstances.stage) {
      chartInstances.stage.destroy();
    }

    const ctx = canvas.getContext('2d');
    chartInstances.stage = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: ['MAU (만명)', 'MRR (억원)', 'LTV/CAC (배)', 'ARPPU (만원)'],
        datasets: [{
          label: 'Seed 기준',
          data: [5, 1, 2, 2],
          backgroundColor: 'rgba(255,255,255,0.1)',
          borderRadius: 4
        }, {
          label: 'Pre-A 기준',
          data: [10, 3, 3, 3],
          backgroundColor: 'rgba(245, 158, 11, 0.3)',
          borderRadius: 4
        }, {
          label: '천기문 현재',
          data: [
            parseFloat(formatMan(data.mau)),           // MAU in 만명
            parseFloat(formatEok(data.revenue)),       // MRR in 억원
            data.ltvCac,                               // LTV/CAC
            data.arppu / 10000                         // ARPPU in 만원
          ],
          backgroundColor: 'rgba(102, 126, 234, 0.8)',
          borderRadius: 4
        }, {
          label: 'Pre-A 기준',
          data: [30, 10, 4, 4],
          backgroundColor: 'rgba(16, 185, 129, 0.3)',
          borderRadius: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { color: '#888' } } },
        scales: {
          y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' } },
          x: { grid: { display: false } }
        }
      }
    });
  }

  // ARPPU 비교 차트 업데이트
  function updateArppuChart(data) {
    const canvas = document.getElementById('arppuChart');
    if (!canvas) return;

    if (chartInstances.arppu) {
      chartInstances.arppu.destroy();
    }

    const ctx = canvas.getContext('2d');
    chartInstances.arppu = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: ['천기문', '포스텔러', '점신'],
        datasets: [{
          label: 'ARPPU (원)',
          data: [data.arppu, 6000, 4000],  // 경쟁사 데이터는 고정 (공개 데이터)
          backgroundColor: ['rgba(102, 126, 234, 0.8)', 'rgba(59, 130, 246, 0.6)', 'rgba(16, 185, 129, 0.6)'],
          borderRadius: 8
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: 'y',
        plugins: { legend: { display: false } },
        scales: {
          x: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' } },
          y: { grid: { display: false } }
        }
      }
    });
  }

  // 성장 곡선 차트 업데이트
  function updateGrowthChart(data) {
    const canvas = document.getElementById('growthChart');
    if (!canvas) return;

    if (chartInstances.growth) {
      chartInstances.growth.destroy();
    }

    // 현재 값 기반 성장 예측 (보수적/낙관적 시나리오 반영)
    const currentMau = parseFloat(formatMan(data.mau));
    const currentMrr = parseFloat(formatEok(data.revenue));

    // 성장률 가정: 월 15% 복리 성장 (보수적)
    const growthRate = 1.15;
    const projectedMau = [
      currentMau,
      Math.round(currentMau * Math.pow(growthRate, 3) * 10) / 10,
      Math.round(currentMau * Math.pow(growthRate, 6) * 10) / 10,
      Math.round(currentMau * Math.pow(growthRate, 9) * 10) / 10,
      Math.round(currentMau * Math.pow(growthRate, 12) * 10) / 10,
      Math.round(currentMau * Math.pow(growthRate, 18) * 10) / 10
    ];
    const projectedMrr = [
      currentMrr,
      Math.round(currentMrr * Math.pow(growthRate, 3) * 100) / 100,
      Math.round(currentMrr * Math.pow(growthRate, 6) * 100) / 100,
      Math.round(currentMrr * Math.pow(growthRate, 9) * 100) / 100,
      Math.round(currentMrr * Math.pow(growthRate, 12) * 100) / 100,
      Math.round(currentMrr * Math.pow(growthRate, 18) * 100) / 100
    ];

    const ctx = canvas.getContext('2d');
    chartInstances.growth = new Chart(ctx, {
      type: 'line',
      data: {
        labels: ['현재', '3개월', '6개월', '9개월', '12개월', '18개월'],
        datasets: [{
          label: 'MAU (만명)',
          data: projectedMau,
          borderColor: '#667eea',
          backgroundColor: 'rgba(102, 126, 234, 0.1)',
          fill: true,
          tension: 0.4,
          yAxisID: 'y'
        }, {
          label: 'MRR (억원)',
          data: projectedMrr,
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
        plugins: {
          legend: { position: 'bottom', labels: { color: '#888' } },
          tooltip: {
            callbacks: {
              title: function(context) {
                return context[0].label + ' 예상';
              }
            }
          }
        },
        scales: {
          y: {
            type: 'linear',
            position: 'left',
            title: { display: true, text: 'MAU (만명)', color: '#888' },
            grid: { color: 'rgba(255,255,255,0.05)' }
          },
          y1: {
            type: 'linear',
            position: 'right',
            title: { display: true, text: 'MRR (억원)', color: '#888' },
            grid: { drawOnChartArea: false }
          },
          x: { grid: { display: false } }
        }
      }
    });
  }

  // 투자사별 적합도 레이더 차트 업데이트
  function updateInvestorFitChart(data) {
    const canvas = document.getElementById('investorFitChart');
    if (!canvas) return;

    if (chartInstances.investorFit) {
      chartInstances.investorFit.destroy();
    }

    // 투자사별 기준 충족률 계산 (실시간 데이터 기반)
    // 카카오벤처스: 트래픽 중시, 전환율 중시
    // 알토스벤처스: 성장률 중시, 팀 역량 중시
    // DSC: 수익성 중시, Unit Economics 중시

    // 천기문 현재 값 기반 충족률 계산
    const trafficScore = Math.min(150, Math.round((data.mau / 50000) * 100));  // 5만 기준
    const conversionScore = Math.min(150, Math.round((data.conversionRate / 3) * 100));  // 3% 기준
    const retentionScore = Math.min(150, Math.round((data.d1Retention / 30) * 100));  // 30% 기준 (앱)
    const ltvCacScore = Math.min(150, Math.round((data.ltvCac / 3) * 100));  // 3x 기준
    const teamScore = 90;  // 정성적 평가 (고정)
    const marketScore = 95;  // 시장 기회 (고정)

    // 투자사별 가중치 적용
    const kakaoData = [
      Math.round(trafficScore * 1.0),
      Math.round(conversionScore * 1.0),
      Math.round(retentionScore * 0.5),  // 리텐션은 앱 전환 후 개선 가능
      Math.round(ltvCacScore * 1.0),
      teamScore,
      marketScore
    ];

    const altosData = [
      Math.round(trafficScore * 0.9),
      Math.round(conversionScore * 0.8),
      Math.round(retentionScore * 0.4),
      Math.round(ltvCacScore * 1.0),
      Math.round(teamScore * 1.05),
      Math.round(marketScore * 0.95)
    ];

    const dscData = [
      Math.round(trafficScore * 0.4),
      Math.round(conversionScore * 0.7),
      Math.round(retentionScore * 0.6),
      Math.round(ltvCacScore * 0.9),
      Math.round(teamScore * 0.95),
      marketScore
    ];

    const ctx = canvas.getContext('2d');
    chartInstances.investorFit = new Chart(ctx, {
      type: 'radar',
      data: {
        labels: ['트래픽', '전환율', '리텐션', 'LTV/CAC', '팀 역량', '시장기회'],
        datasets: [{
          label: '카카오벤처스 기준 충족률',
          data: kakaoData,
          borderColor: '#10b981',
          backgroundColor: 'rgba(16, 185, 129, 0.15)',
          pointBackgroundColor: '#10b981',
          pointRadius: 4
        }, {
          label: '알토스벤처스 기준 충족률',
          data: altosData,
          borderColor: '#3b82f6',
          backgroundColor: 'rgba(59, 130, 246, 0.1)',
          pointBackgroundColor: '#3b82f6',
          pointRadius: 4
        }, {
          label: 'DSC 기준 충족률',
          data: dscData,
          borderColor: '#f59e0b',
          backgroundColor: 'rgba(245, 158, 11, 0.1)',
          pointBackgroundColor: '#f59e0b',
          pointRadius: 4
        }, {
          label: '기준선 (100%)',
          data: [100, 100, 100, 100, 100, 100],
          borderColor: 'rgba(255,255,255,0.2)',
          backgroundColor: 'transparent',
          borderDash: [5, 5],
          pointRadius: 0
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          r: {
            beginAtZero: true,
            max: 150,
            grid: { color: 'rgba(255,255,255,0.1)' },
            angleLines: { color: 'rgba(255,255,255,0.1)' },
            pointLabels: { color: '#ccc', font: { size: 11 } },
            ticks: { display: false }
          }
        },
        plugins: {
          legend: {
            position: 'bottom',
            labels: { color: '#888', padding: 15, usePointStyle: true, font: { size: 10 } }
          },
          tooltip: {
            callbacks: {
              label: function(context) {
                return context.dataset.label + ': ' + context.raw + '%';
              }
            }
          }
        }
      }
    });
  }

  // DOMContentLoaded 후 차트 업데이트
  function init() {
    // 초기 차트가 렌더링된 후 실시간 데이터로 업데이트
    // 기존 inline 차트 코드가 먼저 실행되므로 약간의 지연 후 업데이트
    setTimeout(updateChartsWithRealData, 500);
  }

  // 페이지 로드 시 실행
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // 5분마다 차트 데이터 갱신
  setInterval(updateChartsWithRealData, 5 * 60 * 1000);

  // 외부 접근용
  window.updateChartsWithRealData = updateChartsWithRealData;

})();
