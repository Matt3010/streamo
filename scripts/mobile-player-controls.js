(function() {
  var STYLE_ID = 'mobile-player-controls-style';
  var CSS = [
    '@media (max-width: 640px) {',
    '  .jw-display-controls .jw-display-icon-container {',
    '    transform: translateY(-0.95rem) scale(0.72);',
    '    transform-origin: center center;',
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
