const snippetEl = document.getElementById('snippet');
const saveBtn = document.getElementById('saveBtn');
const clearBtn = document.getElementById('clearBtn');
const statusEl = document.getElementById('status');
const wordCountEl = document.getElementById('wordCount');
const charCountEl = document.getElementById('charCount');
const MAX_WORDS = 40000;

(function renderCredit() {
  const el = document.querySelector('.credit');
  if (!el || !window.SnippetPasteWM) return;
  el.textContent = window.SnippetPasteWM.text;
  if (!window.SnippetPasteWM.verify()) el.textContent += ' (integrity check failed)';
})();

function updateCounts() {
  const text = snippetEl.value;
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const chars = text.length;
  wordCountEl.textContent = words.toLocaleString();
  charCountEl.textContent = chars.toLocaleString();
  wordCountEl.style.color = words > MAX_WORDS ? '#d93025' : '#666';
}

function showStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.className = 'status ' + (isError ? 'error' : 'success');
  setTimeout(() => { statusEl.textContent = ''; }, 3000);
}

snippetEl.addEventListener('input', updateCounts);

saveBtn.addEventListener('click', () => {
  const text = snippetEl.value;
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  
  if (words > MAX_WORDS) {
    showStatus(`Error: ${words.toLocaleString()} words exceeds ${MAX_WORDS.toLocaleString()} limit`, true);
    return;
  }
  
  chrome.runtime.sendMessage({ action: 'setSnippet', snippet: text }, (response) => {
    if (response && response.success) {
      showStatus('Snippet saved successfully!');
    } else {
      showStatus('Failed to save snippet', true);
    }
  });
});

clearBtn.addEventListener('click', () => {
  snippetEl.value = '';
  updateCounts();
  chrome.runtime.sendMessage({ action: 'setSnippet', snippet: '' }, () => {
    showStatus('Snippet cleared');
  });
});

chrome.runtime.sendMessage({ action: 'getSnippet' }, (response) => {
  if (response && response.snippet) {
    snippetEl.value = response.snippet;
    updateCounts();
  }
});