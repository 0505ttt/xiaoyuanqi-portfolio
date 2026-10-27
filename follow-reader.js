(function(global){
  'use strict';

  global.createFollowReader = function(options){
    var page = options.page, navigation = options.navigation;
    if (!page || !navigation || typeof navigation.isSettled !== 'function'){
      throw new Error('Follow reader requires a page and settled navigation.');
    }
    var reduced = !!options.reduced;
    var progressiveCount = options.progressiveCount === undefined ? 1 : Math.max(0, options.progressiveCount);
    var virtualExtra = 0, lastTop = page.scrollTop, down = false;
    var refreshFrame = 0, layoutFrame = 0, layoutPending = false;
    var nativeInput = false, nativeTimer = 0, nativeTouch = null;
    var items = Array.prototype.slice.call(options.rows || []).map(function(row, index){
      var head = row.querySelector('.work-head');
      var detail = row.querySelector('.work-detail');
      var inner = row.querySelector('.work-detail-inner');
      if (!head || !detail || !inner) throw new Error('Every work row needs a head, detail and natural inner.');
      if (!detail.id) detail.id = 'follow-work-detail-' + (index + 1);
      head.setAttribute('aria-controls', detail.id);
      row.classList.toggle('follow', index < progressiveCount);
      return {
        row: row, head: head, detail: detail, inner: inner,
        progressive: index < progressiveCount, seen: false, complete: false,
        manual: false, progress: 0, naturalHeight: 0, travel: 0, start: null,
        busy: false, timer: 0
      };
    });

    function clamp(value, min, max){ return Math.max(min, Math.min(max, value)); }
    function active(){ return navigation.isSettled(page); }
    function bottom(){ return page.scrollTop + page.clientHeight >= page.scrollHeight - 1; }
    function relativeTop(item){ return item.head.getBoundingClientRect().top - page.getBoundingClientRect().top; }
    function effectiveTop(){ return page.scrollTop + virtualExtra; }
    function headerStart(item){ return Math.max(0, page.scrollTop + relativeTop(item) - page.clientHeight * 0.72); }
    function next(){ return items.find(function(item){ return !item.seen; }); }
    function currentProgressive(){
      var item = next();
      return item && item.progressive && !item.manual && !item.complete ? item : null;
    }
    function readingAnchor(){
      var pending = currentProgressive();
      if (pending) return pending;
      var anchor = items[0];
      items.some(function(item){
        if (relativeTop(item) > 0) return true;
        anchor = item; return false;
      });
      return anchor;
    }
    function busy(){ return items.some(function(item){ return item.busy; }); }
    function setOpen(item, open){
      item.row.classList.toggle('open', open);
      item.head.setAttribute('aria-expanded', String(open));
      item.detail.inert = !open;
    }
    function measure(item){
      // The outer detail is our output. It must never be an input to progress or
      // travel: doing so turns layout growth into artificial scrolling.
      var height = Math.max(item.inner.scrollHeight || 0, item.inner.getBoundingClientRect().height || 0);
      item.naturalHeight = height;
      if (height > 0) item.travel = clamp(height * 0.35, 80, 360);
    }
    function noteLayout(){
      layoutPending = true;
      if (layoutFrame) return;
      layoutFrame = global.requestAnimationFrame(function(){
        layoutFrame = 0;
        lastTop = page.scrollTop;
        layoutPending = false;
      });
    }
    function render(item){
      var top = page.scrollTop;
      noteLayout();
      setOpen(item, item.progress > 0);
      item.detail.style.height = (item.naturalHeight * item.progress) + 'px';
      // Collapsing while at the bottom can clamp native scrollTop. Preserve the
      // input coordinate rather than treating that layout clamp as another step.
      if (!item.complete && page.scrollTop < top) virtualExtra += top - page.scrollTop;
      lastTop = page.scrollTop;
    }
    function initializeStart(item){
      if (item && item.start === null) item.start = headerStart(item);
    }
    function completeProgressive(item){
      item.progress = 1; item.complete = true; item.seen = true;
      render(item);
      virtualExtra = 0;
      initializeStart(currentProgressive());
    }
    function updateProgress(item){
      if (!item || item.complete || item.manual || !active()) return;
      initializeStart(item);
      var travel = Math.max(80, item.travel), distance = effectiveTop() - item.start;
      var progress = clamp(distance / travel, 0, 1);
      // Fractional layout heights and native scroll rounding can leave an
      // accepted distance infinitesimally below its endpoint. Complete within
      // 0.01 CSS px rather than accepting a zero-size remainder forever.
      if (travel - distance <= 0.01) completeProgressive(item);
      else if (progress !== item.progress){ item.progress = progress; render(item); }
    }
    function finish(item){
      global.clearTimeout(item.timer); item.timer = 0; item.busy = false;
      // A finished legacy transition may reveal another eligible header, but it
      // never changes a progressive item's target or plays it to completion.
      queueRefresh();
    }
    function revealLegacy(item){
      item.seen = true;
      noteLayout(); setOpen(item, true); lastTop = page.scrollTop;
      if (!reduced){
        item.busy = true;
        item.timer = global.setTimeout(function(){ finish(item); }, 650);
      }
    }
    function checkLegacy(){
      if (!active() || !down || busy()) return;
      var item = next();
      if (item && !item.progressive && (relativeTop(item) <= page.clientHeight * 0.72 + 2 || bottom())){
        revealLegacy(item);
      }
    }
    function refreshNow(){
      refreshFrame = 0;
      // Keep the active unfinished heading in place if an earlier completed
      // project changes height. Its own extent changes never advance progress.
      var anchor = readingAnchor();
      var anchorTop = anchor ? relativeTop(anchor) : null;
      var beforeEffective = effectiveTop();
      items.forEach(function(item){
        if (!item.progressive) return;
        measure(item);
        render(item);
      });
      if (anchor && anchorTop !== null){
        writeTop(page.scrollTop + relativeTop(anchor) - anchorTop);
      }
      items.forEach(function(item){
        if (!item.progressive || item.complete) return;
        if (item !== anchor && item.progress === 0){ item.start = null; return; }
        if (item.progress > 0 && item.start !== null){
          item.start = effectiveTop() - item.progress * Math.max(80, item.travel);
        } else if (item.start !== null){ item.start += effectiveTop() - beforeEffective; }
        else item.start = active() ? headerStart(item) : null;
      });
      lastTop = page.scrollTop;
      checkLegacy();
    }
    function queueRefresh(){
      if (!refreshFrame) refreshFrame = global.requestAnimationFrame(refreshNow);
    }
    function writeTop(value){ page.scrollTop = value; lastTop = page.scrollTop; }
    function scrollBy(delta){
      if (!active() || !Number.isFinite(delta) || !delta) return;
      down = delta > 0;
      var item = currentProgressive();
      initializeStart(item);
      if (delta < 0 && item && virtualExtra > 0){
        var retreat = Math.min(virtualExtra, -delta);
        virtualExtra -= retreat; delta += retreat;
      }
      if (down && item){
        var before = page.scrollTop;
        // One input belongs to the current project only. Discard surplus after
        // completion instead of letting a large wheel/PageDown jump over the
        // next title or fill several projects in one frame.
        var accepted = Math.min(delta, Math.max(0, item.start + Math.max(80, item.travel) - effectiveTop()));
        // Preserve a visible heading even in a very short viewport. Any input
        // blocked by this display bound (or by native bottom) remains reversible
        // virtual reading distance; it is not handed to the next project.
        var headingLimit = Math.max(before, before + relativeTop(item) - Math.min(80, page.clientHeight * 0.12));
        writeTop(Math.min(before + accepted, headingLimit));
        var blocked = Math.max(0, accepted - (page.scrollTop - before));
        if (blocked > 0) virtualExtra += blocked;
        updateProgress(item);
        checkLegacy();
        return;
      }
      if (down){
        checkLegacy();
        var pending = next(), limit = Math.max(0, page.scrollHeight - page.clientHeight);
        if (pending){
          limit = Math.min(limit, Math.max(page.scrollTop,
            page.scrollTop + relativeTop(pending) - page.clientHeight * 0.72));
        }
        writeTop(Math.min(limit, page.scrollTop + delta));
        checkLegacy();
      } else {
        writeTop(page.scrollTop + delta);
        updateProgress(item);
      }
    }
    function choose(item){
      if (!active()) return;
      down = false;
      var open = !item.row.classList.contains('open');
      // Keep the first following header in place when a preceding detail is
      // changed manually; then rebuild an unfinished start from its saved ratio.
      var index = items.indexOf(item);
      // A visible clicked header is the reader's anchor. Compensate only when
      // the changed section is already above the viewport.
      var anchor = relativeTop(item) < 0 ? items[index + 1] : null;
      var before = anchor ? page.scrollTop + relativeTop(anchor) : null;
      item.manual = true; item.seen = true;
      global.clearTimeout(item.timer); item.timer = 0; item.busy = false;
      noteLayout();
      if (item.progressive){
        item.progress = open ? 1 : 0; item.complete = true; render(item); virtualExtra = 0;
      } else {
        setOpen(item, open);
        if (open && !reduced){
          item.busy = true;
          item.timer = global.setTimeout(function(){ finish(item); }, 650);
        }
      }
      if (anchor && before !== null){
        var change = page.scrollTop + relativeTop(anchor) - before;
        writeTop(page.scrollTop + change);
      }
      var progressive = currentProgressive();
      if (progressive && progressive.start !== null){
        progressive.start = effectiveTop() - progressive.progress * Math.max(80, progressive.travel);
      }
      lastTop = page.scrollTop;
      queueRefresh();
    }

    items.forEach(function(item){
      setOpen(item, false);
      if (item.progressive){ measure(item); render(item); }
      item.head.addEventListener('click', function(){ choose(item); });
      item.detail.addEventListener('transitionend', function(event){
        if (item.busy && event.target === item.detail && event.propertyName === 'grid-template-rows') finish(item);
      });
      item.detail.addEventListener('focusin', function(){
        if (!active() || !item.progressive || item.progress <= 0 || item.progress >= 1) return;
        // Partially exposed controls remain focusable; reveal their complete
        // context synchronously before focus can remain in clipped content.
        down = false;
        item.manual = true; completeProgressive(item); queueRefresh();
      });
      item.detail.addEventListener('load', queueRefresh, true);
    });
    function clearNativeInput(){
      nativeInput = false;
      global.clearTimeout(nativeTimer); nativeTimer = 0;
    }
    function cancelNativeInput(){ nativeTouch = null; clearNativeInput(); }
    function armNativeInput(){
      nativeInput = true;
      global.clearTimeout(nativeTimer);
      nativeTimer = global.setTimeout(clearNativeInput, 180);
    }
    page.addEventListener('touchstart', function(event){
      clearNativeInput(); nativeTouch = null;
      if (!active() || event.touches.length !== 1) return;
      var point = event.touches[0];
      nativeTouch = { id: point.identifier, x: point.clientX, y: point.clientY, vertical: false };
    }, { passive: true });
    page.addEventListener('touchmove', function(event){
      if (!nativeTouch) return;
      if (!active() || event.touches.length !== 1 || event.touches[0].identifier !== nativeTouch.id){
        nativeTouch = null; clearNativeInput(); return;
      }
      var point = event.touches[0];
      var dx = nativeTouch.x - point.clientX, dy = nativeTouch.y - point.clientY;
      if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) >= 4){ nativeTouch.vertical = true; armNativeInput(); }
    }, { passive: true });
    page.addEventListener('touchend', function(){
      if (nativeTouch && nativeTouch.vertical) armNativeInput();
      nativeTouch = null;
    }, { passive: true });
    page.addEventListener('touchcancel', function(){ nativeTouch = null; clearNativeInput(); }, { passive: true });
    page.addEventListener('scroll', function(){
      var top = page.scrollTop, previous = lastTop, delta = top - previous;
      lastTop = top;
      if (layoutPending || Math.abs(delta) <= 0.5) return;
      if (!active() || !nativeInput){
        var pending = currentProgressive();
        if (pending){
          if (pending.start === null) pending.start = effectiveTop() - pending.progress * Math.max(80, pending.travel);
          else pending.start += delta;
        }
        return;
      }
      armNativeInput();
      // Native touch/keyboard supplies the distance. Feed it through the same
      // per-project bound as wheel input; subsequent script scroll events see
      // lastTop already updated and cannot consume that distance a second time.
      writeTop(previous);
      scrollBy(delta);
    }, { passive: true });
    global.addEventListener('resize', function(){ cancelNativeInput(); queueRefresh(); }, { passive: true });
    if (global.ResizeObserver){
      var observer = new global.ResizeObserver(queueRefresh);
      items.forEach(function(item){ observer.observe(item.inner); });
    }
    if (global.document && global.document.fonts){
      global.document.fonts.addEventListener('loadingdone', queueRefresh);
    }
    if (global.document){
      global.document.addEventListener('keydown', function(event){
        if (!active() || (event.target.closest && event.target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="slider"]'))) return;
        if (event.key === 'ArrowUp' || event.key === 'PageUp' || (event.key === ' ' && event.shiftKey)){ down = false; armNativeInput(); }
        else if (event.key === 'ArrowDown' || event.key === 'PageDown' || event.key === ' '){ down = true; armNativeInput(); }
      });
    }
    global.addEventListener('blur', cancelNativeInput);
    global.addEventListener('aboutopen', cancelNativeInput);
    if (global.document) global.document.addEventListener('visibilitychange', function(){
      if (global.document.hidden) cancelNativeInput();
    });
    // Prevent a growing detail from moving the browser's native scroll anchor.
    // Reading progress is driven by input coordinates, not its own layout writes.
    page.style.overflowAnchor = 'none';
    queueRefresh();
    return {
      page: page, scrollBy: scrollBy, refresh: function(){ cancelNativeInput(); queueRefresh(); },
      canLeave: function(direction){
        var progressive = currentProgressive();
        // At a native top of zero there can still be reversible reading input
        // stored by a page with no scroll range. Let the reader consume it first.
        var canRetreat = progressive && (progressive.progress > 0 || virtualExtra > 0);
        return active() && (direction < 0 ? page.scrollTop <= 1 && !canRetreat : !next() && !busy() && bottom());
      }
    };
  };
})(window);
