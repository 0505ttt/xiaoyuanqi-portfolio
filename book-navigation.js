(function(global){
  'use strict';

  global.createBookNavigation = function(options){
    var book = options.book, track = options.track;
    if (!book || !track) throw new Error('Book navigation requires a book and track.');

    // WheelEvent has no portable "new physical gesture" flag. Quiet, deliberate
    // reversal, axis changes and acceleration after decay are conservative hints;
    // they cannot perfectly classify every operating system's momentum stream.
    var QUIET_MS = 140, DECAY_RATIO = 0.55, ACCEL_RATIO = 2.4;
    var ACCEL_MIN = 18, REVERSE_MIN = 4, AXIS_RATIO = 1.6;
    var pages = [], width = 1, restIndex = 0;
    var gesture = null, quietTimer = 0, motion = null, idleAligned = false;
    var frozen = false, resumeIndex = 0;
    var stability = null, alignedLeft = 0;
    var nativeTouch = null, nativeTimer = 0, nativeFrame = 0, nativeGeneration = 0;
    var touchBlocked = false, NATIVE_QUIET_MS = 180;

    function clamp(value, min, max){ return Math.max(min, Math.min(max, value)); }
    function indexInRange(index){ return clamp(index, 0, Math.max(0, pages.length - 1)); }
    function refresh(){
      pages = Array.prototype.slice.call(track.querySelectorAll('.page'));
      width = Math.max(1, book.clientWidth);
      restIndex = indexInRange(restIndex);
    }
    function nearest(left){
      var best = 0, distance = Infinity;
      pages.forEach(function(page, index){
        var next = Math.abs(page.offsetLeft - left);
        if (next < distance){ best = index; distance = next; }
      });
      return best;
    }
    function reader(){ return options.getReader ? options.getReader() : null; }
    function notifyReader(){
      var current = reader();
      if (current && current.refresh) current.refresh();
    }
    function scaled(){ return global.visualViewport && global.visualViewport.scale > 1.01; }
    function nativeMoving(){ return nativeTouch && nativeTouch.axis === 'x'; }
    function ready(index){
      restIndex = index; alignedLeft = book.scrollLeft; idleAligned = true; notifyReader();
    }
    function cancelStability(){
      if (stability && stability.frame) global.cancelAnimationFrame(stability.frame);
      stability = null; idleAligned = false;
    }
    function stableAt(index, initialFrames){
      cancelStability();
      if (frozen || !pages[index]) return;
      var current = { index: index, count: initialFrames || 0, left: book.scrollLeft, frame: 0 };
      stability = current;
      function step(){
        if (stability !== current) return;
        if (frozen || motion || (gesture && gesture.axis === 'x') || nativeMoving() || touchBlocked || scaled()){
          stability = null; return;
        }
        var left = book.scrollLeft;
        if (Math.abs(left - pages[index].offsetLeft) > 1){ stability = null; return; }
        current.count = Math.abs(left - current.left) <= 0.1 ? current.count + 1 : 1;
        current.left = left;
        if (current.count >= 3){ stability = null; ready(index); }
        else current.frame = global.requestAnimationFrame(step);
      }
      current.frame = global.requestAnimationFrame(step);
    }
    function write(left){
      if (frozen || !pages.length) return;
      idleAligned = false;
      left = clamp(left, pages[0].offsetLeft, pages[pages.length - 1].offsetLeft);
      var lenis = options.getLenis ? options.getLenis() : null;
      // Both direct following and our cancellable animation have one position
      // owner. Lenis must not independently integrate the original wheel event.
      if (lenis) lenis.scrollTo(left, { immediate: true });
      else book.scrollLeft = left;
    }
    function cancelMotion(){
      if (motion && motion.frame) global.cancelAnimationFrame(motion.frame);
      motion = null;
    }
    function animateTo(index, immediate){
      if (frozen) return;
      cancelMotion(); cancelStability();
      if (!pages.length) return;
      index = indexInRange(index);
      var target = pages[index].offsetLeft, from = book.scrollLeft;
      if (immediate || options.reduced || Math.abs(target - from) <= 1){
        write(target); stableAt(index); return;
      }
      var current = {
        index: index, from: from, target: target, start: global.performance.now(),
        duration: clamp(Math.abs(target - from) * 0.3, 180, 360), frame: 0, stable: 0
      };
      motion = current;
      function step(now){
        if (motion !== current) return;
        var t = clamp((now - current.start) / current.duration, 0, 1);
        if (t < 1){
          write(current.from + (current.target - current.from) * (1 - Math.pow(1 - t, 3)));
          current.frame = global.requestAnimationFrame(step);
          return;
        }
        write(current.target);
        motion = null; stableAt(current.index, 1);
      }
      current.frame = global.requestAnimationFrame(step);
    }
    function isSettled(page){
      return !frozen && idleAligned && pages[restIndex] === page && !motion &&
        !(gesture && gesture.axis === 'x') && !nativeMoving() && !touchBlocked && !scaled() &&
        Math.abs(book.scrollLeft - alignedLeft) <= 0.1 && Math.abs(book.scrollLeft - page.offsetLeft) <= 1;
    }
    function snapIndex(current){
      var threshold = clamp(width * 0.12, 48, 160);
      return indexInRange(current.base + (Math.abs(current.travel) >= threshold ? (current.travel > 0 ? 1 : -1) : 0));
    }
    function landingIndex(){
      if (motion) return motion.index;
      if (gesture && gesture.axis === 'x') return snapIndex(gesture);
      return nearest(book.scrollLeft);
    }
    function clearGesture(){
      global.clearTimeout(quietTimer); quietTimer = 0; gesture = null;
    }
    function clearNativeTimers(){
      global.clearTimeout(nativeTimer); nativeTimer = 0;
      if (nativeFrame) global.cancelAnimationFrame(nativeFrame);
      nativeFrame = 0;
    }
    function cancelNative(){
      var wasMoving = nativeMoving() || touchBlocked;
      nativeGeneration++; clearNativeTimers(); nativeTouch = null; touchBlocked = false;
      if (wasMoving) cancelStability();
    }
    function goTo(left, settings){
      if (frozen) return;
      clearGesture(); cancelNative();
      animateTo(nearest(left), settings && settings.immediate);
    }
    function atBoundary(page, direction){
      var current = reader();
      if (current && current.page === page) return current.canLeave(direction);
      return direction > 0 ? page.scrollTop + page.clientHeight >= page.scrollHeight - 1 : page.scrollTop <= 1;
    }
    function readPage(page, delta){
      var current = reader();
      if (current && current.page === page) current.scrollBy(delta);
      else page.scrollTop += delta;
    }
    function beginsGesture(axis, sign, magnitude, now){
      if (!gesture || now - gesture.at >= QUIET_MS) return true;
      if (axis !== gesture.axis && magnitude >= REVERSE_MIN) return true;
      if (sign !== gesture.sign && magnitude >= REVERSE_MIN) return true;
      return gesture.decayed && magnitude >= Math.max(ACCEL_MIN, gesture.last * ACCEL_RATIO);
    }
    function startGesture(axis, sign, magnitude, now){
      var landing = landingIndex(), base = nearest(book.scrollLeft);
      var needsLanding = motion || !idleAligned || (gesture && gesture.axis === 'x') ||
        !pages[base] || Math.abs(book.scrollLeft - pages[base].offsetLeft) > 1;
      var current = {
        axis: axis, sign: sign, at: now, last: magnitude, peak: magnitude, decayed: false,
        base: base, travel: 0, mode: axis === 'x' ? 'follow' : 'read', eligible: false
      };
      gesture = current;
      if (axis === 'y'){
        if (needsLanding){ current.mode = 'landing'; animateTo(landing); }
        else current.eligible = atBoundary(pages[base], sign);
      }
      return current;
    }
    function remember(current, sign, magnitude, now){
      current.peak = Math.max(current.peak, magnitude);
      if (current.peak >= 8 && magnitude <= current.peak * DECAY_RATIO) current.decayed = true;
      current.last = magnitude; current.sign = sign; current.at = now;
      global.clearTimeout(quietTimer);
      quietTimer = global.setTimeout(function(){
        if (gesture !== current) return;
        gesture = null; quietTimer = 0;
        if (current.axis === 'x') animateTo(snapIndex(current));
      }, QUIET_MS);
    }
    function consume(event){ event.preventDefault(); event.stopImmediatePropagation(); }
    function localControl(event){
      return event.target && event.target.closest && event.target.closest(
        'input,textarea,select,[contenteditable]:not([contenteditable="false"])'
      );
    }
    function wheel(event){
      if (event.ctrlKey || scaled()){ suspend(); return; }
      if (nativeTouch || nativeTimer || nativeFrame || touchBlocked) cancelNative();
      if (!pages.length) return;
      var unit = event.deltaMode === 1 ? 100 / 6 : event.deltaMode === 2 ? global.innerHeight : 1;
      var dx = event.deltaX * unit, dy = event.deltaY * unit;
      if (!dx && !dy) return;
      if (frozen){ consume(event); return; }
      var control = localControl(event);
      if (control){
        // Native vertical form behavior remains native. For mixed/horizontal
        // input, cancel the ancestor's default X scroll and apply both axes to
        // the form itself, whose native scroll bounds prevent outward chaining.
        if (dx){ consume(event); control.scrollLeft += dx; control.scrollTop += dy; }
        return;
      }
      var absX = Math.abs(dx), absY = Math.abs(dy);
      var axis = absX > absY ? 'x' : 'y';
      // Keep small cross-axis noise inside the existing gesture. A clearly
      // dominant new axis is accepted immediately, without a time-based lock.
      if (gesture && axis !== gesture.axis &&
          (Math.max(absX, absY) < REVERSE_MIN || Math.max(absX, absY) < Math.min(absX, absY) * AXIS_RATIO)) axis = gesture.axis;
      var delta = axis === 'x' ? dx : dy;
      if (!delta){ consume(event); return; }
      var magnitude = Math.abs(delta), sign = delta < 0 ? -1 : 1;
      var now = global.performance.now();
      var current = beginsGesture(axis, sign, magnitude, now) ? startGesture(axis, sign, magnitude, now) : gesture;
      consume(event);
      if (current.axis === 'x'){
        cancelMotion(); cancelStability();
        current.travel += dx;
        write(clamp(book.scrollLeft + dx, pages[indexInRange(current.base - 1)].offsetLeft,
          pages[indexInRange(current.base + 1)].offsetLeft));
      } else if (current.mode === 'read'){
        var page = pages[current.base];
        if (!isSettled(page)){ current.mode = 'landing'; animateTo(current.base); }
        else if (current.eligible){
          current.mode = 'turn';
          var next = indexInRange(current.base + current.sign);
          if (next !== current.base) animateTo(next);
        } else readPage(page, dy);
      }
      remember(current, sign, magnitude, now);
    }

    function nativeExcluded(event){
      return event.target && event.target.closest && event.target.closest(
        'input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="slider"],canvas,[data-touch-local]'
      );
    }
    function checkNativeEnd(current){
      clearNativeTimers();
      if (nativeTouch !== current || current.generation !== nativeGeneration || current.fingers ||
          !current.moved || frozen || touchBlocked || scaled()) return;
      var last = book.scrollLeft, count = 0;
      function step(){
        nativeFrame = 0;
        if (nativeTouch !== current || current.generation !== nativeGeneration || current.fingers ||
            frozen || touchBlocked || scaled() || motion || gesture) return;
        var left = book.scrollLeft;
        count = Math.abs(left - last) <= 0.1 ? count + 1 : 1; last = left;
        if (count < 3){ nativeFrame = global.requestAnimationFrame(step); return; }
        nativeTouch = null; nativeGeneration++;
        animateTo(nearest(left));
      }
      nativeFrame = global.requestAnimationFrame(step);
    }
    function waitNativeEnd(current){
      clearNativeTimers();
      if (!current || current.fingers || !current.moved) return;
      var generation = nativeGeneration;
      nativeTimer = global.setTimeout(function(){
        nativeTimer = 0;
        if (generation === nativeGeneration) checkNativeEnd(current);
      }, NATIVE_QUIET_MS);
    }
    function touchStart(event){
      var pending = motion || stability || (gesture && gesture.axis === 'x') || nativeMoving() || touchBlocked;
      clearGesture(); cancelMotion(); cancelNative();
      if (pending) cancelStability();
      if (frozen) return;
      if (event.touches.length !== 1 || scaled()){
        touchBlocked = true; cancelStability(); return;
      }
      if (nativeExcluded(event)) return;
      var point = event.touches[0];
      nativeTouch = { id: point.identifier, x: point.clientX, y: point.clientY, axis: null,
        fingers: true, moved: false, left: book.scrollLeft, scrolled: false, generation: nativeGeneration };
      if (!idleAligned && Math.abs(book.scrollLeft - pages[nearest(book.scrollLeft)].offsetLeft) <= 1){
        stableAt(nearest(book.scrollLeft));
      }
    }
    function touchMove(event){
      var current = nativeTouch;
      if (!current) return;
      if (event.touches.length !== 1 || event.touches[0].identifier !== current.id || scaled()){
        cancelNative(); touchBlocked = true; cancelStability(); return;
      }
      var point = event.touches[0], dx = Math.abs(point.clientX - current.x), dy = Math.abs(point.clientY - current.y);
      if (!current.axis && Math.max(dx, dy) >= 6){
        if (dx >= dy * 1.25){ current.axis = 'x'; cancelStability(); }
        else if (dy >= dx * 1.25) current.axis = 'y';
      }
    }
    function touchEnd(event){
      if (event.touches.length) return;
      if (touchBlocked){ cancelNative(); return; }
      var current = nativeTouch;
      if (!current) return;
      current.fingers = false;
      if (current.axis === 'x' && current.moved) waitNativeEnd(current);
      else {
        nativeTouch = null;
        var index = nearest(book.scrollLeft);
        if (!idleAligned && Math.abs(book.scrollLeft - pages[index].offsetLeft) <= 1) stableAt(index);
      }
    }

    // Let excluded controls keep native wheel bubbling without handing their
    // events to Lenis's wrapper listener as a second horizontal scroll owner.
    track.setAttribute('data-lenis-prevent-wheel', '');
    refresh(); restIndex = nearest(book.scrollLeft);
    if (pages.length) stableAt(restIndex);
    book.addEventListener('wheel', wheel, { capture: true, passive: false });
    book.addEventListener('touchstart', touchStart, { capture: true, passive: true });
    book.addEventListener('touchmove', touchMove, { capture: true, passive: true });
    book.addEventListener('touchend', touchEnd, { capture: true, passive: true });
    book.addEventListener('touchcancel', function(){ cancelNative(); }, { capture: true, passive: true });
    book.addEventListener('scrollend', function(event){
      if (event.target !== book || motion || gesture || frozen || !nativeTouch || !nativeTouch.scrolled) return;
      checkNativeEnd(nativeTouch);
    }, { passive: true });
    book.addEventListener('scroll', function(event){
      if (event.target !== book) return;
      if (frozen || motion || (gesture && gesture.axis === 'x') || !pages.length) return;
      if (nativeTouch){
        if (Math.abs(book.scrollLeft - nativeTouch.left) > 0.1){
          nativeTouch.axis = 'x'; nativeTouch.moved = true; nativeTouch.scrolled = true;
          nativeTouch.left = book.scrollLeft; cancelStability();
          if (!nativeTouch.fingers) waitNativeEnd(nativeTouch);
        }
        return;
      }
      if (touchBlocked || scaled()) return;
      var index = nearest(book.scrollLeft);
      if (Math.abs(book.scrollLeft - pages[index].offsetLeft) > 1){
        // Focus, scrollbar dragging and browser restoration can move the book
        // without touch/wheel ownership. Give those moves the same cancellable
        // idle completion rather than leaving every reader permanently gated.
        cancelStability();
        nativeTouch = { axis: 'x', fingers: false, moved: true, left: book.scrollLeft,
          scrolled: true, generation: nativeGeneration };
        waitNativeEnd(nativeTouch); return;
      }
      if (idleAligned && index === restIndex && Math.abs(book.scrollLeft - alignedLeft) <= 0.1) return;
      if (!stability) stableAt(index);
    }, { passive: true });
    global.addEventListener('resize', function(){
      if (frozen){ refresh(); resumeIndex = indexInRange(resumeIndex); return; }
      if (scaled()){ suspend(); refresh(); return; }
      var index = motion ? motion.index : gesture && gesture.axis === 'x' ? snapIndex(gesture) : restIndex;
      clearGesture(); cancelMotion(); cancelNative(); refresh(); animateTo(index, true);
    }, { passive: true });
    function suspend(){ clearGesture(); cancelMotion(); cancelNative(); cancelStability(); }
    global.addEventListener('blur', suspend);
    global.addEventListener('aboutopen', function(){
      if (frozen) return;
      // Cancel the old destination. Closing starts a new short snap from the
      // actual frozen position, after the page has restarted Lenis.
      resumeIndex = nearest(book.scrollLeft);
      frozen = true; suspend();
    });
    global.addEventListener('aboutclose', function(){
      if (!frozen) return;
      frozen = false; refresh(); animateTo(resumeIndex);
    });
    if (global.document) global.document.addEventListener('visibilitychange', function(){
      if (global.document.hidden) suspend();
    });
    if (global.document) global.document.addEventListener('keydown', function(event){
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].indexOf(event.key) < 0 || nativeExcluded(event)) return;
      if (frozen) return;
      var pending = motion || nativeMoving() || touchBlocked || (gesture && gesture.axis === 'x') || !idleAligned;
      clearGesture(); cancelMotion(); cancelNative();
      if (!pending) return;
      cancelStability();
      // Horizontal keys are routed by the existing site handler. A vertical key
      // during travel only completes the nearest landing, never its inner read.
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight'){
        if (event.cancelable !== false) event.preventDefault();
        animateTo(nearest(book.scrollLeft));
      }
    }, { capture: true });
    if (global.visualViewport && global.visualViewport.addEventListener){
      global.visualViewport.addEventListener('resize', function(){
        if (scaled()) suspend();
      }, { passive: true });
    }
    return { goTo: goTo, isSettled: isSettled, refresh: refresh };
  };
})(window);
