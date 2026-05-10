(function () {
  'use strict';

  var base = location.protocol + '//' + location.host;

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
      args[1] = rewrite(url);
    } catch (e) {}
    return origOpen.apply(this, args);
  };
})();
