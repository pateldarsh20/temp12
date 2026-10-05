// Classic service workers expose importScripts; guard so this file still loads
// if the worker is ever switched to type: "module".
if (typeof importScripts === 'function') importScripts('watermark.js');

const DEFAULT_TRIGGER = '/writ';
const DEFAULTS = { snippet: '', trigger: DEFAULT_TRIGGER };
let cache = { ...DEFAULTS };

chrome.runtime.onInstalled.addListener(() => {
  if (self.SnippetPasteWM && !self.SnippetPasteWM.verify()) {
    console.warn('[Snippet Paste] watermark failed integrity check');
  }
  // Re-read storage, then inject. Uses a callback (not the cached value) so we
  // never hand tabs a stale snippet.
  chrome.storage.local.get(DEFAULTS, (r) => {
    cache = { snippet: r.snippet || '', trigger: r.trigger || DEFAULT_TRIGGER };
    injectIntoOpenTabs();
  });
});

chrome.runtime.onStartup.addListener(() => injectIntoOpenTabs());

// Content scripts only run on pages loaded *after* the extension is installed or
// reloaded, so already-open tabs would silently have no trigger. Inject manually.
// The freshly injected content.js pulls the snippet itself via getSnippet, so no
// separate broadcast is needed here.
function injectIntoOpenTabs() {
  chrome.tabs.query({}, (tabs) => {
    (tabs || []).forEach((tab) => {
      if (tab.id == null) return;
      if (/^(chrome|edge|about|devtools|chrome-extension|view-source|moz-extension):/i.test(tab.url || '')) return;
      chrome.scripting
        .executeScript({ target: { tabId: tab.id, allFrames: true }, files: ['content.js'] })
        .catch(() => {});
    });
  });
}

chrome.storage.local.get(DEFAULTS, (r) => {
  cache = { snippet: r.snippet || '', trigger: r.trigger || DEFAULT_TRIGGER };
});

function pushToAllTabs() {
  chrome.tabs.query({}, (tabs) => {
    (tabs || []).forEach((tab) => {
      if (tab.id == null) return;
      chrome.tabs.sendMessage(tab.id, { action: 'snippetUpdated', ...cache }, () => void chrome.runtime.lastError);
    });
  });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (!request) return;

  if (request.action === 'getSnippet') {
    sendResponse({ ...cache });
    return true;
  }

  if (request.action === 'setSnippet') {
    cache = {
      snippet: typeof request.snippet === 'string' ? request.snippet : '',
      trigger: typeof request.trigger === 'string' && request.trigger ? request.trigger : DEFAULT_TRIGGER,
    };
    chrome.storage.local.set(cache, () => {
      pushToAllTabs();
      sendResponse({ success: true });
    });
    return true;
  }
});
