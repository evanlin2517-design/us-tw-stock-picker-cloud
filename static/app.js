let dashboardData = null;
let selectedDirection = "all";
const HIT_RETURN = 0.005;
const STATIC_MODE = !["localhost", "127.0.0.1"].includes(window.location.hostname);

const runButton = document.querySelector("#runButton");
const refreshValidationButton = document.querySelector("#refreshValidationButton");
const runStatus = document.querySelector("#runStatus");
const startSchedulerButton = document.querySelector("#startSchedulerButton");
const stopSchedulerButton = document.querySelector("#stopSchedulerButton");
const shutdownServerButton = document.querySelector("#shutdownServerButton");
const floatingTooltip = document.querySelector("#floatingTooltip");

const holidays = {
  tw: new Set([
    "2026-01-01", "2026-02-16", "2026-02-17", "2026-02-18", "2026-02-19", "2026-02-20",
    "2026-02-27", "2026-04-03", "2026-04-06", "2026-05-01", "2026-06-19",
    "2026-09-25", "2026-09-28", "2026-10-09"
  ]),
  us: new Set([
    "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25",
    "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25"
  ])
};

document.querySelectorAll(".nav-tab").forEach((button) => {
  button.addEventListener("click", () => switchView(button.dataset.view));
});

document.querySelectorAll(".segment").forEach((button) => {
  button.addEventListener("click", () => {
    selectedDirection = button.dataset.direction;
    document.querySelectorAll(".segment").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    renderToday(dashboardData?.latest_predictions || []);
  });
});

runButton.addEventListener("click", async () => {
  if (STATIC_MODE) {
    runStatus.textContent = "雲端版請到 GitHub Actions 手動執行 Cloud Morning Prediction。";
    return;
  }
  runButton.disabled = true;
  runButton.textContent = "執行中...";
  runStatus.textContent = "預測任務執行中";

  try {
    const result = await postJson("/api/prediction-runs");
    runStatus.textContent = result.message || "預測任務已送出";
    await refreshDashboard();
    if (result.status === "running") pollUntilFinished();
  } catch (error) {
    runStatus.textContent = "執行預測失敗";
    runButton.disabled = false;
    runButton.textContent = "執行預測";
    console.error(error);
  }
});

refreshValidationButton.addEventListener("click", async () => {
  if (STATIC_MODE) {
    runStatus.textContent = "雲端版請到 GitHub Actions 手動執行 Cloud After Close Validation。";
    return;
  }
  refreshValidationButton.disabled = true;
  refreshValidationButton.textContent = "回填中...";
  runStatus.textContent = "正在更新實際股價";

  try {
    const result = await postJson("/api/validation/refresh?days=7");
    dashboardData = result.dashboard;
    renderDashboard(dashboardData);
    runStatus.textContent = result.message || "驗證資料已更新";
  } catch (error) {
    runStatus.textContent = "更新實際股價失敗";
    console.error(error);
  } finally {
    refreshValidationButton.disabled = false;
    refreshValidationButton.textContent = "更新實際股價／回填驗證";
  }
});

startSchedulerButton.addEventListener("click", async () => {
  if (STATIC_MODE) {
    runStatus.textContent = "雲端排程由 GitHub Actions 管理。";
    return;
  }
  await postJson("/api/scheduler/start");
  await refreshDashboard();
});

stopSchedulerButton.addEventListener("click", async () => {
  if (STATIC_MODE) {
    runStatus.textContent = "雲端排程由 GitHub Actions 管理。";
    return;
  }
  await postJson("/api/scheduler/stop");
  await refreshDashboard();
});

shutdownServerButton.addEventListener("click", async () => {
  if (STATIC_MODE) {
    runStatus.textContent = "這是 GitHub Pages 靜態版，沒有本機服務需要關閉。";
    return;
  }
  const confirmed = window.confirm("確定要關閉本機 Web 服務嗎？關閉後需要再次雙擊啟動選股系統.bat 才能使用。");
  if (!confirmed) return;
  runStatus.textContent = "正在關閉本機服務";
  try {
    await postJson("/api/server/shutdown");
    document.body.innerHTML = `
      <main class="shutdown-screen">
        <section class="panel">
          <div class="panel-title"><h2>本機服務已關閉</h2></div>
          <div class="empty">若要再次使用，請雙擊「啟動選股系統.bat」。</div>
        </section>
      </main>`;
  } catch (error) {
    runStatus.textContent = "關閉失敗，請雙擊關閉選股系統.bat";
    console.error(error);
  }
});

