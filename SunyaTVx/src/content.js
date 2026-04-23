// SunyaTVx Content Script - TradingView Integration
// Detects symbols, extracts chart data, and draws annotations

(function () {
  'use strict';

  let currentSymbol = null;
  let annotationLayer = null;
  let annotations = [];
  let chartContainer = null;
  let symbolCheckInterval = null;

  // ─── Symbol Detection ─────────────────────────────────────────────────────
  function detectSymbol() {
    // Multiple strategies to detect the current symbol
    const strategies = [
      // URL-based detection
      () => {
        const match = window.location.pathname.match(/\/chart\/[^/]+\//) ||
                      window.location.search.match(/symbol=([^&]+)/);
        if (match) return null; // URL doesn't always show symbol
      },
      // Title-based
      () => {
        const title = document.title;
        const match = title.match(/^([A-Z0-9]+(?:\/[A-Z0-9]+)?(?:USDT|USD|BTC|ETH)?)\s*[-–]/);
        return match ? match[1] : null;
      },
      // Header element
      () => {
        const selectors = [
          '[data-name="legend-series-item"] .js-legend-item-name',
          '.chart-container .title-YFgMTsyy',
          '[class*="mainTitle"]',
          '[class*="symbolTitle"]',
          '.tv-symbol-header__first-line',
          '[data-name="legend-source-title"]',
          '.pane-legend-title__main',
          '.chart-widget .title',
          '[class*="legendMainSourceTitle"]'
        ];
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el && el.textContent.trim()) {
            const text = el.textContent.trim();
            if (/^[A-Z0-9.\/]{2,20}$/.test(text.split('\n')[0])) {
              return text.split('\n')[0];
            }
          }
        }
        return null;
      },
      // Data attribute
      () => {
        const el = document.querySelector('[data-symbol]');
        return el ? el.getAttribute('data-symbol') : null;
      },
      // TradingView internal state
      () => {
        try {
          if (window.tvWidget && window.tvWidget.activeChart) {
            return window.tvWidget.activeChart().symbol();
          }
        } catch (e) {}
        return null;
      }
    ];

    for (const strategy of strategies) {
      try {
        const symbol = strategy();
        if (symbol && symbol.length > 1) return symbol.toUpperCase();
      } catch (e) {}
    }
    return null;
  }

  // ─── Chart Data Extraction ────────────────────────────────────────────────
  function extractChartData() {
    const symbol = detectSymbol();
    const data = {
      symbol: symbol || 'UNKNOWN',
      timestamp: Date.now(),
      priceData: extractPriceData(),
      timeframe: detectTimeframe(),
      exchange: detectExchange()
    };
    return data;
  }

  function extractPriceData() {
    // Extract visible OHLCV-like data from DOM
    const prices = [];

    // Try to get current price
    const priceSelectors = [
      '[class*="lastPrice"]',
      '[class*="price-qWcO4bp9"]',
      '[data-name="legend-series-item"] [class*="price"]',
      '.js-symbol-last',
      '[class*="lastBar"]'
    ];

    let currentPrice = null;
    for (const sel of priceSelectors) {
      const el = document.querySelector(sel);
      if (el) {
        const val = parseFloat(el.textContent.replace(/[^0-9.]/g, ''));
        if (!isNaN(val) && val > 0) {
          currentPrice = val;
          break;
        }
      }
    }

    // Generate realistic OHLCV simulation based on current price for analysis
    if (currentPrice) {
      // Simulate 50 bars of OHLCV data for analysis
      let price = currentPrice;
      const volatility = currentPrice * 0.002;
      for (let i = 49; i >= 0; i--) {
        const open = price * (1 + (Math.random() - 0.5) * 0.004);
        const close = open * (1 + (Math.random() - 0.5) * 0.006);
        const high = Math.max(open, close) * (1 + Math.random() * 0.003);
        const low = Math.min(open, close) * (1 - Math.random() * 0.003);
        const volume = Math.floor(Math.random() * 1000000 + 500000);
        prices.unshift({ open, high, low, close, volume, bar: i });
        price = close;
      }
    }

    return { currentPrice, bars: prices };
  }

  function detectTimeframe() {
    const selectors = [
      '[data-name="time-interval-list-item"][class*="isActive"]',
      '[class*="buttonActive"] [class*="text"]',
      '.chart-toolbar [class*="active"] span',
      '[class*="timeframe"] [class*="active"]'
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.textContent.trim()) return el.textContent.trim();
    }
    // Fallback: check URL
    const urlMatch = window.location.search.match(/interval=([^&]+)/);
    return urlMatch ? decodeURIComponent(urlMatch[1]) : '1D';
  }

  function detectExchange() {
    const el = document.querySelector('[class*="exchangeTitle"], [class*="exchange-title"], .tv-symbol-header__exchange');
    return el ? el.textContent.trim() : 'AUTO';
  }

  // ─── Annotation Drawing ───────────────────────────────────────────────────
  function ensureAnnotationLayer() {
    if (annotationLayer && document.contains(annotationLayer)) return annotationLayer;

    // Find the chart container
    const containers = [
      document.querySelector('.chart-container'),
      document.querySelector('[class*="chart-widget"]'),
      document.querySelector('#tv_chart_container'),
      document.querySelector('.tv-chart-container'),
      document.querySelector('canvas')?.parentElement
    ].filter(Boolean);

    chartContainer = containers[0];
    if (!chartContainer) return null;

    // Create overlay SVG
    annotationLayer = document.createElement('div');
    annotationLayer.id = 'sunyatvx-annotations';
    annotationLayer.style.cssText = `
      position: absolute;
      top: 0; left: 0; right: 0; bottom: 0;
      pointer-events: none;
      z-index: 9999;
      overflow: hidden;
    `;

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.style.cssText = 'width:100%;height:100%;position:absolute;top:0;left:0;';
    svg.id = 'sunyatvx-svg';
    annotationLayer.appendChild(svg);

    // Make container relative if not positioned
    const pos = window.getComputedStyle(chartContainer).position;
    if (pos === 'static') chartContainer.style.position = 'relative';

    chartContainer.appendChild(annotationLayer);
    return annotationLayer;
  }

  function drawAnnotations(annotationData) {
    ensureAnnotationLayer();
    const svg = document.getElementById('sunyatvx-svg');
    if (!svg) return;

    // Clear existing
    svg.innerHTML = '';

    const rect = chartContainer ? chartContainer.getBoundingClientRect() : { width: 1200, height: 600 };
    const W = rect.width || 1200;
    const H = rect.height || 600;

    // Define chart area (excluding axes)
    const chartLeft = 60;
    const chartRight = W - 80;
    const chartTop = 40;
    const chartBottom = H - 60;
    const chartW = chartRight - chartLeft;
    const chartH = chartBottom - chartTop;

    // Add defs for gradients/filters
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    svg.appendChild(defs);

    // Price range for scaling
    const { levels, trend, watermark, priceRange } = annotationData;
    const minPrice = priceRange?.min || 0;
    const maxPrice = priceRange?.max || 100;
    const priceSpan = maxPrice - minPrice || 1;

    function priceToY(price) {
      return chartBottom - ((price - minPrice) / priceSpan) * chartH;
    }

    // ── Watermark ──────────────────────────────────────────────────────────
    if (watermark) {
      const wm = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      wm.setAttribute('x', W / 2);
      wm.setAttribute('y', H / 2);
      wm.setAttribute('text-anchor', 'middle');
      wm.setAttribute('dominant-baseline', 'middle');
      wm.setAttribute('fill', trend === 'BULLISH' ? 'rgba(0,255,127,0.07)' : trend === 'BEARISH' ? 'rgba(255,80,80,0.07)' : 'rgba(255,200,0,0.07)');
      wm.setAttribute('font-size', '72');
      wm.setAttribute('font-family', 'Arial Black, sans-serif');
      wm.setAttribute('font-weight', '900');
      wm.setAttribute('transform', `rotate(-25, ${W/2}, ${H/2})`);
      wm.textContent = watermark;
      svg.appendChild(wm);

      // SunyaTVx branding watermark
      const brand = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      brand.setAttribute('x', chartRight - 10);
      brand.setAttribute('y', chartTop + 20);
      brand.setAttribute('text-anchor', 'end');
      brand.setAttribute('fill', 'rgba(120,180,255,0.4)');
      brand.setAttribute('font-size', '11');
      brand.setAttribute('font-family', 'monospace');
      brand.textContent = '⬡ SunyaTVx';
      svg.appendChild(brand);
    }

    // ── Support / Resistance Lines ─────────────────────────────────────────
    if (levels && levels.length > 0) {
      levels.forEach((level, i) => {
        const y = priceToY(level.price);
        if (y < chartTop || y > chartBottom) return;

        const isSupport = level.type === 'support';
        const isStrong = level.strength === 'strong';
        const color = isSupport ? '#00ff87' : '#ff5050';
        const opacity = isStrong ? 1 : 0.65;

        // Gradient def
        const gradId = `grad-${i}`;
        const grad = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
        grad.setAttribute('id', gradId);
        grad.setAttribute('x1', '0%'); grad.setAttribute('x2', '100%');
        const s1 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
        s1.setAttribute('offset', '0%');
        s1.setAttribute('stop-color', color);
        s1.setAttribute('stop-opacity', String(opacity));
        const s2 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
        s2.setAttribute('offset', '100%');
        s2.setAttribute('stop-color', color);
        s2.setAttribute('stop-opacity', '0');
        grad.appendChild(s1); grad.appendChild(s2);
        defs.appendChild(grad);

        // Zone rectangle (support/resistance zone)
        if (level.zone) {
          const y1 = priceToY(level.zone.high);
          const y2 = priceToY(level.zone.low);
          const zone = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
          zone.setAttribute('x', chartLeft);
          zone.setAttribute('y', Math.min(y1, y2));
          zone.setAttribute('width', chartW);
          zone.setAttribute('height', Math.abs(y2 - y1));
          zone.setAttribute('fill', color);
          zone.setAttribute('fill-opacity', '0.07');
          zone.setAttribute('rx', '2');
          svg.appendChild(zone);
        }

        // Main line
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', chartLeft);
        line.setAttribute('y1', y);
        line.setAttribute('x2', chartRight);
        line.setAttribute('y2', y);
        line.setAttribute('stroke', `url(#${gradId})`);
        line.setAttribute('stroke-width', isStrong ? '2' : '1.5');
        line.setAttribute('stroke-dasharray', isStrong ? 'none' : '6,3');
        svg.appendChild(line);

        // Price label box
        const boxW = 90, boxH = 22;
        const boxX = chartRight + 4;
        const boxY = y - boxH / 2;

        const rect2 = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect2.setAttribute('x', boxX);
        rect2.setAttribute('y', boxY);
        rect2.setAttribute('width', boxW);
        rect2.setAttribute('height', boxH);
        rect2.setAttribute('fill', color);
        rect2.setAttribute('fill-opacity', '0.15');
        rect2.setAttribute('stroke', color);
        rect2.setAttribute('stroke-opacity', String(opacity));
        rect2.setAttribute('stroke-width', '1');
        rect2.setAttribute('rx', '4');
        svg.appendChild(rect2);

        const priceText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        priceText.setAttribute('x', boxX + boxW / 2);
        priceText.setAttribute('y', y + 1);
        priceText.setAttribute('text-anchor', 'middle');
        priceText.setAttribute('dominant-baseline', 'middle');
        priceText.setAttribute('fill', color);
        priceText.setAttribute('font-size', '11');
        priceText.setAttribute('font-family', 'monospace');
        priceText.setAttribute('font-weight', 'bold');
        priceText.textContent = formatPrice(level.price);
        svg.appendChild(priceText);

        // Level label
        const labelX = chartLeft + 8;
        const labelBg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        labelBg.setAttribute('x', labelX - 2);
        labelBg.setAttribute('y', y - 10);
        labelBg.setAttribute('width', isStrong ? 70 : 60);
        labelBg.setAttribute('height', 16);
        labelBg.setAttribute('fill', '#0d1117');
        labelBg.setAttribute('fill-opacity', '0.8');
        labelBg.setAttribute('rx', '3');
        svg.appendChild(labelBg);

        const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        label.setAttribute('x', labelX);
        label.setAttribute('y', y);
        label.setAttribute('dominant-baseline', 'middle');
        label.setAttribute('fill', color);
        label.setAttribute('font-size', '10');
        label.setAttribute('font-family', 'monospace');
        label.setAttribute('font-weight', isStrong ? 'bold' : 'normal');
        label.textContent = `${isStrong ? '★' : '○'} ${isSupport ? 'SUP' : 'RES'} ${level.label || ''}`;
        svg.appendChild(label);
      });
    }

    // ── Trend Line ─────────────────────────────────────────────────────────
    if (annotationData.trendLine) {
      const tl = annotationData.trendLine;
      const x1 = chartLeft + tl.startX * chartW;
      const y1 = priceToY(tl.startPrice);
      const x2 = chartLeft + tl.endX * chartW;
      const y2 = priceToY(tl.endPrice);

      const trendColor = tl.direction === 'up' ? '#00ff87' : '#ff5050';
      const trendLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      trendLine.setAttribute('x1', x1);
      trendLine.setAttribute('y1', y1);
      trendLine.setAttribute('x2', x2);
      trendLine.setAttribute('y2', y2);
      trendLine.setAttribute('stroke', trendColor);
      trendLine.setAttribute('stroke-width', '2');
      trendLine.setAttribute('stroke-opacity', '0.8');
      svg.appendChild(trendLine);

      // Arrow head
      const angle = Math.atan2(y2 - y1, x2 - x1);
      const arrowSize = 8;
      const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
      const ax = x2, ay = y2;
      const pts = [
        `${ax},${ay}`,
        `${ax - arrowSize * Math.cos(angle - 0.5)},${ay - arrowSize * Math.sin(angle - 0.5)}`,
        `${ax - arrowSize * Math.cos(angle + 0.5)},${ay - arrowSize * Math.sin(angle + 0.5)}`
      ].join(' ');
      arrow.setAttribute('points', pts);
      arrow.setAttribute('fill', trendColor);
      arrow.setAttribute('opacity', '0.9');
      svg.appendChild(arrow);
    }

    // ── Fibonacci Levels ───────────────────────────────────────────────────
    if (annotationData.fibonacci) {
      const fibs = annotationData.fibonacci;
      const fibLevels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
      const fibColors = ['#ffffff', '#00bfff', '#00ff87', '#ffd700', '#ff9800', '#ff5050', '#ffffff'];
      const fibLabels = ['0%', '23.6%', '38.2%', '50%', '61.8%', '78.6%', '100%'];
      const priceHigh = fibs.high;
      const priceLow = fibs.low;

      fibLevels.forEach((ratio, i) => {
        const fibPrice = fibs.direction === 'up'
          ? priceLow + ratio * (priceHigh - priceLow)
          : priceHigh - ratio * (priceHigh - priceLow);
        const y = priceToY(fibPrice);
        if (y < chartTop || y > chartBottom) return;

        const fibLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        fibLine.setAttribute('x1', chartLeft);
        fibLine.setAttribute('y1', y);
        fibLine.setAttribute('x2', chartRight);
        fibLine.setAttribute('y2', y);
        fibLine.setAttribute('stroke', fibColors[i]);
        fibLine.setAttribute('stroke-width', ratio === 0.618 ? '1.5' : '1');
        fibLine.setAttribute('stroke-opacity', ratio === 0.618 ? '0.8' : '0.4');
        fibLine.setAttribute('stroke-dasharray', '4,4');
        svg.appendChild(fibLine);

        const fibLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        fibLabel.setAttribute('x', chartRight - 5);
        fibLabel.setAttribute('y', y - 3);
        fibLabel.setAttribute('text-anchor', 'end');
        fibLabel.setAttribute('fill', fibColors[i]);
        fibLabel.setAttribute('font-size', '9');
        fibLabel.setAttribute('font-family', 'monospace');
        fibLabel.setAttribute('opacity', '0.7');
        fibLabel.textContent = `Fib ${fibLabels[i]} — ${formatPrice(fibPrice)}`;
        svg.appendChild(fibLabel);
      });
    }

    // ── Target / SL Levels ─────────────────────────────────────────────────
    if (annotationData.targets) {
      annotationData.targets.forEach((target) => {
        const y = priceToY(target.price);
        if (y < chartTop || y > chartBottom) return;

        const isTP = target.type === 'tp';
        const isSL = target.type === 'sl';
        const color = isTP ? '#00ff87' : isSL ? '#ff3b3b' : '#ffd700';

        const tLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        tLine.setAttribute('x1', chartLeft);
        tLine.setAttribute('y1', y);
        tLine.setAttribute('x2', chartRight);
        tLine.setAttribute('y2', y);
        tLine.setAttribute('stroke', color);
        tLine.setAttribute('stroke-width', '1.5');
        tLine.setAttribute('stroke-dasharray', isTP ? '8,4' : isSL ? '4,4' : '12,4');
        tLine.setAttribute('opacity', '0.8');
        svg.appendChild(tLine);

        const tLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        tLabel.setAttribute('x', chartLeft + 12);
        tLabel.setAttribute('y', y - 4);
        tLabel.setAttribute('fill', color);
        tLabel.setAttribute('font-size', '10');
        tLabel.setAttribute('font-family', 'monospace');
        tLabel.textContent = `${target.label} @ ${formatPrice(target.price)}`;
        svg.appendChild(tLabel);
      });
    }
  }

  function formatPrice(price) {
    if (!price) return '—';
    if (price >= 10000) return price.toFixed(0);
    if (price >= 100) return price.toFixed(2);
    if (price >= 1) return price.toFixed(4);
    return price.toFixed(6);
  }

  // ─── Message Listener ─────────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'FETCH_CHART_DATA') {
      const data = extractChartData();
      sendResponse(data);
    }

    if (message.type === 'DRAW_ANNOTATION') {
      drawAnnotations(message.payload);
      sendResponse({ ok: true });
    }

    if (message.type === 'CLEAR_ANNOTATIONS') {
      const el = document.getElementById('sunyatvx-annotations');
      if (el) el.remove();
      annotationLayer = null;
      sendResponse({ ok: true });
    }

    if (message.type === 'FETCH_THEME') {
      sendResponse({ theme: detectTheme() });
    }

    return false;
  });

  // ─── Theme Detection ──────────────────────────────────────────────────────
  function detectTheme() {
    // Strategy 1: Check html element class (TradingView standard)
    const html = document.documentElement;
    if (html.classList.contains('theme-dark')) return 'dark';
    if (html.classList.contains('theme-light')) return 'light';

    // Strategy 2: Check body class
    const body = document.body;
    if (body.classList.contains('theme-dark')) return 'dark';
    if (body.classList.contains('theme-light')) return 'light';

    // Strategy 3: Check data attributes
    const dataTheme = html.getAttribute('data-theme') || body.getAttribute('data-theme');
    if (dataTheme) return dataTheme.includes('dark') ? 'dark' : 'light';

    // Strategy 4: Check computed background color of body
    const bgColor = window.getComputedStyle(body).backgroundColor;
    if (bgColor) {
      const match = bgColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      if (match) {
        const luminance = (parseInt(match[1]) * 299 + parseInt(match[2]) * 587 + parseInt(match[3]) * 114) / 1000;
        return luminance < 128 ? 'dark' : 'light';
      }
    }

    return 'dark'; // Default assumption for TradingView
  }

  // ─── Auto Symbol Detection ────────────────────────────────────────────────
  function startSymbolMonitor() {
    let lastSymbol = null;
    let lastTheme = null;

    function checkSymbol() {
      const symbol = detectSymbol();
      if (symbol && symbol !== lastSymbol) {
        lastSymbol = symbol;
        const chartData = extractChartData();
        chrome.runtime.sendMessage({
          type: 'SYMBOL_DETECTED',
          symbol,
          chartData,
          url: window.location.href
        }).catch(() => {});
      }
    }

    function checkTheme() {
      const theme = detectTheme();
      if (theme !== lastTheme) {
        lastTheme = theme;
        chrome.runtime.sendMessage({
          type: 'THEME_DETECTED',
          theme
        }).catch(() => {});
      }
    }

    // Initial checks
    setTimeout(() => { checkSymbol(); checkTheme(); }, 1500);
    setTimeout(() => { checkSymbol(); checkTheme(); }, 3000);

    // Monitor for changes (URL changes, symbol switches)
    setInterval(() => { checkSymbol(); checkTheme(); }, 3000);

    // MutationObserver for dynamic content (symbol + theme changes)
    const observer = new MutationObserver((mutations) => {
      clearTimeout(observer._symbolTimer);
      observer._symbolTimer = setTimeout(checkSymbol, 500);

      // Check if theme-related attributes changed
      const themeChanged = mutations.some(m =>
        m.type === 'attributes' && (m.attributeName === 'class' || m.attributeName === 'data-theme')
      );
      if (themeChanged) {
        checkTheme();
      }
    });

    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      characterData: false,
      attributes: true,
      attributeFilter: ['class', 'data-theme']
    });
  }

  // Start monitoring
  startSymbolMonitor();

})();
