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

  // Block appendChild/insertBefore for bad scripts/iframes
  var origAppend = Node.prototype.appendChild;
  Node.prototype.appendChild = function(node) {
    if (node && node.tagName) {
      var tag = node.tagName.toLowerCase();
      if (tag === 'script' && isBadUrl(node.src)) return node;
      if (tag === 'iframe' && isBadUrl(node.src)) return node;
      if (tag === 'a' && node.target === '_blank') {
        node.target = '_self';
        node.removeAttribute('target');
      }
    }
    return origAppend.call(this, node);
  };

  var origInsert = Node.prototype.insertBefore;
  Node.prototype.insertBefore = function(node, ref) {
    if (node && node.tagName) {
      var tag = node.tagName.toLowerCase();
      if (tag === 'script' && isBadUrl(node.src)) return node;
      if (tag === 'iframe' && isBadUrl(node.src)) return node;
    }
    return origInsert.call(this, node, ref);
  };

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

  // Block beforeunload/unload events
  var origAdd = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function(type, listener, opts) {
    if (type === 'beforeunload' || type === 'unload' || type === 'pagehide') return;
    if (type === 'visibilitychange' && this === document) return;
    return origAdd.call(this, type, listener, opts);
  };

  try {
    Object.defineProperty(window, 'onbeforeunload', {
      get: function() { return null; },
      set: function() {},
      configurable: false
    });
  } catch(e) {}

  try {
    Object.defineProperty(window, 'onunload', {
      get: function() { return null; },
      set: function() {},
      configurable: false
    });
  } catch(e) {}

  // Block dynamic link creation with _blank target
  var origCreateEl = document.createElement.bind(document);
  document.createElement = function(tag) {
    var el = origCreateEl(tag);
    if (tag && tag.toLowerCase() === 'a') {
      var origClick = el.click.bind(el);
      el.click = function() {
        if (el.target === '_blank' || isBadUrl(el.href)) return;
        return origClick();
      };
    }
    return el;
  };
})();