document.querySelector("#closeDrawerButton").addEventListener("click", closeDrawer);
document.querySelector("#detailDrawer").addEventListener("click", (event) => {
  if (event.target.id === "detailDrawer") closeDrawer();
});

async function pollUntilFinished() {
  if (STATIC_MODE) return;
  const timer = setInterval(async () => {
    const latest = await fetchJson("/api/prediction-runs/latest");
    renderRunState(latest);
    if (!latest || latest.status !== "running") {
      clearInterval(timer);
      await refreshDashboard();
    }
  }, 2500);
}

async function refreshDashboard() {
  dashboardData = STATIC_MODE
    ? await fetchJson("data/dashboard.json")
    : await fetchJson("/api/dashboard?days=5");
  renderDashboard(dashboardData);
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`API 錯誤：${response.status}`);
  return response.json();
}

async function postJson(url) {
  if (STATIC_MODE) throw new Error("GitHub Pages 靜態版沒有後端 API");
  const response = await fetch(url, { method: "POST" });
  if (!response.ok) throw new Error(`API 錯誤：${response.status}`);
  return response.json();
}

function renderDashboard(data) {
  renderRunState(data.latest_run);
  renderSummary(data.summary || {}, data.pending_validation_count || 0);
  renderHealth(data.health || {});
  renderFreshness(data.freshness || {});
  renderTopRecommendations(data.top_recommendations || []);
  renderToday(data.latest_predictions || []);
  renderHistory(data.recent_predictions || []);
  renderValidation(data.recent_predictions || [], data.summary || {});
  renderRuns(data.recent_runs || []);
  renderScheduler(data.scheduler || {});
  renderCloudMode(data);
  bindFloatingTooltips();
}

function switchView(viewName) {
  document.querySelectorAll(".nav-tab").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === viewName);
  });
  document.querySelectorAll(".view").forEach((view) => {
    view.classList.toggle("active", view.id === viewName);
  });
}

function renderRunState(run) {
  if (!run) {
    runStatus.textContent = "尚無執行紀錄";
    runButton.disabled = false;
    runButton.textContent = "執行預測";
    setText("#latestRunTime", "尚無資料");
    setText("#dataDate", "尚無資料");
    setText("#targetDate", "尚無資料");
    return;
  }

  setText("#latestRunTime", formatDateTime(run.started_at));
  setText("#dataDate", formatDate(run.us_data_date));
  setText("#targetDate", formatDate(run.target_tw_date));

  if (run.status === "running") {
    runStatus.textContent = "執行中";
    runButton.disabled = true;
    runButton.textContent = "執行中...";
  } else if (run.status === "success") {
    runStatus.textContent = "已完成";
    runButton.disabled = false;
    runButton.textContent = "執行預測";
  } else if (run.status === "failed") {
    runStatus.textContent = "執行失敗";
    runButton.disabled = false;
    runButton.textContent = "重新執行";
  } else {
    runStatus.textContent = run.status || "未知";
    runButton.disabled = false;
    runButton.textContent = "執行預測";
  }
}

function renderCloudMode(data) {
  if (!STATIC_MODE) return;
  runButton.disabled = false;
  runButton.textContent = "到 Actions 執行預測";
  refreshValidationButton.disabled = false;
  refreshValidationButton.textContent = "到 Actions 執行回填";
  const generatedAt = data?.cloud_generated_at ? formatDateTime(data.cloud_generated_at) : "尚無資料";
  if (runStatus.textContent === "準備就緒" || runStatus.textContent === "已完成" || runStatus.textContent === "尚無執行紀錄") {
    runStatus.textContent = `雲端靜態版，更新於 ${generatedAt}`;
  }
}

function renderSummary(summary, pendingCount) {
  setText("#overallAccuracy", formatPercent(summary.overall_accuracy));
  setText("#bullishAccuracy", formatPercent(summary.bullish_accuracy));
  setText("#bearishAccuracy", formatPercent(summary.bearish_accuracy));
  setText("#pendingCount", `${pendingCount}`);
}

function renderHealth(health) {
  setText("#healthText", health.label || "尚無資料");
}

function renderFreshness(freshness) {
  const entries = Object.entries(freshness);
  const target = document.querySelector("#freshnessList");
  if (!entries.length) {
    target.innerHTML = emptyBlock("尚無資料新鮮度資訊");
    return;
  }
  target.innerHTML = entries
    .map(([label, value]) => `<div class="definition-row"><span>${escapeHtml(label)}</span><strong>${formatDate(value)}</strong></div>`)
    .join("");
}

