/* Dot — iSell's mascot, using the official 3D renders (img/dot-*.webp), animated with CSS.
   dotHTML(mood, extraClass) → markup. Moods: main, hello, thinking, paid, oops.
   dotHead(extraClass)       → Dot's head (chat button / avatar). */
'use strict';
(function () {
  const POSES = ['main', 'hello', 'thinking', 'paid', 'oops'];
  window.dotHTML = function (mood, cls) {
    const m = POSES.includes(mood) ? mood : 'hello';
    return `<span class="dot3d m-${m} ${cls || ''}"><span class="sh" aria-hidden="true"></span><img src="img/dot-${m}.webp" alt="Dot" draggable="false"></span>`;
  };
  window.dotHead = function (cls) {
    return `<span class="dothd ${cls || ''}"><img src="img/dot-head.webp" alt="Dot" draggable="false"></span>`;
  };
})();
