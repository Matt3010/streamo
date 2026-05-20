(function() {
  var params = new URLSearchParams(location.search);
  var startTime = parseInt(params.get('start'), 10);
  var shouldSeek = startTime > 0;

  var seekDone = !shouldSeek;
  var activeVideo = null;
  var activePlayer = null;
  var activeNextButton = null;
  var videoCleanup = null;
  var playerCleanup = null;
  var nextButtonCleanup = null;
  var syncTimer = null;
  var observer = null;
  var completionSent = false;
  var nativeNextEpisodeFallback = false;
  var nextEpisodeAckTimer = null;
  var attempts = 0;
  var maxAttempts = 240; // ~120s

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
      return document.querySelector('.jw-video, video');
    } catch (e) {
      return null;
    }
  }

  function getNextEpisodeButton() {
    try {
      return document.querySelector('.jw-icon-next, .jw-icon-next-episode');
    } catch (e) {
      return null;
    }
  }

  function emitToParent(eventName, currentTime, duration) {
    try {
      if (!window.parent || window.parent === window) return;
      // The iframe is served through nginx with sub_filter rewrites, so its
      // origin matches the parent's origin. Targeting that explicitly (rather
      // than '*') prevents the message from being delivered if the iframe
      // ever ends up on a different origin (e.g. direct vixcloud.co load).
      window.parent.postMessage({
        type: 'PLAYER_EVENT',
        event: {
          event: eventName,
          currentTime: typeof currentTime === 'number' && isFinite(currentTime) ? currentTime : undefined,
          duration: typeof duration === 'number' && isFinite(duration) ? duration : undefined
        }
      }, window.location.origin);
    } catch (e) {}
  }

  function resetCompletion() {
    completionSent = false;
  }

  function emitComplete(currentTime, duration) {
    if (completionSent) return;
    completionSent = true;
    emitToParent('complete', currentTime, duration);
  }

  function clearNextEpisodeAckTimer() {
    if (!nextEpisodeAckTimer) return;
    clearTimeout(nextEpisodeAckTimer);
    nextEpisodeAckTimer = null;
  }

  function handleBridgeAck(event) {
    if (!event || event.source !== window.parent) return;
    var data = event.data;
    if (!data || typeof data !== 'object') return;
    if (data.type !== 'PLAYER_BRIDGE_ACK' || data.event !== 'next-episode') return;
    clearNextEpisodeAckTimer();
    nativeNextEpisodeFallback = false;
  }

  function maybeSeekVideo(video) {
    if (!video || seekDone || !shouldSeek) return;
    try {
      var dur = video.duration;
      if (typeof dur === 'number' && isFinite(dur) && dur > 0 && startTime < dur - 5) {
        video.currentTime = startTime;
        seekDone = true;
      }
    } catch (e) {}
  }

  function maybeSeekPlayer(player) {
    if (!player || seekDone || !shouldSeek || typeof player.seek !== 'function') return;
    try {
      var dur = typeof player.getDuration === 'function' ? player.getDuration() : 0;
      if (typeof dur === 'number' && isFinite(dur) && dur > 0 && startTime < dur - 5) {
        player.seek(startTime);
        seekDone = true;
      }
    } catch (e) {}
  }

  function attachVideo(video) {
    if (!video || video === activeVideo) return;
    if (videoCleanup) {
      videoCleanup();
      videoCleanup = null;
    }

    activeVideo = video;
    try {
      video.playsInline = true;
      video.setAttribute('playsinline', '');
      video.setAttribute('webkit-playsinline', 'true');
    } catch (e) {}

    function emit(eventName) {
      emitToParent(eventName, video.currentTime, video.duration);
    }

    function onReady() {
      maybeSeekVideo(video);
      emit('ready');
    }
    function onPlay() {
      resetCompletion();
      maybeSeekVideo(video);
      emit('play');
    }
    function onPlaying() {
      resetCompletion();
      maybeSeekVideo(video);
      emit('playing');
    }
    function onPause() { emit('pause'); }
    function onTime() {
      maybeSeekVideo(video);
      emit('time');
    }
    function onSeeked() { emit('seek'); }
    function onEnded() { emitComplete(video.duration, video.duration); }
    function onError() { emit('error'); }

    video.addEventListener('loadedmetadata', onReady);
    video.addEventListener('loadeddata', onReady);
    video.addEventListener('durationchange', onReady);
    video.addEventListener('canplay', onReady);
    video.addEventListener('play', onPlay);
    video.addEventListener('playing', onPlaying);
    video.addEventListener('pause', onPause);
    video.addEventListener('timeupdate', onTime);
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('ended', onEnded);
    video.addEventListener('error', onError);

    if (video.readyState >= 1) {
      onReady();
    }

    videoCleanup = function() {
      video.removeEventListener('loadedmetadata', onReady);
      video.removeEventListener('loadeddata', onReady);
      video.removeEventListener('durationchange', onReady);
      video.removeEventListener('canplay', onReady);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('timeupdate', onTime);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('ended', onEnded);
      video.removeEventListener('error', onError);
    };
  }

  function attachPlayer(player) {
    if (!player || player === activePlayer) return;
    if (playerCleanup) {
      playerCleanup();
      playerCleanup = null;
    }

    activePlayer = player;

    function readPosition(payload) {
      if (payload && typeof payload.position === 'number') return payload.position;
      try {
        if (typeof player.getPosition === 'function') return player.getPosition();
      } catch (e) {}
      return undefined;
    }

    function readDuration(payload) {
      if (payload && typeof payload.duration === 'number') return payload.duration;
      try {
        if (typeof player.getDuration === 'function') return player.getDuration();
      } catch (e) {}
      return undefined;
    }

    function emit(eventName, payload) {
      emitToParent(eventName, readPosition(payload), readDuration(payload));
    }

    var listeners = [
      ['ready', function() { maybeSeekPlayer(player); emit('ready'); }],
      ['firstFrame', function() { maybeSeekPlayer(player); emit('playing'); }],
      ['play', function() {
        resetCompletion();
        maybeSeekPlayer(player);
        emit('play');
      }],
      ['pause', function() { emit('pause'); }],
      ['time', function(payload) { maybeSeekPlayer(player); emit('time', payload); }],
      ['seek', function(payload) { emit('seek', payload); }],
      ['complete', function() {
        var dur = readDuration();
        emitComplete(dur, dur);
      }],
      ['error', function() { emit('error'); }]
    ];

    for (var i = 0; i < listeners.length; i += 1) {
      try {
        player.on(listeners[i][0], listeners[i][1]);
      } catch (e) {}
    }

    maybeSeekPlayer(player);

    playerCleanup = function() {
      for (var j = 0; j < listeners.length; j += 1) {
        try {
          if (typeof player.off === 'function') {
            player.off(listeners[j][0], listeners[j][1]);
          }
        } catch (e) {}
      }
    };
  }

  function attachNextEpisodeButton(button) {
    if (!button || button === activeNextButton) return;
    if (nextButtonCleanup) {
      nextButtonCleanup();
      nextButtonCleanup = null;
    }

    activeNextButton = button;

    function onClick(event) {
      if (nativeNextEpisodeFallback) {
        nativeNextEpisodeFallback = false;
        return;
      }

      try {
        if (event) {
          event.preventDefault();
          event.stopPropagation();
          if (typeof event.stopImmediatePropagation === 'function') {
            event.stopImmediatePropagation();
          }
        }
      } catch (e) {}

      clearNextEpisodeAckTimer();
      emitToParent('next-episode');
      nextEpisodeAckTimer = window.setTimeout(function() {
        nextEpisodeAckTimer = null;
        if (!button.isConnected) return;
        nativeNextEpisodeFallback = true;
        try {
          button.click();
        } catch (e) {
          nativeNextEpisodeFallback = false;
        }
      }, 1500);
    }

    button.addEventListener('click', onClick, true);

    nextButtonCleanup = function() {
      button.removeEventListener('click', onClick, true);
    };
  }

  function sync() {
    attachVideo(getVideo());
    attachPlayer(getPlayer());
    attachNextEpisodeButton(getNextEpisodeButton());
  }

  function bootstrap() {
    attempts += 1;
    sync();

    if (activeVideo || activePlayer) {
      if (!observer && typeof MutationObserver !== 'undefined' && document.documentElement) {
        observer = new MutationObserver(sync);
        observer.observe(document.documentElement, { childList: true, subtree: true });
      }
      if (!syncTimer) {
        syncTimer = window.setInterval(sync, 1000);
      }
    }

    if ((activeVideo || activePlayer) && seekDone) return;
    if (attempts >= maxAttempts) return;
    setTimeout(bootstrap, 500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
  } else {
    bootstrap();
  }

  window.addEventListener('message', handleBridgeAck);
})();