function renderTopRecommendations(rows) {
  const target = document.querySelector("#topRecommendations");
  if (!rows.length) {
    target.innerHTML = emptyBlock("今日沒有符合條件的訊號");
    return;
  }
  target.innerHTML = rows.slice(0, 5).map((row) => `
    <article class="compact-item">
      <div>
        <strong>${escapeHtml(cleanTicker(row.tw_ticker))}</strong>
        <span>${escapeHtml(row.tw_name || "")}</span>
      </div>
      ${directionTag(displayDecision(row))}
      <div>${formatNumber(row.confidence_score, 1)}</div>
    </article>`).join("");
}

function renderToday(rows) {
  const target = document.querySelector("#todayRows");
  const title = document.querySelector("#todayTitle");
  const subtitle = document.querySelector("#todaySubtitle");
  const state = document.querySelector("#todayState");
  title.textContent = dashboardData?.latest_target_date
    ? `目標台股交易日：${formatDate(dashboardData.latest_target_date)}`
    : "目標台股交易日";
  subtitle.textContent = "正式判定看前日收盤到 T+1/T+2/T+3 收盤；開盤進場另列交易參考。";

  const filtered = selectedDirection === "all"
    ? rows.filter((row) => isActionablePrediction(row))
    : rows.filter((row) => displayDecision(row) === selectedDirection);

  if (!filtered.length) {
    target.innerHTML = `<tr><td colspan="11">${emptyBlock("今日沒有符合條件的訊號")}</td></tr>`;
    state.className = "tag pending-tag";
    state.textContent = "無訊號";
    return;
  }

  const pending = filtered.some((row) => ["觀察中", "待回填", null, undefined].includes(row.validation_status));
  state.className = pending ? "tag pending-tag" : "tag hit-tag";
  state.textContent = pending ? "觀察中／待回填" : "已完成驗證";
  target.innerHTML = filtered.map(renderPredictionRow).join("");
  bindFloatingTooltips();
}

function renderPredictionRow(row) {
  return `
    <tr>
      <td><strong>${escapeHtml(cleanTicker(row.tw_ticker))}</strong><br><span class="muted">${escapeHtml(row.tw_name || "")}</span></td>
      <td>${directionTag(displayDecision(row))}</td>
      <td>${formatNumber(row.confidence_score, 1)}</td>
      <td>${escapeHtml(row.main_us_sources || "")}</td>
      <td>${formatImpactEntry(row)}</td>
      <td>${impactReturnCell(row, 1)}</td>
      <td>${impactReturnCell(row, 2)}</td>
      <td>${impactReturnCell(row, 3)}</td>
      <td>${formatTradeSummary(row)}</td>
      <td>${validationTag(row)}</td>
      <td>${escapeHtml(triggerSummary(row))}</td>
    </tr>`;
}

function renderHistory(rows) {
  const target = document.querySelector("#historyAccordion");
  const groups = groupByDate(rows);
  const dates = Object.keys(groups).sort().reverse();
  if (!dates.length) {
    target.innerHTML = emptyBlock("尚無歷史預測資料");
    return;
  }

  target.innerHTML = dates.map((date, index) => {
    const group = groups[date];
    const stats = summarizeRows(group);
    return `
      <details ${index === 0 ? "open" : ""}>
        <summary>
          <span>${formatDate(date)}</span>
          <span class="date-meta">
            <span>推薦 ${group.length} 檔</span>
            <span>看漲 ${stats.bullish}</span>
            <span>看跌 ${stats.bearish}</span>
            <span>多空 ${stats.mixed}</span>
            <span>命中率 ${formatPercent(stats.accuracy)}</span>
            <span>平均正式報酬 ${formatSignedPercent(stats.averageBestReturn)}</span>
          </span>
          ${stats.pending > 0 ? `<span class="tag pending-tag">觀察中 ${stats.pending}</span>` : `<span class="tag hit-tag">已驗證</span>`}
        </summary>
        <div class="detail-body">
          ${renderHistoryDirection("看漲", group)}
          ${renderHistoryDirection("看跌", group)}
          ${renderHistoryDirection("多空混合", group)}
        </div>
      </details>`;
  }).join("");
}

