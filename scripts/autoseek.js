(function() {
  var params = new URLSearchParams(location.search);
  var startTime = parseInt(params.get('start'), 10);

  if (!(startTime > 0)) return;

  var seekDone = false;
  var attempts = 0;
  var maxAttempts = 120; // ~60 seconds (500ms * 120)

  function getPlayer() {
    if (typeof jwplayer === 'function') {
      try {
        var p = jwplayer();
        if (p && typeof p.seek === 'function') return p;
      } catch (e) {}
    }
    if (window.jwplayer && typeof window.jwplayer === 'function') {
      try {
        var p2 = window.jwplayer();
        if (p2 && typeof p2.seek === 'function') return p2;
      } catch (e) {}
    }
    return null;
  }

  function attemptSeek() {
    if (seekDone) return;
    if (++attempts > maxAttempts) return;

    var player = getPlayer();
    if (player) {
      // Wait for player to know its duration; hook into 'firstFrame' or 'play' for reliable seek
      var doSeek = function() {
        if (seekDone) return;
        try {
          var dur = player.getDuration ? player.getDuration() : 0;
          if (dur > 0 && startTime < dur - 5) {
            player.seek(startTime);
            seekDone = true;
          }
        } catch (e) {}
      };

      // Try immediately, then on key events
      doSeek();
      if (!seekDone) {
        try {
          player.on('firstFrame', doSeek);
          player.on('play', doSeek);
          player.on('time', function tick(ev) {
            if (seekDone) {
              player.off && player.off('time', tick);
              return;
            }
            doSeek();
          });
        } catch (e) {}
      }
      return;
    }

    setTimeout(attemptSeek, 500);
  }

  setTimeout(attemptSeek, 500);
})();
