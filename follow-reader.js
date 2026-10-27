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
      if (!item.travel && height > 0) item.travel = clamp(height * 0.35, 80, 360);
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
      var progress = clamp((effectiveTop() - item.start) / Math.max(80, item.travel), 0, 1);
      if (progress >= 1) completeProgressive(item);
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
      items.forEach(function(item){
        if (!item.progressive) return;
        measure(item);
        if (item.progress > 0 && !item.complete && item.start !== null){
          item.start = effectiveTop() - item.progress * Math.max(80, item.travel);
        } else if (!item.complete){ item.start = active() ? headerStart(item) : null; }
        render(item);
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
        writeTop(before + delta);
        var blocked = Math.max(0, delta - (page.scrollTop - before));
        if (blocked > 0 && bottom()) virtualExtra += blocked;
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
    page.addEventListener('scroll', function(){
      var top = page.scrollTop, delta = top - lastTop;
      lastTop = top;
      if (!active() || layoutPending || Math.abs(delta) <= 0.5) return;
      down = delta > 0;
      var item = currentProgressive();
      initializeStart(item); updateProgress(item);
      if (down) checkLegacy();
    }, { passive: true });
    global.addEventListener('resize', queueRefresh, { passive: true });
    if (global.ResizeObserver){
      var observer = new global.ResizeObserver(queueRefresh);
      items.forEach(function(item){ observer.observe(item.inner); });
    }
    if (global.document && global.document.fonts){
      global.document.fonts.addEventListener('loadingdone', queueRefresh);
    }
    if (global.document){
      global.document.addEventListener('keydown', function(event){
        if (!active() || (event.target.closest && event.target.closest('input,textarea,select,[contenteditable="true"],[role="slider"]'))) return;
        if (event.key === 'ArrowUp' || event.key === 'PageUp' || (event.key === ' ' && event.shiftKey)) down = false;
        else if (event.key === 'ArrowDown' || event.key === 'PageDown' || event.key === ' ') down = true;
      });
    }
    // Prevent a growing detail from moving the browser's native scroll anchor.
    // Reading progress is driven by input coordinates, not its own layout writes.
    page.style.overflowAnchor = 'none';
    queueRefresh();
    return {
      page: page, scrollBy: scrollBy, refresh: queueRefresh,
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