function renderHistoryDirection(direction, rows) {
  const filtered = rows.filter((row) => displayDecision(row) === direction);
  if (!filtered.length) return `<div class="section-label">${direction}</div><p class="muted">沒有符合條件的${direction}訊號。</p>`;
  return `
    <div class="section-label">${direction}</div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>台股</th><th>預測</th><th>信心</th><th>影響基準</th><th>T+1 影響</th><th>T+2 影響</th><th>T+3 影響</th><th>開盤進場參考</th><th>正式判定</th><th>主要來源</th>
          </tr>
        </thead>
        <tbody>
          ${filtered.map((row) => `
            <tr>
              <td><strong>${escapeHtml(cleanTicker(row.tw_ticker))}</strong><br><span class="muted">${escapeHtml(row.tw_name || "")}</span></td>
              <td>${directionTag(displayDecision(row))}</td>
              <td>${formatNumber(row.confidence_score, 1)}</td>
              <td>${formatImpactEntry(row)}</td>
              <td>${impactReturnCell(row, 1)}</td>
              <td>${impactReturnCell(row, 2)}</td>
              <td>${impactReturnCell(row, 3)}</td>
              <td>${formatTradeSummary(row)}</td>
              <td>${validationTag(row)}</td>
              <td>${escapeHtml(row.main_us_sources || "")}</td>
            </tr>`).join("")}
        </tbody>
      </table>
    </div>`;
}

function renderValidation(rows, summary) {
  const summaryTarget = document.querySelector("#validationSummary");
  summaryTarget.innerHTML = `
    <article class="metric"><span>已驗證筆數</span><strong>${summary.validated_count || 0}</strong></article>
    <article class="metric"><span>整體命中率</span><strong>${formatPercent(summary.overall_accuracy)}</strong></article>
    <article class="metric"><span>看漲命中率</span><strong>${formatPercent(summary.bullish_accuracy)}</strong></article>
    <article class="metric"><span>開盤交易命中率</span><strong>${formatPercent(summary.trade_accuracy)}</strong></article>
  `;

  const target = document.querySelector("#validationRows");
  if (!rows.length) {
    target.innerHTML = `<tr><td colspan="9">${emptyBlock("尚無驗證資料")}</td></tr>`;
    return;
  }

  target.innerHTML = rows.map((row) => `
    <tr>
      <td>${formatDate(row.target_tw_date)}</td>
      <td><strong>${escapeHtml(cleanTicker(row.tw_ticker))}</strong><br><span class="muted">${escapeHtml(row.tw_name || "")}</span></td>
      <td>${directionTag(displayDecision(row))}</td>
      <td>${formatImpactEntry(row)}</td>
      <td>${impactReturnCell(row, 1)}</td>
      <td>${impactReturnCell(row, 2)}</td>
      <td>${impactReturnCell(row, 3)}</td>
      <td>${formatTradeSummary(row)}</td>
      <td>${validationTag(row)}</td>
    </tr>`).join("");
}

function renderRuns(rows) {
  const target = document.querySelector("#runRows");
  if (!rows.length) {
    target.innerHTML = emptyBlock("尚無執行紀錄");
    return;
  }
  target.innerHTML = `
    <div class="run-grid run-grid-head">
      <span>執行時間</span><span>觸發</span><span>狀態</span><span>資料日期</span><span>目標日</span><span>推薦數</span>
    </div>
    ${rows.map((run) => `
      <button class="run-grid run-row-button" type="button" data-run-id="${escapeHtml(run.run_id)}">
        <span>${formatDateTime(run.started_at)}</span>
        <span>${triggerLabel(run.trigger_type)}</span>
        <span>${statusLabel(run.status)}</span>
        <span>${formatDate(run.us_data_date)}</span>
        <span>${formatDate(run.target_tw_date)}</span>
        <span>${run.recommendation_count || 0}</span>
      </button>`).join("")}`;

  target.querySelectorAll("[data-run-id]").forEach((button) => {
    button.addEventListener("click", () => openRunDetail(button.dataset.runId));
  });
}

function renderScheduler(state) {
  if (STATIC_MODE) {
    const status = document.querySelector("#schedulerStatus");
    status.textContent = "GitHub Actions";
    status.classList.add("enabled");
    startSchedulerButton.disabled = false;
    stopSchedulerButton.disabled = false;
    return;
  }
  const enabled = Boolean(state.enabled);
  const status = document.querySelector("#schedulerStatus");
  status.textContent = enabled ? "已啟動" : "已關閉";
  status.classList.toggle("enabled", enabled);
  startSchedulerButton.disabled = enabled;
  stopSchedulerButton.disabled = !enabled;
}

