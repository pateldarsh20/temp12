/*
 * Snippet Paste - authorship watermark.
 *
 * The credit string is stored XOR-obfuscated + base64 encoded so it is not
 * readable by casually opening the source, and carries an FNV-1a checksum so
 * that stripping or editing the marker is detectable via WM.verify().
 */
(function (root) {
  'use strict';

  var KEY = 0x5a;
  var PAYLOAD = 'GSg/Oy4/PnoYI3oYMz16HjM5MXoeOz4+Iw==';
  var CHECKSUM = '2b247f25';

  function decode() {
    var raw = atob(PAYLOAD);
    var out = '';
    for (var i = 0; i < raw.length; i++) {
      out += String.fromCharCode(raw.charCodeAt(i) ^ KEY);
    }
    return out;
  }

  // FNV-1a 32-bit
  function checksum(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return ('00000000' + h.toString(16)).slice(-8);
  }

  var text = decode();

  root.SnippetPasteWM = {
    text: text,
    // true only if the marker is intact and untampered
    verify: function () {
      return checksum(text) === CHECKSUM;
    }
  };
})(typeof self !== 'undefined' ? self : this);
