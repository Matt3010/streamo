(function() {
  // Read start time from outer URL (set by app.js via /player/movie/X?start=N)
  var params = new URLSearchParams(location.search);
  var startTime = parseInt(params.get('start'), 10);
  var hasStartTime = startTime > 0;

  function decorateEmbedUrl(value) {
    if (typeof value !== 'string' || value.indexOf('/embed/') === -1) return value;
    if (value.indexOf('autoplay=1') === -1) {
      var autoplaySep = value.indexOf('?') !== -1 ? '&' : '?';
      value = value + autoplaySep + 'autoplay=1';
    }
    if (hasStartTime && value.indexOf('start=') === -1) {
      var startSep = value.indexOf('?') !== -1 ? '&' : '?';
      value = value + startSep + 'start=' + startTime;
    }
    return value;
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
        return origSet.call(this, decorateEmbedUrl(value));
      }
    });
  }

  // Also handle setAttribute("src", ...) for safety
  var origSetAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function(name, value) {
    if (this.tagName === 'IFRAME' && name === 'src' && typeof value === 'string') {
      value = decorateEmbedUrl(value);
    }
    return origSetAttribute.call(this, name, value);
  };
})();
