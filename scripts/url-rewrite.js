(function () {
  'use strict';

  var proxyHost = location.host;
  var proxyProto = location.protocol;
  var base = proxyProto + '//' + proxyHost;

  // Rewrites third-party URLs that mobile carriers DPI-block to go back
  // through this site as a proxy. Mirrors nginx routes:
  //   *.vix-content.net/PATH        → /cdn/<sub>/PATH
  //   vixsrc.to/PATH                → /PATH
  //   vixcloud.co/PATH              → /vixcloud/PATH
  function rewrite(url) {
    if (!url || typeof url !== 'string') return url;

    var m = url.match(/^(?:https?:)?\/\/([a-z0-9-]+)\.vix-content\.net(\/[^\s]*)?/i);
    if (m) return base + '/cdn/' + m[1] + (m[2] || '/');

    if (/^(?:https?:)?\/\/vixcloud\.co(\/|$|\?)/i.test(url)) {
      return url.replace(/^(?:https?:)?\/\/vixcloud\.co/i, base + '/vixcloud');
    }

    if (/^(?:https?:)?\/\/vixsrc\.to(\/|$|\?)/i.test(url)) {
      return url.replace(/^(?:https?:)?\/\/vixsrc\.to/i, base);
    }

    return url;
  }

  // fetch()
  if (typeof window.fetch === 'function') {
    var origFetch = window.fetch.bind(window);
    window.fetch = function (input, init) {
      try {
        if (typeof input === 'string') {
          return origFetch(rewrite(input), init);
        }
        if (input && typeof input.url === 'string') {
          var newUrl = rewrite(input.url);
          if (newUrl !== input.url) return origFetch(new Request(newUrl, input), init);
        }
      } catch (e) { /* fall through to original */ }
      return origFetch(input, init);
    };
  }

  // XMLHttpRequest.open
  var origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    var args = Array.prototype.slice.call(arguments);
    args[1] = rewrite(url);
    return origOpen.apply(this, args);
  };

  // navigator.sendBeacon (analytics)
  if (navigator.sendBeacon) {
    var origBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = function (url, data) {
      return origBeacon(rewrite(url), data);
    };
  }

  // Element.setAttribute / setAttributeNS for src/href
  var origSetAttr = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (name, value) {
    if ((name === 'src' || name === 'href') && typeof value === 'string') {
      value = rewrite(value);
    }
    return origSetAttr.call(this, name, value);
  };
  var origSetAttrNS = Element.prototype.setAttributeNS;
  Element.prototype.setAttributeNS = function (ns, name, value) {
    if ((name === 'src' || name === 'href' || /:(src|href)$/.test(name)) && typeof value === 'string') {
      value = rewrite(value);
    }
    return origSetAttrNS.call(this, ns, name, value);
  };

  // src/href property setters on common elements
  function patchProp(proto, prop) {
    if (!proto) return;
    var d = Object.getOwnPropertyDescriptor(proto, prop);
    if (!d || !d.set) return;
    Object.defineProperty(proto, prop, {
      get: d.get,
      set: function (v) { d.set.call(this, rewrite(v)); },
      configurable: true
    });
  }
  patchProp(HTMLMediaElement.prototype, 'src');
  patchProp(HTMLImageElement.prototype, 'src');
  patchProp(HTMLSourceElement.prototype, 'src');
  patchProp(HTMLIFrameElement.prototype, 'src');
  patchProp(HTMLScriptElement.prototype, 'src');
  patchProp(HTMLLinkElement.prototype, 'href');
  patchProp(HTMLAnchorElement.prototype, 'href');
})();
