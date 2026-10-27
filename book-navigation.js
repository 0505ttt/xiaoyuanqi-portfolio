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
    function ready(index){ restIndex = index; idleAligned = true; notifyReader(); }
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
      cancelMotion();
      if (!pages.length) return;
      index = indexInRange(index);
      var target = pages[index].offsetLeft, from = book.scrollLeft;
      if (immediate || options.reduced || Math.abs(target - from) <= 1){
        write(target); ready(index); return;
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
        current.stable = Math.abs(book.scrollLeft - current.target) <= 1 ? current.stable + 1 : 0;
        if (current.stable < 3) current.frame = global.requestAnimationFrame(step);
        else { motion = null; ready(current.index); }
      }
      current.frame = global.requestAnimationFrame(step);
    }
    function isSettled(page){
      return !frozen && pages.indexOf(page) !== -1 && !motion &&
        !(gesture && gesture.axis === 'x') && Math.abs(book.scrollLeft - page.offsetLeft) <= 1;
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
    function goTo(left, settings){
      if (frozen) return;
      clearGesture();
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
      var needsLanding = motion || (gesture && gesture.axis === 'x') ||
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
      if (event.ctrlKey || !pages.length) return;
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
        cancelMotion();
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

    // Let excluded controls keep native wheel bubbling without handing their
    // events to Lenis's wrapper listener as a second horizontal scroll owner.
    track.setAttribute('data-lenis-prevent-wheel', '');
    refresh(); restIndex = nearest(book.scrollLeft);
    idleAligned = pages.length && Math.abs(book.scrollLeft - pages[restIndex].offsetLeft) <= 1;
    book.addEventListener('wheel', wheel, { capture: true, passive: false });
    book.addEventListener('scroll', function(){
      if (frozen || motion || gesture || !pages.length) return;
      var index = nearest(book.scrollLeft);
      if (Math.abs(book.scrollLeft - pages[index].offsetLeft) > 1){ idleAligned = false; return; }
      if (!idleAligned || index !== restIndex) ready(index);
    }, { passive: true });
    global.addEventListener('resize', function(){
      if (frozen){ refresh(); resumeIndex = indexInRange(resumeIndex); return; }
      var index = motion ? motion.index : gesture && gesture.axis === 'x' ? snapIndex(gesture) : restIndex;
      clearGesture(); cancelMotion(); refresh(); animateTo(index, true);
    }, { passive: true });
    function suspend(){ clearGesture(); cancelMotion(); }
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
    return { goTo: goTo, isSettled: isSettled, refresh: refresh };
  };
})(window);
