(function() {
  // Read start time from outer URL (set by app.js via /player/movie/X?start=N)
  var params = new URLSearchParams(location.search);
  var startTime = parseInt(params.get('start'), 10);

  if (!(startTime > 0)) return;

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
        if (typeof value === 'string' && value.indexOf('/embed/') !== -1 && value.indexOf('start=') === -1) {
          var sep = value.indexOf('?') !== -1 ? '&' : '?';
          value = value + sep + 'start=' + startTime;
        }
        return origSet.call(this, value);
      }
    });
  }

  // Also handle setAttribute("src", ...) for safety
  var origSetAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function(name, value) {
    if (this.tagName === 'IFRAME' && name === 'src' && typeof value === 'string' &&
        value.indexOf('/embed/') !== -1 && value.indexOf('start=') === -1) {
      var sep = value.indexOf('?') !== -1 ? '&' : '?';
      value = value + sep + 'start=' + startTime;
    }
    return origSetAttribute.call(this, name, value);
  };
})();
