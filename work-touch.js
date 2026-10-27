(function(global){
  'use strict';

  // This bridge only owns a fresh WORK boundary pull, or reading blocked at a
  // native edge (including a collapsed page with no range). Other pans stay native.
  global.createWorkTouchBridge = function(options){
    var reader = options.reader, navigation = options.navigation, book = options.book;
    if (!reader || !reader.page || !navigation || !book) return null;
    var page = reader.page, touch = null;
    function cancel(){ touch = null; }
    function zoomed(){ return global.visualViewport && global.visualViewport.scale > 1.01; }
    function local(target){
      return target && target.closest && target.closest(
        'input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="slider"],canvas,[data-touch-local]'
      );
    }
    function available(){ return !zoomed() && navigation.isSettled(page); }

    page.setAttribute('data-lenis-prevent-touch', '');
    page.addEventListener('touchstart', function(event){
      cancel();
      if (event.touches.length !== 1 || zoomed() || local(event.target)) return;
      var point = event.touches[0];
      touch = {
        id: point.identifier, x: point.clientX, y: point.clientY, lastY: point.clientY,
        axis: null, direction: 0, submitted: false, reading: false, landing: !available(),
        up: reader.canLeave(-1), down: reader.canLeave(1),
        atTop: page.scrollTop <= 1,
        atBottom: page.scrollTop + page.clientHeight >= page.scrollHeight - 1
      };
    }, { passive: true });
    page.addEventListener('touchmove', function(event){
      if (!touch) return;
      if (event.touches.length !== 1 || event.touches[0].identifier !== touch.id ||
          !event.cancelable || zoomed() || local(event.target)){
        cancel(); return;
      }
      if (touch.submitted){ event.preventDefault(); return; }
      if (!touch.landing && !available()){ cancel(); return; }
      var point = event.touches[0], dx = touch.x - point.clientX, dy = touch.y - point.clientY;
      var step = touch.lastY - point.clientY;
      touch.lastY = point.clientY;
      if (!touch.axis){
        if (Math.max(Math.abs(dx), Math.abs(dy)) < 4) return;
        if (Math.abs(dx) > Math.abs(dy) * 1.25){ cancel(); return; }
        if (Math.abs(dy) < Math.abs(dx) * 1.25) return;
        touch.axis = 'y'; touch.direction = dy > 0 ? 1 : -1;
        if (touch.landing){
          event.preventDefault(); touch.submitted = true;
          navigation.goTo(page.offsetLeft);
          return;
        }
        var eligible = touch.direction > 0 ? touch.down : touch.up;
        touch.reading = !eligible && (touch.direction > 0 ? touch.atBottom : touch.atTop);
        if (!eligible && !touch.reading){ cancel(); return; }
        // Include the small undecided movement exactly once for local reading.
        step = dy;
      }
      event.preventDefault();
      if (touch.reading){ reader.scrollBy(step); return; }
      // Capture early, but submit only after a deliberate outward 64px pull.
      if (dy * touch.direction >= 64){
        touch.submitted = true;
        navigation.goTo(page.offsetLeft + touch.direction * book.clientWidth);
      }
    }, { passive: false });
    page.addEventListener('touchend', cancel, { passive: true });
    page.addEventListener('touchcancel', cancel, { passive: true });
    global.addEventListener('wheel', cancel, { capture: true, passive: true });
    global.addEventListener('blur', cancel);
    global.addEventListener('resize', cancel, { passive: true });
    global.addEventListener('aboutopen', cancel);
    if (global.document){
      global.document.addEventListener('keydown', cancel);
      global.document.addEventListener('visibilitychange', function(){ if (global.document.hidden) cancel(); });
    }
    return { cancel: cancel };
  };
})(window);
