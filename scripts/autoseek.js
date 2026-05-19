(function() {
  var params = new URLSearchParams(location.search);
  var startTime = parseInt(params.get('start'), 10);
  var shouldSeek = startTime > 0;

  var seekDone = !shouldSeek;
  var jwAttached = false;
  var videoAttached = false;
  var attempts = 0;
  var maxAttempts = 240; // ~120 seconds

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

  function getVideo() {
    try {
      return document.querySelector('video');
    } catch (e) {
      return null;
    }
  }

  function emitToParent(eventName, currentTime, duration) {
    try {
      if (!window.parent || window.parent === window) return;
      window.parent.postMessage({
        type: 'PLAYER_EVENT',
        event: {
          event: eventName,
          currentTime: typeof currentTime === 'number' ? currentTime : undefined,
          duration: typeof duration === 'number' ? duration : undefined
        }
      }, '*');
    } catch (e) {}
  }

  function trySeekVideo(video) {
    if (seekDone || !shouldSeek || !video) return;
    try {
      var dur = video.duration;
      if (typeof dur === 'number' && dur > 0 && startTime < dur - 5) {
        video.currentTime = startTime;
        seekDone = true;
      }
    } catch (e) {}
  }

  function trySeekPlayer(player) {
    if (seekDone || !shouldSeek || !player) return;
    try {
      var dur = typeof player.getDuration === 'function' ? player.getDuration() : 0;
      if (typeof dur === 'number' && dur > 0 && startTime < dur - 5) {
        player.seek(startTime);
        seekDone = true;
      }
    } catch (e) {}
  }

  function attachVideo(video) {
    if (!video || videoAttached) return;
    videoAttached = true;

    video.addEventListener('loadedmetadata', function() {
      trySeekVideo(video);
      emitToParent('ready', video.currentTime, video.duration);
    });
    video.addEventListener('play', function() {
      trySeekVideo(video);
      emitToParent('play', video.currentTime, video.duration);
    });
    video.addEventListener('playing', function() {
      trySeekVideo(video);
      emitToParent('playing', video.currentTime, video.duration);
    });
    video.addEventListener('pause', function() {
      emitToParent('pause', video.currentTime, video.duration);
    });
    video.addEventListener('timeupdate', function() {
      trySeekVideo(video);
      emitToParent('time', video.currentTime, video.duration);
    });
    video.addEventListener('seeked', function() {
      emitToParent('seek', video.currentTime, video.duration);
    });
    video.addEventListener('ended', function() {
      emitToParent('complete', video.duration, video.duration);
    });
    video.addEventListener('error', function() {
      emitToParent('error', video.currentTime, video.duration);
    });

    trySeekVideo(video);
  }

  function attachPlayer(player) {
    if (!player || jwAttached) return;
    jwAttached = true;

    try {
      player.on('ready', function() {
        trySeekPlayer(player);
        emitToParent('ready',
          typeof player.getPosition === 'function' ? player.getPosition() : undefined,
          typeof player.getDuration === 'function' ? player.getDuration() : undefined
        );
      });
      player.on('firstFrame', function() {
        trySeekPlayer(player);
        emitToParent('playing',
          typeof player.getPosition === 'function' ? player.getPosition() : undefined,
          typeof player.getDuration === 'function' ? player.getDuration() : undefined
        );
      });
      player.on('play', function() {
        trySeekPlayer(player);
        emitToParent('play',
          typeof player.getPosition === 'function' ? player.getPosition() : undefined,
          typeof player.getDuration === 'function' ? player.getDuration() : undefined
        );
      });
      player.on('pause', function() {
        emitToParent('pause',
          typeof player.getPosition === 'function' ? player.getPosition() : undefined,
          typeof player.getDuration === 'function' ? player.getDuration() : undefined
        );
      });
      player.on('time', function(ev) {
        trySeekPlayer(player);
        emitToParent('time',
          ev && typeof ev.position === 'number' ? ev.position : undefined,
          ev && typeof ev.duration === 'number' ? ev.duration : undefined
        );
      });
      player.on('seek', function(ev) {
        emitToParent('seek',
          ev && typeof ev.position === 'number' ? ev.position : undefined,
          ev && typeof ev.duration === 'number' ? ev.duration : undefined
        );
      });
      player.on('complete', function() {
        var dur = typeof player.getDuration === 'function' ? player.getDuration() : undefined;
        emitToParent('complete', dur, dur);
      });
      player.on('error', function() {
        emitToParent('error',
          typeof player.getPosition === 'function' ? player.getPosition() : undefined,
          typeof player.getDuration === 'function' ? player.getDuration() : undefined
        );
      });
    } catch (e) {}

    trySeekPlayer(player);
  }

  function bootstrap() {
    attempts += 1;
    attachVideo(getVideo());
    attachPlayer(getPlayer());

    if (seekDone && (videoAttached || jwAttached)) return;
    if (attempts >= maxAttempts) return;
    setTimeout(bootstrap, 500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
  } else {
    bootstrap();
  }
})();
