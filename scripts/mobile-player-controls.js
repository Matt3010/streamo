(function() {
  var STYLE_ID = 'mobile-player-controls-style';
  var CSS = [
    '@media (max-width: 640px) {',
    '  .jw-display-controls {',
    '    padding: 0.55rem 0.8rem 0.65rem;',
    '    box-sizing: border-box;',
    '  }',
    '  .jw-display-controls .jw-display-icon-container {',
    '    transform: scale(0.78);',
    '    transform-origin: center center;',
    '    margin-top: 0.25rem;',
    '    margin-bottom: 0.9rem;',
    '  }',
    '  .jw-controlbar {',
    '    padding: 0 0.8rem 0.8rem;',
    '    box-sizing: border-box;',
    '  }',
    '  .jw-controlbar .jw-slider-time {',
    '    margin: 0 0 0.8rem;',
    '  }',
    '  .jw-controlbar .jw-button-container {',
    '    margin-top: 0.1rem;',
    '    gap: 0.85rem;',
    '  }',
    '  .jw-controlbar .jw-text-duration {',
    '    margin-left: 0.55rem;',
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
