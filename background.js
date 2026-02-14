// Count magnet links on the active tab and set badge
async function updateBadge(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      function: () => document.querySelectorAll('a[href^="magnet:"]').length
    });

    const count = results[0]?.result || 0;
    await chrome.action.setBadgeText({ text: count > 0 ? String(count) : '', tabId });
    await chrome.action.setBadgeBackgroundColor({ color: '#2196F3', tabId });
  } catch (e) {
    // Cannot inject into chrome:// or restricted pages — clear badge
    await chrome.action.setBadgeText({ text: '', tabId });
  }
}

// Update badge when tab is activated
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  updateBadge(activeInfo.tabId);
});

// Update badge when page finishes loading
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'complete') {
    updateBadge(tabId);
  }
});
