(function () {
  'use strict';

  // Guard against double injection (content script may be injected manually into
  // already-open tabs, on top of the declarative injection).
  if (window.__snippetPasteLoaded) return;
  window.__snippetPasteLoaded = true;

  var DEFAULT_TRIGGER = '/writ';
  var win = window;
  var snippet = '';
  var trigger = DEFAULT_TRIGGER;
  var composing = false;
  var running = false;

  chrome.runtime.sendMessage({ action: 'getSnippet' }, function (res) {
    if (!res) return;
    if (typeof res.snippet === 'string') snippet = res.snippet;
    if (typeof res.trigger === 'string' && res.trigger) trigger = res.trigger;
  });

  chrome.runtime.onMessage.addListener(function (msg) {
    if (!msg) return;
    if (msg.action === 'snippetUpdated') {
      if (typeof msg.snippet === 'string') snippet = msg.snippet;
      if (typeof msg.trigger === 'string' && msg.trigger) trigger = msg.trigger;
    }
  });

  // Only these input types support the Selection API (per HTML spec), which the
  // caret logic depends on. email/number/date etc. return null for
  // selectionStart, so we skip them rather than silently doing nothing.
  var TEXT_INPUT_TYPES = {
    text: 1, search: 1, url: 1, tel: 1
  };

  function isTextField(el) {
    if (!el || el.tagName !== 'INPUT') return false;
    var t = (el.getAttribute('type') || 'text').toLowerCase();
    return TEXT_INPUT_TYPES[t] === 1;
  }

  function isTextArea(el) {
    return !!el && el.tagName === 'TEXTAREA';
  }

  function isEditableHost(el) {
    if (!el) return false;
    if (el.isContentEditable) return true;
    if (typeof el.getAttribute === 'function') {
      var v = el.getAttribute('contenteditable');
      return v === '' || v === 'true' || v === 'plaintext-only';
    }
    return false;
  }

  // Find the element that actually holds the text being edited.
  function resolveEditable(node) {
    var el = node;
    if (!el || el.nodeType !== 1) return null;
    if (isTextField(el) || isTextArea(el)) return el;
    while (el) {
      if (isEditableHost(el)) return el;
      el = el.parentElement;
    }
    return null;
  }

  // ---- offset <-> range helpers (for contenteditable) ----

  function rangeOffsets(win, root) {
    var sel = win.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    var range = sel.getRangeAt(0);
    if (!root.contains(range.startContainer)) return null;

    var pre = range.cloneRange();
    pre.selectNodeContents(root);
    try { pre.setEnd(range.startContainer, range.startOffset); } catch (e) { return null; }
    var start = pre.toString().length;
    var end = start + range.toString().length;
    return { start: start, end: end, range: range };
  }

  function rangeFromOffsets(win, root, start, end) {
    var walker = win.document.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */, null, false);
    var range = win.document.createRange();
    var pos = 0, foundStart = false, node;

    while ((node = walker.nextNode())) {
      var len = node.nodeValue.length;
      if (!foundStart && pos + len >= start) {
        range.setStart(node, start - pos);
        foundStart = true;
      }
      if (foundStart && pos + len >= end) {
        range.setEnd(node, end - pos);
        return range;
      }
      pos += len;
    }
    if (foundStart) range.setEnd(node, node ? node.nodeValue.length : 0);
    return range;
  }

  function fireInput(el) {
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // Set .value through the native setter so React/Vue state stays in sync.
  function setNativeValue(el, value) {
    var proto = el.tagName === 'TEXTAREA' ? win.HTMLTextAreaElement.prototype : win.HTMLInputElement.prototype;
    var desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(el, value);
    else el.value = value;
  }

  function replaceInField(el, before, after, insertion, caretBase) {
    var value = el.value;
    var start = caretBase - before.length;
    var next = value.slice(0, start) + insertion + value.slice(caretBase + after.length);
    var caret = start + insertion.length;

    setNativeValue(el, next);
    try { el.setSelectionRange(caret, caret); } catch (e) {}
    fireInput(el);
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function replaceInEditable(el, beforeLen, insertion) {
    var offsets = rangeOffsets(win, el);
    if (!offsets) return false;

    var start = offsets.start - beforeLen;
    if (start < 0) return false;
    var target = rangeFromOffsets(win, el, start, offsets.start);
    if (!target) return false;

    target.deleteContents();

    var lines = insertion.split('\n');
    var frag = win.document.createDocumentFragment();
    for (var i = 0; i < lines.length; i++) {
      if (i > 0) frag.appendChild(win.document.createElement('br'));
      frag.appendChild(win.document.createTextNode(lines[i]));
    }
    var last = frag.lastChild;
    target.insertNode(frag);

    if (last) {
      var after = win.document.createRange();
      after.setStartAfter(last);
      after.collapse(true);
      var sel = win.getSelection();
      sel.removeAllRanges();
      sel.addRange(after);
    }
    fireInput(el);
    return true;
  }

  function expand(el) {
    if (running) return false;
    if (!snippet) return false;
    if (isTextField(el) || isTextArea(el)) {
      var caret = el.selectionStart;
      if (caret == null || el.selectionEnd !== caret) return false;
      var value = el.value;
      var before = value.slice(0, caret);
      if (before.length < trigger.length) return false;
      if (before.slice(-trigger.length).toLowerCase() !== trigger.toLowerCase()) return false;
      var prevChar = before.charAt(before.length - trigger.length - 1);
      if (prevChar && /[A-Za-z0-9_]/.test(prevChar)) return false;

      running = true;
      try { replaceInField(el, trigger, '', snippet, caret); }
      catch (e) { return false; }
      finally { running = false; }
      return true;
    }

    if (isEditableHost(el)) {
      var offsets = rangeOffsets(win, el);
      if (!offsets || offsets.end !== offsets.start) return false; // caret must be collapsed
      var head = rangeFromOffsets(win, el, 0, offsets.start);
      if (!head) return false;
      var textBefore = head.toString();
      if (textBefore.length < trigger.length) return false;
      if (textBefore.slice(-trigger.length).toLowerCase() !== trigger.toLowerCase()) return false;
      var pc = textBefore.charAt(textBefore.length - trigger.length - 1);
      if (pc && /[A-Za-z0-9_]/.test(pc)) return false;

      running = true;
      var ok = false;
      try { ok = replaceInEditable(el, trigger.length, snippet); }
      catch (e) { ok = false; }
      finally { running = false; }
      return ok;
    }
    return false;
  }

  function maybeExpand(target) {
    var el = resolveEditable(target);
    if (!el) return;
    try { expand(el); } catch (e) {}
  }

  document.addEventListener('compositionstart', function () { composing = true; }, true);
  document.addEventListener('compositionend', function () {
    composing = false;
    var el = resolveEditable(document.activeElement);
    if (el) setTimeout(function () { maybeExpand(el); }, 0);
  }, true);

  document.addEventListener('keydown', function (e) {
    if (composing || e.key === 'Dead' || e.isComposing) return;
    var el = resolveEditable(e.target);
    if (!el) return;

    if (e.key === 'Tab' || e.key === 'Enter' || e.key === ' ') {
      // Try to expand; if it worked, swallow the key.
      if (expand(el)) {
        e.preventDefault();
        e.stopPropagation();
      }
      return;
    }

    // Immediate expansion the moment the trigger is fully typed.
    if (e.key && e.key.length === 1) {
      if (running) return;
      setTimeout(function () { maybeExpand(el); }, 0);
    }
  }, true);

  document.addEventListener('input', function (e) {
    if (composing) return;
    maybeExpand(e.target);
  }, true);

  // Pasting text that ends in the trigger should expand too.
  document.addEventListener('paste', function () {
    setTimeout(function () {
      var el = resolveEditable(document.activeElement);
      if (el) maybeExpand(el);
    }, 0);
  }, true);
})();
