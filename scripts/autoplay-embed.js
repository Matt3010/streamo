(function() {
  var attempts = 0;
  var maxAttempts = 120; // ~60s
  var started = false;

  function getPlayer() {
    if (typeof jwplayer === 'function') {
      try {
        var p = jwplayer();
        if (p && typeof p.play === 'function') return p;
      } catch (e) {}
    }
    if (window.jwplayer && typeof window.jwplayer === 'function') {
      try {
        var p2 = window.jwplayer();
        if (p2 && typeof p2.play === 'function') return p2;
      } catch (e) {}
    }
    return null;
  }

  function clickFallbackPlayButton() {
    var selectors = [
      '.jw-display-icon-container',
      '.jw-icon-playback',
      '.jw-display-icon-rewind',
      '[aria-label="Play"]',
      '[aria-label="play"]',
      'button[title="Play"]',
      'button[title="play"]'
    ];

    for (var i = 0; i < selectors.length; i += 1) {
      var el = document.querySelector(selectors[i]);
      if (el instanceof HTMLElement) {
        el.click();
        return true;
      }
    }
    return false;
  }

  function tryAutoplay() {
    if (started) return;
    if (++attempts > maxAttempts) return;

    var player = getPlayer();
    if (player) {
      try {
        player.play();
        started = true;
        return;
      } catch (e) {}

      try {
        player.on('ready', function onReady() {
          if (started) return;
          try {
            player.play();
            started = true;
          } catch (e) {}
        });
        player.on('playlistItem', function onPlaylistItem() {
          if (started) return;
          try {
            player.play();
            started = true;
          } catch (e) {}
        });
      } catch (e) {}
    }

    if (clickFallbackPlayButton()) {
      started = true;
      return;
    }

    setTimeout(tryAutoplay, 500);
  }

  setTimeout(tryAutoplay, 250);
})();
