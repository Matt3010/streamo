(function() {
  var params = new URLSearchParams(location.search);
  var startTime = parseInt(params.get('start'), 10);
  var shouldSeek = startTime > 0;

  var playerAttached = false;
  var seekDone = !shouldSeek;
  var attempts = 0;
  var maxAttempts = 120; // ~60 seconds (500ms * 120)

  function getPlayer() {
    if (typeof jwplayer === 'function') {
      try {
        var p = jwplayer();
        if (p && typeof p.on === 'function') return p;
      } catch (e) {}
    }
    if (window.jwplayer && typeof window.jwplayer === 'function') {
      try {
        var p2 = window.jwplayer();
        if (p2 && typeof p2.on === 'function') return p2;
      } catch (e) {}
    }
    return null;
  }

  function readCurrentTime(player, fallback) {
    if (typeof fallback === 'number') return fallback;
    try {
      if (player && typeof player.getPosition === 'function') {
        var pos = player.getPosition();
        if (typeof pos === 'number' && pos >= 0) return pos;
      }
    } catch (e) {}
    return undefined;
  }

  function readDuration(player, fallback) {
    if (typeof fallback === 'number' && fallback > 0) return fallback;
    try {
      if (player && typeof player.getDuration === 'function') {
        var dur = player.getDuration();
        if (typeof dur === 'number' && dur > 0) return dur;
      }
    } catch (e) {}
    return undefined;
  }

  function emitToParent(eventName, player, payload) {
    try {
      if (!window.parent || window.parent === window) return;
      var currentTime = readCurrentTime(player, payload && payload.position);
      var duration = readDuration(player, payload && payload.duration);
      window.parent.postMessage({
        type: 'PLAYER_EVENT',
        event: {
          event: eventName,
          currentTime: currentTime,
          duration: duration
        }
      }, '*');
    } catch (e) {}
  }

  function trySeek(player) {
    if (seekDone || !shouldSeek) return;
    try {
      var dur = readDuration(player);
      if (typeof dur === 'number' && dur > 0 && startTime < dur - 5) {
        player.seek(startTime);
        seekDone = true;
      }
    } catch (e) {}
  }

  function attachPlayer(player) {
    if (!player || playerAttached) return true;
    playerAttached = true;

    try {
      player.on('ready', function() {
        emitToParent('ready', player);
        trySeek(player);
      });
      player.on('firstFrame', function() {
        emitToParent('playing', player);
        trySeek(player);
      });
      player.on('play', function() {
        emitToParent('play', player);
        trySeek(player);
      });
      player.on('pause', function() {
        emitToParent('pause', player);
      });
      player.on('time', function(ev) {
        emitToParent('time', player, ev || {});
        trySeek(player);
      });
      player.on('seek', function(ev) {
        emitToParent('seek', player, ev || {});
      });
      player.on('complete', function() {
        emitToParent('complete', player, {
          position: readDuration(player),
          duration: readDuration(player)
        });
      });
      player.on('error', function() {
        emitToParent('error', player);
      });
    } catch (e) {}

    return true;
  }

  function bootstrap() {
    if (++attempts > maxAttempts) return;
    var player = getPlayer();
    if (attachPlayer(player)) {
      trySeek(player);
      if (playerAttached && seekDone) return;
    }
    setTimeout(bootstrap, 500);
  }

  setTimeout(bootstrap, 500);
})();
