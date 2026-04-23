// SunyaTVx - Background Service Worker
// Handles side panel, messaging, and state management

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);

// Track active TradingView tabs
const tvTabs = new Map();

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tab.url && (tab.url.includes('tradingview.com'))) {
    if (changeInfo.status === 'complete') {
      tvTabs.set(tabId, { url: tab.url, symbol: null });
      // Enable side panel for this tab
      chrome.sidePanel.setOptions({
        tabId,
        path: 'src/sidepanel.html',
        enabled: true
      });
    }
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  tvTabs.delete(tabId);
});

// Message relay between content script and side panel
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'SYMBOL_DETECTED') {
    // Store symbol for tab
    if (sender.tab) {
      tvTabs.set(sender.tab.id, { ...tvTabs.get(sender.tab.id), symbol: message.symbol, chartData: message.chartData });
    }
    // Broadcast to side panel
    chrome.runtime.sendMessage({ type: 'SYMBOL_UPDATE', ...message }).catch(() => {});
    sendResponse({ ok: true });
  }

  if (message.type === 'THEME_DETECTED') {
    // Store theme for tab and broadcast to side panel
    if (sender.tab) {
      tvTabs.set(sender.tab.id, { ...tvTabs.get(sender.tab.id), theme: message.theme });
    }
    chrome.runtime.sendMessage({ type: 'THEME_UPDATE', theme: message.theme }).catch(() => {});
    sendResponse({ ok: true });
  }

  if (message.type === 'GET_THEME') {
    // Side panel requesting theme from active tab
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'FETCH_THEME' }, (response) => {
          sendResponse(response || { theme: 'dark' });
        });
      } else {
        sendResponse({ theme: 'dark' });
      }
    });
    return true;
  }

  if (message.type === 'GET_CHART_DATA') {
    // Side panel requesting chart data from active tab
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'FETCH_CHART_DATA' }, (response) => {
          sendResponse(response || { error: 'No data' });
        });
      }
    });
    return true; // async
  }

  if (message.type === 'DRAW_ANNOTATION') {
    // Side panel requesting annotation on chart
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'DRAW_ANNOTATION', payload: message.payload }, (response) => {
          sendResponse(response || { error: 'Draw failed' });
        });
      }
    });
    return true;
  }

  if (message.type === 'CLEAR_ANNOTATIONS') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'CLEAR_ANNOTATIONS' }, sendResponse);
      }
    });
    return true;
  }

  return false;
});
