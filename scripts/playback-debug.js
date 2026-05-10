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

  function report(kind, url, context, note) {
    var parsed = interesting(url);
    if (!parsed) return;

    var key = [kind, parsed.host, parsed.pathname, context || '', note || ''].join('|');
    if (seen[key]) return;
    seen[key] = true;

    fetch(endpoint, {
      method: 'POST',
      credentials: 'same-origin',
      keepalive: true,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        kind: kind,
        url: parsed.href,
        host: parsed.host,
        context: context || '',
        note: note || ''
      })
    }).catch(function () {});
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

  function scanDom() {
    report('page', location.href, 'location', 'iframe-page');

    var attrs = document.querySelectorAll('[src],[href]');
    for (var i = 0; i < attrs.length; i += 1) {
      var el = attrs[i];
      var value = el.getAttribute('src') || el.getAttribute('href');
      if (!value) continue;
      report('dom-attr', value, el.tagName.toLowerCase(), 'initial-dom');
    }

    var scripts = document.scripts;
    for (var j = 0; j < scripts.length; j += 1) {
      var script = scripts[j];
      if (script.src) report('script-src', script.src, 'script', 'initial-script');
      if (script.textContent) scanText('script-text', script.textContent, 'script-inline');
    }
  }

  if (typeof window.fetch === 'function') {
    var origFetch = window.fetch.bind(window);
    window.fetch = function (input, init) {
      try {
        if (typeof input === 'string') {
          report('fetch', input, 'fetch', 'request');
        } else if (input && typeof input.url === 'string') {
          report('fetch', input.url, 'fetch', 'request');
        }
      } catch (e) {}
      return origFetch(input, init);
    };
  }

  var origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    try { report('xhr', url, 'xhr', String(method || '')); } catch (e) {}
    return origOpen.apply(this, arguments);
  };

  if (navigator.sendBeacon) {
    var origBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = function (url, data) {
      try { report('beacon', url, 'beacon', 'request'); } catch (e) {}
      return origBeacon(url, data);
    };
  }

  var origSetAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (name, value) {
    if ((name === 'src' || name === 'href') && typeof value === 'string') {
      try { report('set-attr', value, this.tagName.toLowerCase(), name); } catch (e) {}
    }
    return origSetAttribute.call(this, name, value);
  };

  window.addEventListener('error', function (event) {
    var target = event && event.target;
    if (!target || target === window) return;
    if (target.src) report('error', target.src, target.tagName ? target.tagName.toLowerCase() : 'resource', 'resource-error');
    else if (target.href) report('error', target.href, target.tagName ? target.tagName.toLowerCase() : 'resource', 'resource-error');
  }, true);

  if (typeof PerformanceObserver === 'function') {
    try {
      var observer = new PerformanceObserver(function (list) {
        var entries = list.getEntries();
        for (var i = 0; i < entries.length; i += 1) {
          report('resource', entries[i].name, entries[i].initiatorType || 'resource', 'perf');
        }
      });
      observer.observe({ type: 'resource', buffered: true });
    } catch (e) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scanDom, { once: true });
  } else {
    scanDom();
  }
})();
