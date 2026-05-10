(function () {
  'use strict';

  var base = location.protocol + '//' + location.host;
  var prefix = '[xhr-proxy-rewrite]';

  function log() {
    try {
      var args = Array.prototype.slice.call(arguments);
      args.unshift(prefix);
      console.debug.apply(console, args);
    } catch (e) {}
  }

  function rewrite(url) {
    if (!url || typeof url !== 'string') return url;

    var cdn = url.match(/^(?:https?:)?\/\/([a-z0-9-]+)\.vix-content\.net(\/[^\s]*)?$/i);
    if (cdn) {
      return base + '/cdn/' + cdn[1] + (cdn[2] || '/');
    }

    if (/^(?:https?:)?\/\/vixsrc\.to\/playlist(\/|$|\?)/i.test(url)) {
      return url.replace(/^(?:https?:)?\/\/vixsrc\.to/i, base);
    }

    if (/^(?:https?:)?\/\/vixsrc\.to\/storage(\/|$|\?)/i.test(url)) {
      return url.replace(/^(?:https?:)?\/\/vixsrc\.to/i, base);
    }

    if (/^(?:https?:)?\/\/vixcloud\.co(\/|$|\?)/i.test(url)) {
      return url.replace(/^(?:https?:)?\/\/vixcloud\.co/i, base + '/vixcloud');
    }

    return url;
  }

  var origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    var args = Array.prototype.slice.call(arguments);
    try {
      var original = args[1];
      var rewritten = rewrite(url);
      if (rewritten !== original) {
        log('rewrite', method || 'GET', original, '->', rewritten);
      }
      args[1] = rewritten;
    } catch (e) {}
    return origOpen.apply(this, args);
  };

  log('loaded', location.href);
})();