async function openRunDetail(runId) {
  const detail = STATIC_MODE
    ? await fetchJson(`data/run_details/${encodeURIComponent(safeFileName(runId))}.json`)
    : await fetchJson(`/api/prediction-runs/${encodeURIComponent(runId)}`);
  document.querySelector("#drawerTitle").textContent = `執行明細 ${formatDateTime(detail.run.started_at)}`;
  document.querySelector("#drawerContent").innerHTML = `
    <div class="drawer-meta">
      <div><span>狀態</span><strong>${statusLabel(detail.run.status)}</strong></div>
      <div><span>訊息</span><strong>${escapeHtml(detail.run.message || "")}</strong></div>
      <div><span>推薦數</span><strong>${detail.predictions.length}</strong></div>
      <div><span>訊號數</span><strong>${detail.signals.length}</strong></div>
    </div>
    <h3>推薦明細</h3>
    <div class="table-wrap">
      <table>
        <thead><tr><th>台股</th><th>方向</th><th>信心</th><th>正式報酬</th><th>驗證</th><th>主要觸發條件</th></tr></thead>
        <tbody>${detail.predictions.map((row) => `
          <tr>
            <td>${escapeHtml(cleanTicker(row.tw_ticker))}</td>
            <td>${directionTag(displayDecision(row))}</td>
            <td>${formatNumber(row.confidence_score, 1)}</td>
            <td>${formatSignedPercent(row.actual_return)}</td>
            <td>${validationTag(row)}</td>
            <td>${escapeHtml(triggerSummary(row))}</td>
          </tr>`).join("")}</tbody>
      </table>
    </div>
    <h3>訊號來源</h3>
    ${detail.signals.slice(0, 30).map((signal) => `
      <div class="signal-row">
        <strong>${escapeHtml(cleanTicker(signal.tw_ticker))}</strong>
        <span>${escapeHtml(signal.us_ticker || "")}</span>
        <span>${escapeHtml(signal.trigger_text || "")}</span>
      </div>`).join("") || emptyBlock("沒有訊號資料")}
  `;
  document.querySelector("#detailDrawer").classList.add("open");
  document.querySelector("#detailDrawer").setAttribute("aria-hidden", "false");
  bindFloatingTooltips();
}

function closeDrawer() {
  document.querySelector("#detailDrawer").classList.remove("open");
  document.querySelector("#detailDrawer").setAttribute("aria-hidden", "true");
}

function returnCell(row, index) {
  const value = row[`t${index}_return`];
  const status = row[`t${index}_status`] || "待回填";
  const className = value === null || value === undefined
    ? "return-pending"
    : returnClass(value);
  const label = value === null || value === undefined ? shortStatus(status) : formatSignedPercent(value);
  return `
    <span class="return-cell ${className}">
      ${label}
      <span class="tooltip-source">
        <strong>T+${index}：${formatDate(row[`t${index}_date`])}</strong>
        <span>開盤價 <b>${formatPrice(row[`t${index}_open_price`])}</b></span>
        <span>收盤價 <b>${formatPrice(row[`t${index}_close_price`])}</b></span>
        <span>相對進場 <b>${formatSignedPercent(value)}</b></span>
        <span>相對大盤 <b>${formatSignedPercent(row[`t${index}_relative_market_return`])}</b></span>
        <span>資料狀態 <b>${escapeHtml(status)}</b></span>
      </span>
    </span>`;
}

function impactReturnCell(row, index) {
  const value = row[`impact_t${index}_return`] ?? row[`t${index}_return`];
  const status = row[`impact_t${index}_status`] || row[`t${index}_status`] || "待回填";
  const className = value === null || value === undefined ? "return-pending" : returnClass(value);
  const label = value === null || value === undefined ? shortStatus(status) : formatSignedPercent(value);
  return `
    <span class="return-cell ${className}">
      ${label}
      <span class="tooltip-source">
        <strong>T+${index} 影響：${formatDate(row[`impact_t${index}_date`] || row[`t${index}_date`])}</strong>
        <span>前日收盤 <b>${formatPrice(row.impact_entry_price ?? row.previous_close_price)}</b></span>
        <span>當日開盤 <b>${formatPrice(row[`impact_t${index}_open_price`] ?? row[`t${index}_open_price`])}</b></span>
        <span>當日收盤 <b>${formatPrice(row[`impact_t${index}_close_price`] ?? row[`t${index}_close_price`])}</b></span>
        <span>影響報酬 <b>${formatSignedPercent(value)}</b></span>
        <span>相對大盤 <b>${formatSignedPercent(row[`impact_t${index}_relative_market_return`])}</b></span>
        <span>資料狀態 <b>${escapeHtml(status)}</b></span>
      </span>
    </span>`;
}

function returnClass(value) {
  const number = Number(value);
  if (number > 0) return "return-up";
  if (number < 0) return "return-down";
  return "return-flat";
}

function formatImpactEntry(row) {
  return `${formatPrice(row.impact_entry_price ?? row.previous_close_price)}<br><span class="muted">前日收盤</span>`;
}

