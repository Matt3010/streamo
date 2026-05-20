(function() {
  var STYLE_ID = 'mobile-player-controls-style';
  var CSS = [
    '@media (max-width: 640px) {',
    '  .jw-display-controls {',
    '    padding: 0.55rem 0.8rem 0.95rem;',
    '    box-sizing: border-box;',
    '  }',
    '  .jw-display-controls .jw-display-icon-container,',
    '  .jw-display-controls .jw-text-duration,',
    '  .jw-display-controls .jw-slider-time,',
    '  .jw-display-controls .jw-button-container {',
    '    margin-top: 0.35rem;',
    '    margin-bottom: 0.35rem;',
    '  }',
    '  .jw-display-controls .jw-display-icon-container {',
    '    transform: scale(0.78);',
    '    transform-origin: center center;',
    '  }',
    '  .jw-display-controls .jw-button-container {',
    '    gap: 0.75rem;',
    '  }',
    '  .jw-display-controls .jw-slider-time {',
    '    margin-left: 0.45rem;',
    '    margin-right: 0.45rem;',
    '  }',
    '}'
  ].join('\n');

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    (document.head || document.documentElement).appendChild(style);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectStyle, { once: true });
    return;
  }

  injectStyle();
})();
