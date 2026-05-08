(function() {
  // Override Function constructor to strip debugger statements
  var OrigFunction = Function;
  Function = function() {
    var args = Array.prototype.slice.call(arguments);
    if (args.length > 0) {
      args[args.length - 1] = args[args.length - 1].replace(/debugger\s*;?/gi, '');
    }
    return OrigFunction.apply(this, args);
  };
  Function.prototype = OrigFunction.prototype;
  Object.setPrototypeOf(Function, OrigFunction);

  // Override eval to strip debugger
  var origEval = window.eval;
  window.eval = function(code) {
    if (typeof code === 'string') code = code.replace(/debugger\s*;?/gi, '');
    return origEval.call(window, code);
  };

  // Disable console.clear
  console.clear = function() {};

  // Block setInterval/setTimeout debugger traps
  var origSetInterval = window.setInterval;
  window.setInterval = function(fn, delay) {
    if (typeof fn === 'string' && fn.includes('debugger')) return 0;
    if (typeof fn === 'function' && fn.toString().includes('debugger')) return 0;
    return origSetInterval.apply(this, arguments);
  };

  var origSetTimeout = window.setTimeout;
  window.setTimeout = function(fn, delay) {
    if (typeof fn === 'string' && fn.includes('debugger')) return 0;
    if (typeof fn === 'function' && fn.toString().includes('debugger')) return 0;
    return origSetTimeout.apply(this, arguments);
  };
})();