function formatTradeSummary(row) {
  const status = row.trade_validation_status || "觀察中";
  const tradeReturn = row.trade_best_3d_return ?? row.t1_return;
  return `
    <div class="trade-summary">
      <span>${formatPrice(row.entry_price)} <span class="muted">目標日開盤</span></span>
      <strong>${formatSignedPercent(tradeReturn)}</strong>
      ${tradeValidationTag(status)}
    </div>`;
}

function validationTag(row) {
  const status = row.validation_status || "尚未驗證";
  if (status === "命中") return `<span class="tag hit-tag">命中</span>`;
  if (status === "未命中") return `<span class="tag miss-tag">未命中</span>`;
  if (status === "不列入命中率") return `<span class="tag warn-tag">不列入命中率</span>`;
  if (status === "觀察中") return `<span class="tag pending-tag">觀察中</span>`;
  return `<span class="tag pending-tag">${escapeHtml(status)}</span>`;
}

function tradeValidationTag(status) {
  if (status === "命中") return `<span class="tag hit-tag">交易命中</span>`;
  if (status === "未命中") return `<span class="tag miss-tag">交易未命中</span>`;
  if (status === "不列入命中率") return `<span class="tag warn-tag">不列入</span>`;
  return `<span class="tag pending-tag">${escapeHtml(status || "觀察中")}</span>`;
}

function directionTag(direction) {
  if (direction === "看漲") return `<span class="tag up-tag">看漲</span>`;
  if (direction === "看跌") return `<span class="tag down-tag">看跌</span>`;
  return `<span class="tag mixed-tag">多空混合</span>`;
}

function displayDecision(row) {
  if (row.is_actionable === false) return "多空混合";
  const decision = row.beginner_decision || row.expected_direction || "多空混合";
  return ["看漲", "看跌"].includes(decision) ? decision : "多空混合";
}

function triggerSummary(row) {
  if (row.risk_warning) {
    return `${row.risk_warning}；${row.main_reason || ""}`;
  }
  return row.main_reason || "";
}

function isActionablePrediction(row) {
  return row.is_actionable !== false && ["看漲", "看跌"].includes(displayDecision(row));
}

function bindFloatingTooltips() {
  document.querySelectorAll(".return-cell").forEach((cell) => {
    if (cell.dataset.tooltipBound === "true") return;
    cell.dataset.tooltipBound = "true";
    cell.addEventListener("mouseenter", (event) => {
      const tooltip = cell.querySelector(".tooltip-source");
      if (!tooltip) return;
      floatingTooltip.innerHTML = tooltip.innerHTML;
      floatingTooltip.classList.add("visible");
      placeFloatingTooltip(event);
    });
    cell.addEventListener("mousemove", placeFloatingTooltip);
    cell.addEventListener("mouseleave", () => {
      floatingTooltip.classList.remove("visible");
    });
  });
}

function placeFloatingTooltip(event) {
  const margin = 14;
  const tooltipWidth = floatingTooltip.offsetWidth || 250;
  const tooltipHeight = floatingTooltip.offsetHeight || 140;
  let left = event.clientX + 16;
  let top = event.clientY + 16;

  if (left + tooltipWidth + margin > window.innerWidth) left = event.clientX - tooltipWidth - 16;
  if (top + tooltipHeight + margin > window.innerHeight) top = event.clientY - tooltipHeight - 16;
  if (left < margin) left = margin;
  if (top < margin) top = margin;

  floatingTooltip.style.left = `${left}px`;
  floatingTooltip.style.top = `${top}px`;
}

function groupByDate(rows) {
  return rows.reduce((groups, row) => {
    const date = formatDate(row.target_tw_date);
    groups[date] = groups[date] || [];
    groups[date].push(row);
    return groups;
  }, {});
}

function summarizeRows(rows) {
  const scored = rows.filter((row) => ["看漲", "看跌"].includes(displayDecision(row)) && row.is_correct !== null && row.is_correct !== undefined);
  const bestReturns = rows.map((row) => row.actual_return).filter((value) => value !== null && value !== undefined);
  return {
    bullish: rows.filter((row) => displayDecision(row) === "看漲").length,
    bearish: rows.filter((row) => displayDecision(row) === "看跌").length,
    mixed: rows.filter((row) => displayDecision(row) === "多空混合").length,
    pending: rows.filter((row) => ["觀察中", "待回填", null, undefined].includes(row.validation_status)).length,
    accuracy: scored.length ? scored.filter((row) => row.is_correct).length / scored.length : null,
    averageBestReturn: bestReturns.length ? bestReturns.reduce((sum, value) => sum + Number(value), 0) / bestReturns.length : null,
  };
}

