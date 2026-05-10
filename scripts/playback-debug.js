(function () {
  'use strict';

  var endpoint = '/api/user/playback-debug';
  var seen = Object.create(null);
  var hostPattern = /(^|\.)vixsrc\.to$|(^|\.)vixcloud\.co$|(^|\.)(?:[a-z0-9-]+\.)?vix-content\.net$/i;
  var textPattern = /https?:\/\/[^\s"'<>]+|\/\/[^\s"'<>]+|[a-z0-9-]+\.vix-content\.net/gi;

  function normalize(url) {
    try {
      return new URL(url, location.href);
    } catch (e) {
      return null;
    }
  }

  function interesting(url) {
    var parsed = normalize(url);
    if (!parsed) return null;
    if (parsed.host === location.host) return null;
    if (!hostPattern.test(parsed.host)) return null;
    return parsed;
  }

  function send(payload) {
    var body = JSON.stringify(payload);
    try {
      if (navigator.sendBeacon) {
        var blob = new Blob([body], { type: 'application/json' });
        navigator.sendBeacon(endpoint, blob);
        return;
      }
    } catch (e) {}

    try {
      fetch(endpoint, {
        method: 'POST',
        credentials: 'same-origin',
        keepalive: true,
        headers: { 'content-type': 'application/json' },
        body: body
      }).catch(function () {});
    } catch (e) {}
  }

  function report(kind, url, context, note) {
    var parsed = interesting(url);
    if (!parsed) return;

    var key = [kind, parsed.host, parsed.pathname, context || '', note || ''].join('|');
    if (seen[key]) return;
    seen[key] = true;

    send({
      kind: kind,
      url: parsed.href,
      host: parsed.host,
      context: context || '',
      note: note || ''
    });
  }

  function scanText(kind, text, context) {
    if (!text || typeof text !== 'string') return;
    var matches = text.match(textPattern);
    if (!matches) return;

    for (var i = 0; i < matches.length; i += 1) {
      var value = matches[i];
      if (value.indexOf('vix-content.net') === -1 &&
          value.indexOf('vixsrc.to') === -1 &&
          value.indexOf('vixcloud.co') === -1) {
        continue;
      }
      if (value.indexOf('//') !== 0 && value.indexOf('http') !== 0 && value.indexOf('vix-content.net') !== -1) {
        value = 'https://' + value;
      }
      report(kind, value, context, 'text-scan');
    }
  }

  function scanNode(node, note) {
    if (!node || node.nodeType !== 1) return;

    if (node.hasAttribute && node.hasAttribute('src')) {
      report('dom-attr', node.getAttribute('src'), node.tagName.toLowerCase(), note);
    }
    if (node.hasAttribute && node.hasAttribute('href')) {
      report('dom-attr', node.getAttribute('href'), node.tagName.toLowerCase(), note);
    }
    if (node.tagName === 'SCRIPT') {
      if (node.src) report('script-src', node.src, 'script', note);
      if (node.textContent) scanText('script-text', node.textContent, 'script-inline');
    }

    if (!node.querySelectorAll) return;
    var nested = node.querySelectorAll('[src],[href],script');
    for (var i = 0; i < nested.length; i += 1) {
      var el = nested[i];
      if (el.hasAttribute('src')) report('dom-attr', el.getAttribute('src'), el.tagName.toLowerCase(), note);
      if (el.hasAttribute('href')) report('dom-attr', el.getAttribute('href'), el.tagName.toLowerCase(), note);
      if (el.tagName === 'SCRIPT') {
        if (el.src) report('script-src', el.src, 'script', note);
        if (el.textContent) scanText('script-text', el.textContent, 'script-inline');
      }
    }
  }

  function scanDocument() {
    report('page', location.href, 'location', 'iframe-page');
    scanNode(document.documentElement, 'initial-dom');
  }

  window.addEventListener('error', function (event) {
    var target = event && event.target;
    if (!target || target === window || target.nodeType !== 1) return;
    if (target.src) report('error', target.src, target.tagName ? target.tagName.toLowerCase() : 'resource', 'resource-error');
    else if (target.href) report('error', target.href, target.tagName ? target.tagName.toLowerCase() : 'resource', 'resource-error');
  }, true);

  if (typeof PerformanceObserver === 'function') {
    try {
      var perfObserver = new PerformanceObserver(function (list) {
        var entries = list.getEntries();
        for (var i = 0; i < entries.length; i += 1) {
          report('resource', entries[i].name, entries[i].initiatorType || 'resource', 'perf');
        }
      });
      perfObserver.observe({ type: 'resource', buffered: true });
    } catch (e) {}
  }

  if (typeof MutationObserver === 'function') {
    try {
      var domObserver = new MutationObserver(function (mutations) {
        for (var i = 0; i < mutations.length; i += 1) {
          var mutation = mutations[i];
          if (mutation.type === 'attributes' && mutation.target) {
            scanNode(mutation.target, 'mutated-attr');
          }
          if (mutation.addedNodes && mutation.addedNodes.length) {
            for (var j = 0; j < mutation.addedNodes.length; j += 1) {
              scanNode(mutation.addedNodes[j], 'added-node');
            }
          }
        }
      });
      domObserver.observe(document.documentElement || document, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['src', 'href']
      });
    } catch (e) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scanDocument, { once: true });
  } else {
    scanDocument();
  }
})();
