(function() {
  var STYLE_ID = 'hide-player-elements-style';
  var SELECTORS = [
    '.back-icon',
    '.jw-icon.next-episode'
  ];
  var CSS = SELECTORS.join(', ') + ' { display: none !important; }';

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