function isBusinessDay(day, market) {
  return day.weekday >= 1 && day.weekday <= 5 && !holidays[market].has(day.isoDate);
}

function nextBusinessDay(day, market) {
  let cursor = day;
  while (!isBusinessDay(cursor, market)) cursor = addCalendarDays(cursor, 1);
  return cursor;
}

function atTime(day, hour, minute) {
  return { ...day, hour, minute, second: 0 };
}

function formatDuration(ms) {
  if (ms <= 0) return "00:00:00";
  const total = Math.floor(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
}

function statusClass(kind) {
  return {
    live: ["tag hit-tag", "status-dot live", "#12b76a"],
    pre: ["tag up-tag", "status-dot pre", "#0ea5e9"],
    after: ["tag mixed-tag", "status-dot", "#8b5cf6"],
    closed: ["tag pending-tag", "status-dot", "#98a2b3"],
    holiday: ["tag warn-tag", "status-dot", "#f59e0b"]
  }[kind] || ["tag pending-tag", "status-dot", "#98a2b3"];
}

function getTwState(now) {
  const today = startOfZonedDay(now);
  const open = atTime(today, 9, 0);
  const close = atTime(today, 13, 30);
  const nowMinutes = minutesOfDay(now);
  if (!isBusinessDay(today, "tw")) {
    return { now, kind: "holiday", label: "週末/假日休市", nextEvent: "下一次開盤", target: atTime(nextBusinessDay(addCalendarDays(today, 1), "tw"), 9, 0), hint: "今日休市，可查看歷史預測或回填驗證。", timeZone: "Asia/Taipei" };
  }
  if (nowMinutes < minutesOfDay(open)) return { now, kind: "pre", label: "盤前", nextEvent: "距離開盤", target: open, hint: "適合執行台股開盤前預測。", timeZone: "Asia/Taipei" };
  if (nowMinutes < minutesOfDay(close)) return { now, kind: "live", label: "交易中", nextEvent: "距離收盤", target: close, hint: "股價仍在變動，驗證結果尚未定案。", timeZone: "Asia/Taipei" };
  return { now, kind: "closed", label: "已收盤", nextEvent: "下一次開盤", target: atTime(nextBusinessDay(addCalendarDays(today, 1), "tw"), 9, 0), hint: "可更新實際股價並回填今日驗證。", timeZone: "Asia/Taipei" };
}

function getUsState(now) {
  const today = startOfZonedDay(now);
  const preOpen = atTime(today, 4, 0);
  const regularOpen = atTime(today, 9, 30);
  const regularClose = atTime(today, 16, 0);
  const afterClose = atTime(today, 20, 0);
  const nowMinutes = minutesOfDay(now);
  if (!isBusinessDay(today, "us")) {
    return { now, kind: "holiday", label: "週末/假日休市", nextEvent: "下一次盤前", target: atTime(nextBusinessDay(addCalendarDays(today, 1), "us"), 4, 0), hint: "美股休市，不會有新的美股收盤資料。", timeZone: "America/New_York" };
  }
  if (nowMinutes < minutesOfDay(preOpen)) return { now, kind: "closed", label: "已收盤", nextEvent: "距離盤前交易", target: preOpen, hint: "尚未進入盤前，通常使用上一個交易日資料。", timeZone: "America/New_York" };
  if (nowMinutes < minutesOfDay(regularOpen)) return { now, kind: "pre", label: "盤前交易", nextEvent: "距離正規開盤", target: regularOpen, hint: "盤前價格波動中，正式模型仍以已收盤資料為主。", timeZone: "America/New_York" };
  if (nowMinutes < minutesOfDay(regularClose)) return { now, kind: "live", label: "正規交易中", nextEvent: "距離正規收盤", target: regularClose, hint: "美股尚未收盤，今晚資料還不能當作完整收盤訊號。", timeZone: "America/New_York" };
  if (nowMinutes < minutesOfDay(afterClose)) return { now, kind: "after", label: "盤後交易", nextEvent: "距離盤後結束", target: afterClose, hint: "正規收盤價已出現，可等待資料源更新。", timeZone: "America/New_York" };
  return { now, kind: "closed", label: "已收盤", nextEvent: "下一次盤前", target: atTime(nextBusinessDay(addCalendarDays(today, 1), "us"), 4, 0), hint: "美股本日交易結束，等待資料源完成更新。", timeZone: "America/New_York" };
}

function setMarket(prefix, result) {
  const [tagClass, dotClass, color] = statusClass(result.kind);
  const status = document.querySelector(`#${prefix}Status`);
  const dot = document.querySelector(`#${prefix}Dot`);
  status.className = tagClass;
  status.textContent = result.label;
  dot.className = dotClass;
  dot.style.background = color;
  document.querySelector(`#${prefix}NextEvent`).textContent = result.nextEvent;
  document.querySelector(`#${prefix}Countdown`).textContent = formatDuration(zonedTimeToDate(result.target, result.timeZone).getTime() - Date.now());
  document.querySelector(`#${prefix}Hint`).textContent = result.hint;
}

function refreshMarketClock() {
  const twNow = zonedNow("Asia/Taipei");
  const usNow = zonedNow("America/New_York");
  document.querySelector("#twLocalTime").textContent = `台北時間 ${formatZonedDateTime(twNow)}`;
  document.querySelector("#usLocalTime").textContent = `美東時間 ${formatZonedDateTime(usNow)} ${timeZoneName("America/New_York")}`;
  setMarket("tw", getTwState(twNow));
  setMarket("us", getUsState(usNow));
}

function zonedNow(timeZone) {
  return { ...zonedParts(new Date(), timeZone), timeZone };
}

function zonedParts(date, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    weekday: "short"
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  const hour = Number(parts.hour === "24" ? "0" : parts.hour);
  const weekdayMap = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  return {
    year,
    month,
    day,
    hour,
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: weekdayMap[parts.weekday],
    isoDate: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
  };
}

function startOfZonedDay(day) {
  return { ...day, hour: 0, minute: 0, second: 0 };
}

function addCalendarDays(day, amount) {
  const next = new Date(Date.UTC(day.year, day.month - 1, day.day + amount, 12, 0, 0));
  const parts = zonedParts(next, "UTC");
  return { ...day, year: parts.year, month: parts.month, day: parts.day, weekday: parts.weekday, isoDate: parts.isoDate };
}

function minutesOfDay(day) {
  return day.hour * 60 + day.minute + day.second / 60;
}

function zonedTimeToDate(day, timeZone) {
  let guess = new Date(Date.UTC(day.year, day.month - 1, day.day, day.hour, day.minute, day.second || 0));
  for (let i = 0; i < 3; i += 1) {
    const actual = zonedParts(guess, timeZone);
    const desiredUtc = Date.UTC(day.year, day.month - 1, day.day, day.hour, day.minute, day.second || 0);
    const actualUtc = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second || 0);
    guess = new Date(guess.getTime() + desiredUtc - actualUtc);
  }
  return guess;
}

