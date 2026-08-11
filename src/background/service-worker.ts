// Service worker entry point
// Registers side panel and handles extension icon click

// Open side panel when extension icon is clicked
chrome.action.onClicked.addListener((tab) => {
  if (tab.id) {
    chrome.sidePanel.open({ tabId: tab.id });
  }
});

// Enable side panel to be openable
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
