(function() {
  // Read start time from outer URL (set by app.js via /player/movie/X?start=N)
  var params = new URLSearchParams(location.search);
  var startTime = parseInt(params.get('start'), 10);

  if (!(startTime > 0)) return;

  function withStart(value) {
    if (typeof value !== 'string' || value.indexOf('/embed/') === -1 || value.indexOf('start=') !== -1) {
      return value;
    }
    var sep = value.indexOf('?') !== -1 ? '&' : '?';
    return value + sep + 'start=' + startTime;
  }

  // Intercept iframe.src assignment to inject the start param into /embed/ URL
  var srcDescriptor = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'src') ||
                      Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'src');

  if (srcDescriptor && srcDescriptor.set) {
    var origSet = srcDescriptor.set;
    Object.defineProperty(HTMLIFrameElement.prototype, 'src', {
      configurable: true,
      enumerable: srcDescriptor.enumerable,
      get: srcDescriptor.get,
      set: function(value) {
        return origSet.call(this, withStart(value));
      }
    });
  }

  // Also handle setAttribute("src", ...) for safety
  var origSetAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function(name, value) {
    if (this.tagName === 'IFRAME' && name === 'src') {
      value = withStart(value);
    }
    return origSetAttribute.call(this, name, value);
  };

  // The provider TV page ships a static <iframe src=".../embed/..."> in the
  // HTML, so the browser may set it during parsing without passing through
  // the JS setters above. Patch any already-present iframe once the DOM exists.
  function patchExistingIframes() {
    var frames = document.getElementsByTagName('iframe');
    for (var i = 0; i < frames.length; i += 1) {
      var frame = frames[i];
      var current = frame.getAttribute('src') || frame.src;
      var next = withStart(current);
      if (next && next !== current) {
        frame.setAttribute('src', next);
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', patchExistingIframes, { once: true });
  } else {
    patchExistingIframes();
  }
})();
