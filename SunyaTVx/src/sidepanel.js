// SunyaTVx Side Panel — Main Logic
// Institutional chart analysis with AI-powered annotations

(function () {
  'use strict';

  // ─── State ─────────────────────────────────────────────────────────────────
  const state = {
    symbol: null,
    chartData: null,
    trend: null,
    levels: [],
    analysisRunning: false,
    settings: {
      autoAnalyze: true,
      showFib: false,
      showTargets: true,
      showWatermark: true,
      showZones: true
    },
    chatHistory: [],
    groqApiKey: '',
    groqModel: 'llama-3.3-70b-versatile'
  };

  // ─── Utilities ─────────────────────────────────────────────────────────────
  const $ = (id) => document.getElementById(id);
  const formatPrice = (p) => {
    if (!p || isNaN(p)) return '—';
    if (p >= 10000) return p.toLocaleString('en-US', { maximumFractionDigits: 0 });
    if (p >= 100) return p.toFixed(2);
    if (p >= 1) return p.toFixed(4);
    return p.toFixed(6);
  };

  // ─── Settings ──────────────────────────────────────────────────────────────
  function loadSettings() {
    chrome.storage.local.get(['sunyaSettings', 'groqApiKey', 'groqModel'], (res) => {
      if (res.sunyaSettings) Object.assign(state.settings, res.sunyaSettings);
      if (res.groqApiKey) state.groqApiKey = res.groqApiKey;
      if (res.groqModel) state.groqModel = res.groqModel;
      renderSettingToggles();
      renderGroqSettings();
    });
  }

  function saveSettings() {
    chrome.storage.local.set({ sunyaSettings: state.settings });
  }

  function renderSettingToggles() {
    Object.entries(state.settings).forEach(([key, val]) => {
      const tog = document.querySelector(`[data-setting="${key}"]`);
      if (tog) tog.classList.toggle('on', val);
    });
  }

  function renderGroqSettings() {
    const keyInput = $('groq-api-key');
    const modelSelect = $('groq-model');
    if (keyInput && state.groqApiKey) keyInput.value = state.groqApiKey;
    if (modelSelect && state.groqModel) modelSelect.value = state.groqModel;
    updateApiConnStatus();
  }

  function updateApiConnStatus() {
    const el = $('api-conn-status');
    if (!el) return;
    if (state.groqApiKey) {
      el.textContent = '\u{1F7E2} Connected';
      el.style.color = 'var(--bull)';
    } else {
      el.textContent = '\u26AA Not configured';
      el.style.color = 'var(--muted)';
    }
  }

  // ── Groq API Helper ─────────────────────────────────────────────────────
  async function callGroqAPI(messages, maxTokens = 500) {
    if (!state.groqApiKey) {
      throw new Error('API key not configured. Go to Config tab to set your Groq API key.');
    }
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.groqApiKey}`
      },
      body: JSON.stringify({
        model: state.groqModel,
        messages,
        max_tokens: maxTokens,
        temperature: 0.7
      })
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || `Groq API error: ${response.status}`);
    }
    const data = await response.json();
    return data.choices?.[0]?.message?.content || 'No response generated.';
  }

  // ─── Tabs ──────────────────────────────────────────────────────────────────
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;
      document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach((c) => c.classList.remove('active'));
      tab.classList.add('active');
      $(`tab-${target}`).classList.add('active');
    });
  });

  // ─── Toggles ───────────────────────────────────────────────────────────────
  document.querySelectorAll('.toggle').forEach((tog) => {
    tog.addEventListener('click', () => {
      const key = tog.dataset.setting;
      state.settings[key] = !state.settings[key];
      tog.classList.toggle('on', state.settings[key]);
      saveSettings();
    });
  });

  // ─── Symbol Detection ──────────────────────────────────────────────────────
  function updateSymbolDisplay(symbol, chartData) {
    state.symbol = symbol;
    state.chartData = chartData;

    const dot = $('sym-dot');
    const name = $('sym-name');
    const tf = $('sym-tf');

    if (symbol && symbol !== 'UNKNOWN') {
      dot.classList.add('active');
      dot.classList.remove('loading');
      name.textContent = symbol;
      tf.textContent = chartData?.timeframe || '—';
      $('analysis-loading').style.display = 'none';
      $('analysis-content').style.display = 'flex';

      // Auto-analyze if setting enabled
      if (state.settings.autoAnalyze && !state.analysisRunning) {
        setTimeout(() => runAnalysis('sr'), 800);
      }
    } else {
      dot.classList.remove('active');
      name.textContent = 'Waiting for chart...';
    }
  }

  // ─── Listen for symbol updates from background ─────────────────────────────
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'SYMBOL_UPDATE') {
      updateSymbolDisplay(msg.symbol, msg.chartData);
    }
  });

  // ─── Fetch initial data ────────────────────────────────────────────────────
  function fetchChartData() {
    $('sym-dot').classList.add('loading');
    chrome.runtime.sendMessage({ type: 'GET_CHART_DATA' }, (res) => {
      if (res && res.symbol) {
        updateSymbolDisplay(res.symbol, res);
      } else {
        setTimeout(fetchChartData, 3000);
      }
    });
  }

  // ─── Technical Analysis Engine ─────────────────────────────────────────────
  function computeTechnicals(bars) {
    if (!bars || bars.length < 10) return null;

    const closes = bars.map((b) => b.close).filter(Boolean);
    const highs = bars.map((b) => b.high).filter(Boolean);
    const lows = bars.map((b) => b.low).filter(Boolean);

    if (!closes.length) return null;

    const currentPrice = closes[closes.length - 1];
    const priceMin = Math.min(...lows);
    const priceMax = Math.max(...highs);

    // EMA calculation
    const ema = (data, period) => {
      const k = 2 / (period + 1);
      let emaVal = data[0];
      for (let i = 1; i < data.length; i++) {
        emaVal = data[i] * k + emaVal * (1 - k);
      }
      return emaVal;
    };

    const ema20 = ema(closes, 20);
    const ema50 = ema(closes, Math.min(50, closes.length));

    // RSI
    const rsiPeriod = 14;
    let gains = 0, losses = 0;
    const rsiData = closes.slice(-rsiPeriod - 1);
    for (let i = 1; i < rsiData.length; i++) {
      const diff = rsiData[i] - rsiData[i - 1];
      if (diff >= 0) gains += diff;
      else losses -= diff;
    }
    const avgGain = gains / rsiPeriod;
    const avgLoss = losses / rsiPeriod;
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    const rsi = 100 - 100 / (1 + rs);

    // MACD
    const ema12 = ema(closes, 12);
    const ema26 = ema(closes, Math.min(26, closes.length));
    const macdLine = ema12 - ema26;

    // ATR (Average True Range)
    let atrSum = 0;
    const atrPeriod = Math.min(14, bars.length - 1);
    for (let i = bars.length - atrPeriod; i < bars.length; i++) {
      const tr = Math.max(
        bars[i].high - bars[i].low,
        Math.abs(bars[i].high - bars[i - 1]?.close || bars[i].close),
        Math.abs(bars[i].low - bars[i - 1]?.close || bars[i].close)
      );
      atrSum += tr;
    }
    const atr = atrSum / atrPeriod;

    // Trend determination
    const trendStrength = ((currentPrice - ema50) / ema50) * 100;
    let trend, momentum;
    if (currentPrice > ema20 && ema20 > ema50 && rsi > 50) {
      trend = 'BULLISH';
      momentum = rsi > 65 ? 'STRONG' : 'MODERATE';
    } else if (currentPrice < ema20 && ema20 < ema50 && rsi < 50) {
      trend = 'BEARISH';
      momentum = rsi < 35 ? 'STRONG' : 'MODERATE';
    } else {
      trend = 'SIDEWAYS';
      momentum = 'WEAK';
    }

    // Support & Resistance levels (institutional method)
    const levels = computeSRLevels(highs, lows, closes, currentPrice, atr);

    // Fibonacci
    const recentHigh = Math.max(...highs.slice(-20));
    const recentLow = Math.min(...lows.slice(-20));
    const fibDirection = closes[closes.length - 1] > closes[closes.length - 10] ? 'up' : 'down';

    return {
      currentPrice,
      priceMin,
      priceMax,
      ema20,
      ema50,
      rsi: rsi.toFixed(1),
      macd: macdLine.toFixed(4),
      atr,
      trend,
      momentum,
      trendStrength: trendStrength.toFixed(2),
      levels,
      fibonacci: { high: recentHigh, low: recentLow, direction: fibDirection }
    };
  }

  function computeSRLevels(highs, lows, closes, currentPrice, atr) {
    const levels = [];
    const tolerance = atr * 0.5;

    // Method 1: Swing Highs/Lows
    const swingWindow = 3;
    for (let i = swingWindow; i < highs.length - swingWindow; i++) {
      const h = highs[i];
      const isSwingHigh = highs.slice(i - swingWindow, i).every((v) => v < h) &&
                          highs.slice(i + 1, i + swingWindow + 1).every((v) => v < h);
      if (isSwingHigh) {
        const existing = levels.find((l) => Math.abs(l.price - h) < tolerance);
        if (existing) {
          existing.touches++;
          existing.strength = existing.touches >= 3 ? 'strong' : 'moderate';
        } else {
          levels.push({
            price: h,
            type: h > currentPrice ? 'resistance' : 'support',
            strength: 'moderate',
            touches: 1,
            label: 'Swing',
            zone: { high: h + tolerance * 0.4, low: h - tolerance * 0.4 }
          });
        }
      }

      const l = lows[i];
      const isSwingLow = lows.slice(i - swingWindow, i).every((v) => v > l) &&
                         lows.slice(i + 1, i + swingWindow + 1).every((v) => v > l);
      if (isSwingLow) {
        const existing = levels.find((lv) => Math.abs(lv.price - l) < tolerance);
        if (existing) {
          existing.touches++;
          existing.strength = existing.touches >= 3 ? 'strong' : 'moderate';
        } else {
          levels.push({
            price: l,
            type: l < currentPrice ? 'support' : 'resistance',
            strength: 'moderate',
            touches: 1,
            label: 'Swing',
            zone: { high: l + tolerance * 0.4, low: l - tolerance * 0.4 }
          });
        }
      }
    }

    // Method 2: Round number levels (psychological)
    const roundLevels = computeRoundLevels(currentPrice, atr);
    roundLevels.forEach((rl) => {
      const existing = levels.find((l) => Math.abs(l.price - rl) < tolerance * 0.5);
      if (!existing) {
        levels.push({
          price: rl,
          type: rl > currentPrice ? 'resistance' : 'support',
          strength: 'moderate',
          touches: 1,
          label: 'Round',
          zone: null
        });
      } else {
        existing.strength = 'strong';
        existing.label = existing.label === 'Round' ? 'Round' : existing.label + '+R';
      }
    });

    // Sort by distance from current price
    levels.sort((a, b) => Math.abs(a.price - currentPrice) - Math.abs(b.price - currentPrice));

    return levels.slice(0, 12); // Top 12 most relevant
  }

  function computeRoundLevels(price, atr) {
    const levels = [];
    // Find magnitude
    const magnitude = Math.pow(10, Math.floor(Math.log10(price)));
    const step = magnitude >= 1000 ? magnitude / 10 :
                 magnitude >= 100 ? magnitude / 10 :
                 magnitude >= 10 ? magnitude / 10 : magnitude;

    const base = Math.round(price / step) * step;
    for (let i = -3; i <= 3; i++) {
      const lvl = base + i * step;
      if (Math.abs(lvl - price) > atr * 0.3 && Math.abs(lvl - price) < atr * 8) {
        levels.push(lvl);
      }
    }
    return levels;
  }

  // ─── Run Analysis ──────────────────────────────────────────────────────────
  async function runAnalysis(type) {
    if (state.analysisRunning) return;
    state.analysisRunning = true;

    // Visual feedback on button
    const btn = document.querySelector(`[data-analysis="${type}"]`);
    if (btn) btn.classList.add('active');

    // Get fresh chart data
    chrome.runtime.sendMessage({ type: 'GET_CHART_DATA' }, async (chartData) => {
      if (!chartData || !chartData.priceData) {
        state.analysisRunning = false;
        if (btn) btn.classList.remove('active');
        return;
      }

      state.chartData = chartData;
      const bars = chartData.priceData.bars;
      const currentPrice = chartData.priceData.currentPrice;
      const techs = computeTechnicals(bars);

      if (!techs) {
        state.analysisRunning = false;
        if (btn) btn.classList.remove('active');
        return;
      }

      state.trend = techs.trend;
      state.levels = techs.levels;

      // Update UI
      updateMetricsUI(techs, chartData.symbol, currentPrice);

      // Build annotation payload
      const payload = buildAnnotationPayload(type, techs, currentPrice);

      // Draw on chart
      chrome.runtime.sendMessage({ type: 'DRAW_ANNOTATION', payload }, () => {
        state.analysisRunning = false;
        if (btn) btn.classList.remove('active');
      });

      // Generate AI summary
      if (type === 'sr' || type === 'trend') {
        generateAISummary(techs, chartData.symbol, currentPrice);
      }

      // Update levels tab
      updateLevelsTab(techs.levels, currentPrice);
    });
  }

  function buildAnnotationPayload(type, techs, currentPrice) {
    const payload = {
      type,
      priceRange: {
        min: techs.priceMin * 0.995,
        max: techs.priceMax * 1.005
      },
      trend: techs.trend,
      watermark: state.settings.showWatermark ? techs.trend : null,
      levels: [],
      fibonacci: null,
      trendLine: null,
      targets: []
    };

    if (type === 'sr' || type === 'targets') {
      payload.levels = techs.levels.map((l) => ({
        ...l,
        zone: state.settings.showZones ? l.zone : null
      }));
    }

    if (type === 'fibonacci' || (type === 'sr' && state.settings.showFib)) {
      payload.fibonacci = techs.fibonacci;
    }

    if (type === 'trend') {
      // Trend line from earliest to latest visible point
      payload.trendLine = {
        startX: 0.05,
        endX: 0.95,
        startPrice: techs.ema50,
        endPrice: techs.trend === 'BULLISH'
          ? techs.ema50 * 1.02
          : techs.trend === 'BEARISH'
            ? techs.ema50 * 0.98
            : techs.ema50,
        direction: techs.trend === 'BULLISH' ? 'up' : 'down'
      };
      payload.levels = techs.levels.slice(0, 4);
    }

    if (type === 'targets' && state.settings.showTargets) {
      const nearestSup = techs.levels.find((l) => l.type === 'support' && l.price < currentPrice);
      const nearestRes = techs.levels.find((l) => l.type === 'resistance' && l.price > currentPrice);
      const atr = techs.atr;

      if (techs.trend === 'BULLISH' && nearestRes) {
        payload.targets = [
          { type: 'entry', price: currentPrice, label: '▶ Entry' },
          { type: 'tp', price: nearestRes.price, label: 'TP1' },
          { type: 'tp', price: nearestRes.price * 1.005, label: 'TP2' },
          { type: 'sl', price: currentPrice - atr * 1.5, label: 'SL' }
        ];
      } else if (techs.trend === 'BEARISH' && nearestSup) {
        payload.targets = [
          { type: 'entry', price: currentPrice, label: '▶ Entry' },
          { type: 'tp', price: nearestSup.price, label: 'TP1' },
          { type: 'tp', price: nearestSup.price * 0.995, label: 'TP2' },
          { type: 'sl', price: currentPrice + atr * 1.5, label: 'SL' }
        ];
      }
    }

    return payload;
  }

  // ─── Update UI ─────────────────────────────────────────────────────────────
  function updateMetricsUI(techs, symbol, currentPrice) {
    // Symbol display
    if (symbol) {
      $('sym-name').textContent = symbol;
      state.symbol = symbol;
    }
    $('snap-time').textContent = new Date().toLocaleTimeString();

    // Trend badge
    const badge = $('trend-badge');
    badge.style.display = 'block';
    badge.textContent = techs.trend;
    badge.className = 'trend-badge ' +
      (techs.trend === 'BULLISH' ? 'trend-bull' : techs.trend === 'BEARISH' ? 'trend-bear' : 'trend-neutral');

    // Metrics
    const trendEl = $('m-trend');
    trendEl.textContent = techs.trend;
    trendEl.className = 'metric-value ' + (techs.trend === 'BULLISH' ? 'bull' : techs.trend === 'BEARISH' ? 'bear' : 'neutral');
    $('m-trend-sub').textContent = `EMA: ${formatPrice(techs.ema20)}`;

    $('m-mom').textContent = techs.momentum;
    $('m-mom').className = 'metric-value ' + (techs.rsi > 60 ? 'bull' : techs.rsi < 40 ? 'bear' : 'neutral');
    $('m-mom-sub').textContent = `RSI: ${techs.rsi}`;

    const supLevel = techs.levels.find((l) => l.type === 'support' && l.price < currentPrice);
    const resLevel = techs.levels.find((l) => l.type === 'resistance' && l.price > currentPrice);

    $('m-sup').textContent = supLevel ? formatPrice(supLevel.price) : '—';
    $('m-sup-sub').textContent = supLevel ? supLevel.strength : '';
    $('m-res').textContent = resLevel ? formatPrice(resLevel.price) : '—';
    $('m-res-sub').textContent = resLevel ? resLevel.strength : '';
  }

  function updateLevelsTab(levels, currentPrice) {
    if (!levels || levels.length === 0) return;

    $('levels-empty').style.display = 'none';
    const container = $('levels-content');
    container.style.display = 'flex';
    container.innerHTML = '';

    // Group header
    const supports = levels.filter((l) => l.type === 'support');
    const resistances = levels.filter((l) => l.type === 'resistance');

    if (resistances.length) {
      const card = createLevelCard('Resistance Levels', resistances, currentPrice, 'res');
      container.appendChild(card);
    }
    if (supports.length) {
      const card = createLevelCard('Support Levels', supports, currentPrice, 'sup');
      container.appendChild(card);
    }
  }

  function createLevelCard(title, levels, currentPrice, type) {
    const card = document.createElement('div');
    card.className = 'card';

    const header = document.createElement('div');
    header.className = 'card-header';
    header.innerHTML = `<div class="card-title"><span class="dot"></span>${title}</div><span style="font-size:9px;color:var(--muted);font-family:var(--font-mono);">${levels.length} levels</span>`;
    card.appendChild(header);

    const body = document.createElement('div');
    body.className = 'card-body';
    const list = document.createElement('div');
    list.className = 'level-list';

    levels.forEach((l) => {
      const dist = ((Math.abs(l.price - currentPrice) / currentPrice) * 100).toFixed(2);
      const item = document.createElement('div');
      item.className = 'level-item';
      item.innerHTML = `
        <span class="level-pill pill-${type}">${type.toUpperCase()}</span>
        <span class="level-price" style="color:${type === 'sup' ? 'var(--bull)' : 'var(--bear)'}">${formatPrice(l.price)}</span>
        <span class="level-strength">${l.strength}</span>
        <span class="level-touches" title="Distance">${dist}%</span>
      `;
      item.title = `Click to highlight this level`;
      list.appendChild(item);
    });

    body.appendChild(list);
    card.appendChild(body);
    return card;
  }

  // ─── AI Summary (using Groq API) ────────────────────────────────────────
  async function generateAISummary(techs, symbol, currentPrice) {
    $('ai-summary-text').innerHTML = '<span style="color:var(--muted)">Generating AI analysis...</span>';

    const userPrompt = `Analyze this market data and provide a concise professional summary (3-4 sentences max):

Symbol: ${symbol || 'Unknown'}
Current Price: ${formatPrice(currentPrice)}
Trend: ${techs.trend} (EMA20: ${formatPrice(techs.ema20)}, EMA50: ${formatPrice(techs.ema50)})
RSI: ${techs.rsi}
MACD: ${techs.macd}
Momentum: ${techs.momentum}
Nearest Support: ${formatPrice(techs.levels.find(l => l.type === 'support')?.price)}
Nearest Resistance: ${formatPrice(techs.levels.find(l => l.type === 'resistance')?.price)}

Provide a brief institutional analysis: current market structure, key level to watch, and bias (bullish/bearish/neutral). Be direct and specific. No disclaimers.`;

    try {
      const text = await callGroqAPI([
        { role: 'system', content: 'You are an institutional-grade technical analyst. Be concise, direct, and specific. Reference exact price levels.' },
        { role: 'user', content: userPrompt }
      ], 300);
      $('ai-summary-text').innerHTML = formatAnalysisText(text, techs.trend);
    } catch (e) {
      // Fallback local summary
      $('ai-summary-text').innerHTML = generateLocalSummary(techs, symbol, currentPrice);
    }
  }

  function formatAnalysisText(text, trend) {
    return text
      .replace(/bullish/gi, '<span class="bull-text">bullish</span>')
      .replace(/bearish/gi, '<span class="bear-text">bearish</span>')
      .replace(/BULLISH/g, '<span class="bull-text">BULLISH</span>')
      .replace(/BEARISH/g, '<span class="bear-text">BEARISH</span>');
  }

  function generateLocalSummary(techs, symbol, currentPrice) {
    const sup = techs.levels.find((l) => l.type === 'support');
    const res = techs.levels.find((l) => l.type === 'resistance');
    const trendClass = techs.trend === 'BULLISH' ? 'bull-text' : techs.trend === 'BEARISH' ? 'bear-text' : '';

    return `<strong>${symbol}</strong> is exhibiting a <span class="${trendClass}">${techs.trend}</span> market structure with price trading at ${formatPrice(currentPrice)}. 
    EMA alignment (20: ${formatPrice(techs.ema20)} / 50: ${formatPrice(techs.ema50)}) confirms the current bias with RSI at ${techs.rsi}.
    ${sup ? `Key support is located at <strong class="bull-text">${formatPrice(sup.price)}</strong>` : ''}${res ? ` with resistance at <strong class="bear-text">${formatPrice(res.price)}</strong>` : ''}.
    Momentum is <strong>${techs.momentum}</strong> — ${techs.trend === 'BULLISH' ? 'watch for continuation above resistance for targets higher' : techs.trend === 'BEARISH' ? 'monitor breakdown below support for continuation lower' : 'range-bound conditions suggest waiting for breakout confirmation'}.`;
  }

  // ─── Chat System ───────────────────────────────────────────────────────────
  const FINANCIAL_KEYWORDS = [
    'price', 'support', 'resistance', 'trend', 'buy', 'sell', 'bullish', 'bearish',
    'entry', 'exit', 'target', 'stop', 'loss', 'profit', 'chart', 'candle', 'ema', 'ma',
    'rsi', 'macd', 'fibonacci', 'fib', 'breakout', 'breakdown', 'volume', 'momentum',
    'indicator', 'pattern', 'analysis', 'market', 'trade', 'trading', 'crypto', 'forex',
    'stock', 'level', 'zone', 'pivot', 'high', 'low', 'close', 'open', 'consolidation',
    'reversal', 'continuation', 'signal', 'setup', 'risk', 'reward', 'ratio', 'position',
    'long', 'short', 'technical', 'fundamental', 'wave', 'elliott', 'bollinger', 'stoch',
    'atr', 'liquidity', 'institutional', 'swing', 'scalp', 'day', 'weekly', 'monthly',
    'timeframe', 'bias', 'confluence', 'supply', 'demand', 'accumulation', 'distribution'
  ];

  function isFinancialQuestion(text) {
    const lower = text.toLowerCase();
    return FINANCIAL_KEYWORDS.some((kw) => lower.includes(kw));
  }

  function addChatMessage(role, text) {
    const msgs = $('chat-messages');
    const msg = document.createElement('div');
    msg.className = `chat-msg ${role}`;

    if (role === 'ai') {
      msg.innerHTML = `<div class="msg-label">SunyaTVx AI</div>${formatAnalysisText(text, state.trend)}`;
    } else if (role === 'user') {
      msg.textContent = text;
    } else {
      msg.textContent = text;
    }

    msgs.appendChild(msg);
    msgs.scrollTop = msgs.scrollHeight;
    return msg;
  }

  async function sendChatMessage(text) {
    if (!text.trim()) return;

    // Filter non-financial questions
    if (!isFinancialQuestion(text)) {
      addChatMessage('error', '⚠ I only answer financial and technical analysis questions related to the chart. Please ask about price levels, trends, indicators, or trading setups.');
      return;
    }

    addChatMessage('user', text);
    state.chatHistory.push({ role: 'user', content: text });

    const sendBtn = $('send-btn');
    sendBtn.disabled = true;
    const loadingMsg = addChatMessage('ai', '⋯ Analyzing...');

    // Build context from current chart state
    const chartContext = state.chartData ? `
Current Symbol: ${state.chartData.symbol || state.symbol || 'Unknown'}
Current Price: ${formatPrice(state.chartData.priceData?.currentPrice)}
Trend: ${state.trend || 'Unknown'}
Timeframe: ${state.chartData.timeframe || 'Unknown'}
Key Levels: ${state.levels.slice(0, 6).map(l => `${l.type} @ ${formatPrice(l.price)}`).join(', ')}
` : `Symbol: ${state.symbol || 'Unknown'} (no live data)`;

    const systemPrompt = `You are SunyaTVx, an institutional-grade technical analysis AI assistant embedded in a TradingView Chrome extension. 

You ONLY answer questions related to:
- Technical analysis (support/resistance, trends, indicators)
- Chart patterns and price action
- Trading setups (entry, TP, SL)
- Market structure analysis
- Cryptocurrency, forex, stocks technical analysis

You REFUSE to answer anything unrelated to financial/technical analysis.

Keep responses concise and specific (2-4 sentences max unless detail is needed).
Always reference specific price levels when available.

Current Chart Context:
${chartContext}`;

    try {
      const messages = [
        { role: 'system', content: systemPrompt },
        ...state.chatHistory.slice(-6)
      ];

      const aiText = await callGroqAPI(messages, 500);

      if (aiText) {
        loadingMsg.innerHTML = `<div class="msg-label">SunyaTVx AI</div>${formatAnalysisText(aiText, state.trend)}`;
        state.chatHistory.push({ role: 'assistant', content: aiText });

        // Auto-draw if response mentions specific actions
        const lower = aiText.toLowerCase();
        if (lower.includes('support') && lower.includes('resistance')) {
          setTimeout(() => runAnalysis('sr'), 500);
        } else if (lower.includes('fibonacci') || lower.includes('retracement')) {
          setTimeout(() => runAnalysis('fibonacci'), 500);
        } else if (lower.includes('trade setup') || lower.includes('entry') || lower.includes('stop loss')) {
          setTimeout(() => runAnalysis('targets'), 500);
        }
      } else {
        loadingMsg.innerHTML = `<div class="msg-label">SunyaTVx AI</div>Unable to generate analysis. Please try again.`;
      }
    } catch (e) {
      const errorMsg = e.message.includes('API key') 
        ? `<div class="msg-label">SunyaTVx AI</div>⚠ ${e.message}`
        : `<div class="msg-label">SunyaTVx AI</div>Analysis engine error. Using local analysis...`;
      loadingMsg.innerHTML = errorMsg;
      // Fallback: trigger local analysis if not an API key issue
      if (!e.message.includes('API key') && state.chartData) {
        const bars = state.chartData.priceData?.bars;
        const techs = computeTechnicals(bars);
        if (techs) {
          const localResponse = generateLocalSummary(techs, state.symbol, state.chartData.priceData?.currentPrice);
          loadingMsg.innerHTML = `<div class="msg-label">SunyaTVx AI (local)</div>${localResponse}`;
        }
      }
    }

    sendBtn.disabled = false;
  }

  // ─── Event Listeners ───────────────────────────────────────────────────────
  // Quick analysis buttons
  document.querySelectorAll('[data-analysis]').forEach((btn) => {
    btn.addEventListener('click', () => runAnalysis(btn.dataset.analysis));
  });

  // Chat send
  $('send-btn').addEventListener('click', () => {
    const input = $('chat-input');
    sendChatMessage(input.value);
    input.value = '';
    input.style.height = 'auto';
  });

  $('chat-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      $('send-btn').click();
    }
  });

  $('chat-input').addEventListener('input', function () {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 80) + 'px';
  });

  // Suggestion chips
  document.querySelectorAll('.chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const q = chip.dataset.q;
      $('chat-input').value = q;
      // Switch to chat tab
      document.querySelector('[data-tab="chat"]').click();
      setTimeout(() => $('send-btn').click(), 100);
    });
  });

  // Clear annotations
  $('btn-clear').addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'CLEAR_ANNOTATIONS' });
    $('levels-content').style.display = 'none';
    $('levels-empty').style.display = 'flex';
    $('trend-badge').style.display = 'none';
    $('m-trend').textContent = '—';
    $('m-mom').textContent = '—';
    $('m-sup').textContent = '—';
    $('m-res').textContent = '—';
  });

  // Refresh
  $('btn-refresh').addEventListener('click', () => {
    fetchChartData();
    setTimeout(() => runAnalysis('sr'), 1500);
  });

  // ─── Groq Settings Event Listeners ──────────────────────────────────────
  // Save API key on change
  $('groq-api-key').addEventListener('input', function () {
    state.groqApiKey = this.value.trim();
    chrome.storage.local.set({ groqApiKey: state.groqApiKey });
    updateApiConnStatus();
  });

  // Save model on change
  $('groq-model').addEventListener('change', function () {
    state.groqModel = this.value;
    chrome.storage.local.set({ groqModel: state.groqModel });
  });

  // Eye toggle for API key visibility
  $('btn-eye-toggle').addEventListener('click', () => {
    const input = $('groq-api-key');
    const isPassword = input.type === 'password';
    input.type = isPassword ? 'text' : 'password';
    $('btn-eye-toggle').textContent = isPassword ? '🙈' : '👁';
  });

  // Test connection button
  $('btn-test-api').addEventListener('click', async () => {
    const statusEl = $('api-status');
    const btn = $('btn-test-api');
    btn.disabled = true;
    statusEl.className = 'api-status loading';
    statusEl.textContent = '⏳ Testing connection...';

    try {
      const text = await callGroqAPI([
        { role: 'system', content: 'Respond with exactly: Connection successful.' },
        { role: 'user', content: 'Test connection.' }
      ], 20);

      statusEl.className = 'api-status success';
      statusEl.textContent = `✅ Connected! Model: ${state.groqModel}`;
      $('api-conn-status').textContent = '🟢 Connected';
      $('api-conn-status').style.color = 'var(--bull)';
    } catch (e) {
      statusEl.className = 'api-status error';
      statusEl.textContent = `❌ ${e.message}`;
      $('api-conn-status').textContent = '🔴 Error';
      $('api-conn-status').style.color = 'var(--bear)';
    }

    btn.disabled = false;
  });

  // ─── Init ──────────────────────────────────────────────────────────────────
  loadSettings();
  fetchChartData();

})();