function formatZonedDateTime(day) {
  return `${day.isoDate} ${String(day.hour).padStart(2, "0")}:${String(day.minute).padStart(2, "0")}:${String(day.second).padStart(2, "0")}`;
}

function timeZoneName(timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "short" }).formatToParts(new Date());
  return parts.find((part) => part.type === "timeZoneName")?.value || "";
}

function triggerLabel(value) {
  if (value === "scheduled") return "排程";
  if (value === "backfill") return "回填";
  return "手動";
}

function statusLabel(value) {
  if (value === "success") return "成功";
  if (value === "running") return "執行中";
  if (value === "failed") return "失敗";
  return value || "未知";
}

function shortStatus(value) {
  if (value === "已取得") return "已取得";
  if (value === "尚未收盤") return "待收盤";
  if (value === "缺少目標日開盤價") return "缺開盤";
  if (value === "缺少前一交易日收盤價") return "缺前收";
  return "待回填";
}

function cleanTicker(value) {
  return String(value || "").replace(".TW", "");
}

function formatPercent(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "--";
  return `${(Number(value) * 100).toFixed(1)}%`;
}

function formatSignedPercent(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "--";
  const number = Number(value) * 100;
  return `${number >= 0 ? "+" : ""}${number.toFixed(1)}%`;
}

function formatNumber(value, digits) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "--";
  return Number(value).toFixed(digits);
}

function formatPrice(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "尚未取得";
  return Number(value).toLocaleString("zh-TW", { maximumFractionDigits: 2 });
}

function formatDate(value) {
  if (!value) return "尚無資料";
  return String(value).slice(0, 10);
}

function formatDateTime(value) {
  if (!value) return "尚無資料";
  return String(value).replace("T", " ").slice(0, 19);
}

function setText(selector, value) {
  document.querySelector(selector).textContent = value;
}

function emptyBlock(text) {
  return `<div class="empty">${escapeHtml(text)}</div>`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function safeFileName(value) {
  return String(value || "").replace(/[^A-Za-z0-9_-]/g, "_");
}

refreshMarketClock();
setInterval(refreshMarketClock, 1000);
refreshDashboard().catch((error) => {
  runStatus.textContent = "讀取失敗";
  console.error(error);
});
