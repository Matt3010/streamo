(function() {
  // Block window.open
  var noop = function() { return null; };
  try {
    Object.defineProperty(window, 'open', {
      value: noop,
      writable: false,
      configurable: false
    });
  } catch(e) {
    window.open = noop;
  }

  // Allowed hosts whitelist
  var allowedHosts = [location.host, 'vixsrc.to', 'vixcloud.co'];

  function isBadUrl(u) {
    if (!u) return false;
    try {
      var url = new URL(u, location.href);
      return !allowedHosts.some(function(h) {
        return url.host === h || url.host.endsWith('.' + h);
      });
    } catch(e) {
      return false;
    }
  }

  // Block clicks on bad links
  var events = ['click', 'auxclick', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'touchstart', 'touchend', 'contextmenu'];
  events.forEach(function(ev) {
    document.addEventListener(ev, function(e) {
      var t = e.target;
      while (t && t !== document) {
        if (t.tagName === 'A') {
          if (t.target === '_blank' || t.getAttribute('target') === '_blank' || isBadUrl(t.href)) {
            e.preventDefault();
            e.stopImmediatePropagation();
            return false;
          }
        }
        if (t.tagName === 'FORM' && t.target === '_blank') {
          e.preventDefault();
          e.stopImmediatePropagation();
          return false;
        }
        t = t.parentElement;
      }
    }, true);
  });
})();
