    Archify.view = (function () {
      var container = document.querySelector('.diagram-container');
      var svg = container.querySelector('svg');
      var outBtn = container.querySelector('[data-view="out"]');
      var resetBtn = container.querySelector('[data-view="reset"]');
      var resetDetailLabel = resetBtn.querySelector('[data-view-detail]');
      var resetPercentLabel = resetBtn.querySelector('[data-view-percent]');
      var inBtn = container.querySelector('[data-view="in"]');
      var state = { scale: 1, x: 0, y: 0, mode: 'overview' };
      var drag = null;
      var cameraTimer = null;
      var cameraFrame = null;
      var cameraGeneration = 0;
      var cameraTransaction = null;
      var clipFrame = 0;
      var resizeFrame = 0;
      var autoScrollUntil = 0;

      var viewBox = svg.viewBox && svg.viewBox.baseVal;
      // CyberFitz fork: on the infinite canvas the camera is unbounded. Scale
      // stays relative to "fit" (1 = whole viewBox fitted), but the range is
      // derived from real pixels so any authored viewBox can be read at 100%.
      var canvas = Boolean(Archify.canvas && Archify.canvas.enabled);
      var pinch = null;
      var touches = Object.create(null);

      function fitScale() {
        var metrics = contentMetrics();
        return metrics && metrics.scale > 0 ? metrics.scale : 1;
      }
      function minCameraScale() { return canvas ? Archify.canvas.minScale(fitScale()) : 1; }
      function maxCameraScale() { return canvas ? Archify.canvas.maxScale(fitScale()) : 3; }
      function clamp() {
        var width = svg.clientWidth || 1;
        var height = svg.clientHeight || 1;
        if (canvas) {
          // Free pan: only keep a sliver of the authored plane reachable so the
          // diagram can never be lost off-screen.
          var keep = Math.min(120, width / 4, height / 4);
          state.x = Math.min(width - keep, Math.max(keep - width * state.scale, state.x));
          state.y = Math.min(height - keep, Math.max(keep - height * state.scale, state.y));
          return;
        }
        state.x = Math.min(0, Math.max(width - width * state.scale, state.x));
        state.y = Math.min(0, Math.max(height - height * state.scale, state.y));
      }
      function reducedMotion() {
        return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      }
      function contentMetrics() {
        if (!viewBox || viewBox.width <= 0 || viewBox.height <= 0) return null;
        var width = svg.clientWidth || 1;
        var height = svg.clientHeight || 1;
        var scale = Math.min(width / viewBox.width, height / viewBox.height);
        return {
          width: width,
          height: height,
          scale: scale,
          offsetX: (width - viewBox.width * scale) / 2,
          offsetY: (height - viewBox.height * scale) / 2
        };
      }
      function logicalViewport() {
        var metrics = contentMetrics();
        if (!metrics) return null;
        var x;
        var y;
        var width;
        var height;
        if (window.innerWidth <= 720 && container.hasAttribute('data-wide-diagram')) {
          x = viewBox.x + container.scrollLeft / metrics.scale;
          y = viewBox.y;
          width = Math.min(viewBox.width, Math.max(1, container.clientWidth / metrics.scale));
          height = viewBox.height;
        } else {
          x = viewBox.x + ((-state.x / state.scale) - metrics.offsetX) / metrics.scale;
          y = viewBox.y + ((-state.y / state.scale) - metrics.offsetY) / metrics.scale;
          width = Math.min(viewBox.width, metrics.width / state.scale / metrics.scale);
          height = Math.min(viewBox.height, metrics.height / state.scale / metrics.scale);
        }
        width = Math.max(1, Math.min(viewBox.width, width));
        height = Math.max(1, Math.min(viewBox.height, height));
        x = Math.max(viewBox.x, Math.min(viewBox.x + viewBox.width - width, x));
        y = Math.max(viewBox.y, Math.min(viewBox.y + viewBox.height - height, y));
        return { x: x, y: y, width: width, height: height, scale: state.scale };
      }
      function detailLevel() {
        if (state.mode === 'semantic') return 'full';
        if (canvas) return Archify.canvas.detailLevel(state.scale * fitScale());
        if (state.scale >= 1.75) return 'full';
        if (state.scale >= 1) return 'read';
        return 'map';
      }
      function renderControls() {
        var semantic = state.mode === 'semantic' && state.scale > 1.01;
        var detail = detailLevel();
        var percent = Math.round(state.scale * (canvas ? fitScale() : 1) * 100) + '%';
        var levelLabel = viewerText('viewer.nav.level.' + detail);
        var detailHint = detail === 'map'
          ? viewerText('viewer.nav.detail.map')
          : detail === 'read'
            ? viewerText('viewer.nav.detail.read')
            : viewerText('viewer.nav.detail.full');
        var resolvedLevel = semantic ? viewerText('viewer.nav.level.auto') : levelLabel;
        var showDetailLevel = semantic || detail !== 'read';
        if (resetDetailLabel) {
          resetDetailLabel.textContent = resolvedLevel;
          resetDetailLabel.hidden = !showDetailLevel;
        }
        if (resetPercentLabel) resetPercentLabel.textContent = percent;
        resetBtn.toggleAttribute('data-detail-visible', showDetailLevel);
        resetBtn.title = viewerText('viewer.nav.camera.title', {
          semantic: semantic ? viewerText('viewer.nav.camera.semantic') : '',
          hint: detailHint
        });
        resetBtn.setAttribute('aria-label', viewerText('viewer.nav.camera', { hint: detailHint }));
        resetBtn.setAttribute('data-detail-level', detail);
        container.setAttribute('data-detail-level', detail);
        container.setAttribute('data-camera-mode', state.mode);
        container.setAttribute('data-camera-indicator', semantic ? 'true' : 'false');
      }
      function clipToViewport(camera) {
        camera = camera || state;
        // The canvas paints across its chrome gutters, so it never clips to the SVG box.
        if (canvas || camera.scale <= 1.001) {
          svg.style.removeProperty('clip-path');
          return;
        }
        var width = svg.clientWidth || 1;
        var height = svg.clientHeight || 1;
        var scale = camera.scale;
        var top = Math.max(0, Math.min(height, -camera.y / scale));
        var left = Math.max(0, Math.min(width, -camera.x / scale));
        var right = Math.max(0, Math.min(width, width - (width - camera.x) / scale));
        var bottom = Math.max(0, Math.min(height, height - (height - camera.y) / scale));
        svg.style.clipPath = 'inset(' + [top, right, bottom, left].map(function (value) {
          return Math.round(value * 1000) / 1000 + 'px';
        }).join(' ') + ')';
      }
      function cameraSettled(rendered) {
        return Math.abs(rendered.scale - state.scale) < 0.001 &&
          Math.abs(rendered.x - state.x) < 0.05 &&
          Math.abs(rendered.y - state.y) < 0.05;
      }
      function syncViewportClip() {
        if (clipFrame) cancelAnimationFrame(clipFrame);
        clipFrame = 0;
        function sample() {
          clipFrame = 0;
          var rendered = sampleRenderedState();
          clipToViewport(rendered);
          if (!cameraSettled(rendered)) clipFrame = requestAnimationFrame(sample);
        }
        sample();
      }
      function apply() {
        clamp();
        svg.style.transform = 'translate(' + state.x + 'px,' + state.y + 'px) scale(' + state.scale + ')';
        syncViewportClip();
        renderControls();
        outBtn.disabled = state.scale <= minCameraScale() + 0.0005;
        inBtn.disabled = state.scale >= maxCameraScale() - 0.0005;
        container.classList.toggle('is-pannable', canvas || state.scale > 1);
        if (canvas) Archify.canvas.paint(state, fitScale());
        svg.setAttribute('data-view-scale', String(state.scale));
        if (Archify.radar && typeof Archify.radar.sync === 'function') Archify.radar.sync();
        if (Archify.viewerChromeLayout && typeof Archify.viewerChromeLayout.schedule === 'function') {
          Archify.viewerChromeLayout.schedule();
        }
      }
      function sampleRenderedState() {
        var transform = '';
        try { transform = getComputedStyle(svg).transform || ''; } catch (_) {}
        var match = transform.match(/^matrix\(([^)]+)\)$/);
        if (!match) return { scale: state.scale, x: state.x, y: state.y, mode: state.mode };
        var values = match[1].split(',').map(Number);
        if (values.length !== 6 || !values.every(Number.isFinite)) {
          return { scale: state.scale, x: state.x, y: state.y, mode: state.mode };
        }
        return { scale: values[0], x: values[4], y: values[5], mode: state.mode };
      }
      function finishCameraTransaction(transaction, outcome) {
        if (!transaction || transaction.settled) return false;
        transaction.settled = true;
        transaction.state = outcome || 'complete';
        if (transaction.frame) cancelAnimationFrame(transaction.frame);
        if (transaction.timer) clearTimeout(transaction.timer);
        transaction.frame = null;
        transaction.timer = null;
        if (cameraTransaction === transaction) cameraTransaction = null;
        cameraFrame = null;
        cameraTimer = null;
        container.classList.remove('is-camera-moving');
        container.classList.remove('is-camera-transaction');
        container.removeAttribute('data-camera-transaction');
        if (Archify.focus && Archify.focus.reposition) Archify.focus.reposition();
        transaction.resolve({ id: transaction.id, state: transaction.state });
        return true;
      }
      function cameraReceipt(target, options) {
        var resolver;
        var transaction = {
          id: ++cameraGeneration,
          state: 'running',
          target: target,
          settled: false,
          frame: null,
          timer: null,
          finished: new Promise(function (resolve) { resolver = resolve; }),
          resolve: resolver,
          cancel: function (reason, commitTarget) {
            if (transaction.settled) return false;
            if (commitTarget && transaction.target) {
              if (Object.prototype.hasOwnProperty.call(transaction.target, 'scrollLeft')) {
                container.scrollLeft = transaction.target.scrollLeft;
              } else {
                state = {
                  scale: transaction.target.scale,
                  x: transaction.target.x,
                  y: transaction.target.y,
                  mode: transaction.target.mode
                };
                apply();
              }
            }
            return finishCameraTransaction(transaction, reason || 'cancelled');
          }
        };
        return transaction;
      }
      function stopCameraMotion(reason, commitTarget) {
        if (cameraTransaction && !cameraTransaction.settled) {
          cameraTransaction.cancel(reason || 'cancelled', commitTarget === true);
          return;
        }
        if (cameraTimer) clearTimeout(cameraTimer);
        if (cameraFrame) cancelAnimationFrame(cameraFrame);
        cameraTimer = null;
        cameraFrame = null;
        container.classList.remove('is-camera-moving');
        container.classList.remove('is-camera-transaction');
        container.removeAttribute('data-camera-transaction');
      }
      function interruptCamera(reason) {
        if (Archify.guidedViews && Archify.guidedViews.cancelHandoff) {
          Archify.guidedViews.cancelHandoff(reason || 'manual');
        }
        var rendered = sampleRenderedState();
        stopCameraMotion(reason || 'manual', false);
        state = rendered;
        state.mode = 'manual';
        apply();
        renderControls();
        if (Archify.guidedViews && Archify.guidedViews.isPlaying && Archify.guidedViews.isPlaying()) {
          Archify.guidedViews.pause();
        }
        if (Archify.routeProbe && Archify.routeProbe.isJourneyPlaying && Archify.routeProbe.isJourneyPlaying()) {
          Archify.routeProbe.pauseJourney({ preserveElapsed: true, reason: reason || 'manual' });
        }
      }
      function zoom(next, options) {
        options = options || {};
        if (options.manual !== false) interruptCamera();
        var previous = state.scale;
        next = canvas
          ? Math.max(minCameraScale(), Math.min(maxCameraScale(), next))
          : Math.max(1, Math.min(3, Math.round(next * 4) / 4));
        if (next === previous) return;
        var centerX = options.anchor ? options.anchor.x : (svg.clientWidth || 1) / 2;
        var centerY = options.anchor ? options.anchor.y : (svg.clientHeight || 1) / 2;
        var contentX = (centerX - state.x) / previous;
        var contentY = (centerY - state.y) / previous;
        state.scale = next;
        state.x = centerX - contentX * next;
        state.y = centerY - contentY * next;
        apply();
      }
      function reset(options) {
        options = options || {};
        if (options.automatic !== true) interruptCamera();
        else stopCameraMotion('reset', false);
        state = { scale: 1, x: 0, y: 0, mode: 'overview' };
        apply();
      }
      function centerAt(logicalX, logicalY, options) {
        options = options || {};
        logicalX = Number(logicalX);
        logicalY = Number(logicalY);
        var metrics = contentMetrics();
        if (!metrics || !Number.isFinite(logicalX) || !Number.isFinite(logicalY)) return false;
        interruptCamera();
        if (window.innerWidth <= 720 && container.hasAttribute('data-wide-diagram')) {
          state.scale = 1;
          state.x = 0;
          state.y = 0;
          state.mode = 'manual';
          apply();
          var mobileTarget = (logicalX - viewBox.x) * metrics.scale - container.clientWidth / 2;
          mobileTarget = Math.max(0, Math.min(svg.clientWidth - container.clientWidth, mobileTarget));
          autoScrollUntil = Date.now() + 80;
          try { container.scrollTo({ left: mobileTarget, behavior: options.instant ? 'auto' : 'smooth' }); }
          catch (_) { container.scrollLeft = mobileTarget; }
          return true;
        }
        var minimumScale = Math.max(1, Math.min(maxCameraScale(), Number(options.minimumScale) || 1));
        if (canvas) minimumScale = Math.max(minimumScale, Math.min(maxCameraScale(), Archify.canvas.readableScale(fitScale())));
        var requestedScale = Number(options.scale);
        state.scale = Math.max(minimumScale, Math.min(maxCameraScale(), Number.isFinite(requestedScale) ? requestedScale : state.scale));
        var contentX = metrics.offsetX + (logicalX - viewBox.x) * metrics.scale;
        var contentY = metrics.offsetY + (logicalY - viewBox.y) * metrics.scale;
        state.x = metrics.width / 2 - contentX * state.scale;
        state.y = metrics.height / 2 - contentY * state.scale;
        state.mode = 'manual';
        apply();
        if (Archify.focus && Archify.focus.reposition) Archify.focus.reposition();
        return true;
      }
      function semanticIds(ids, includeNeighbors) {
        var seeds = Object.create(null);
        var wanted = Object.create(null);
        (ids || []).forEach(function (id) { seeds[id] = true; wanted[id] = true; });
        if (includeNeighbors) {
          Array.prototype.forEach.call(svg.querySelectorAll('[data-edge-from][data-edge-to]'), function (edge) {
            var from = edge.getAttribute('data-edge-from');
            var to = edge.getAttribute('data-edge-to');
            if (seeds[from] || seeds[to]) { wanted[from] = true; wanted[to] = true; }
          });
        }
        return wanted;
      }
      function boxesFor(ids, includeNeighbors) {
        var wanted = semanticIds(ids, includeNeighbors);
        return Array.prototype.slice.call(svg.querySelectorAll('[data-node-id]'))
          .filter(function (node) { return wanted[node.getAttribute('data-node-id')]; })
          .map(function (node) {
            try { return node.getBBox(); } catch (_) { return null; }
          })
          .filter(Boolean);
      }
      function frameDesktop(ids, options) {
        options = options || {};
        var boxes = boxesFor(ids, options.includeNeighbors === true);
        if (!boxes.length || !viewBox || viewBox.width <= 0 || viewBox.height <= 0) return false;
        var svgWidth = svg.clientWidth || 1;
        var svgHeight = svg.clientHeight || 1;
        var contentScale = Math.min(svgWidth / viewBox.width, svgHeight / viewBox.height);
        var contentOffsetX = (svgWidth - viewBox.width * contentScale) / 2;
        var contentOffsetY = (svgHeight - viewBox.height * contentScale) / 2;
        var minX = Math.min.apply(Math, boxes.map(function (box) { return box.x; }));
        var minY = Math.min.apply(Math, boxes.map(function (box) { return box.y; }));
        var maxX = Math.max.apply(Math, boxes.map(function (box) { return box.x + box.width; }));
        var maxY = Math.max.apply(Math, boxes.map(function (box) { return box.y + box.height; }));
        var bounds = {
          x: contentOffsetX + minX * contentScale,
          y: contentOffsetY + minY * contentScale,
          width: Math.max(1, (maxX - minX) * contentScale),
          height: Math.max(1, (maxY - minY) * contentScale)
        };
        var padding = options.padding || 48;
        var left = padding;
        var right = svgWidth - padding;
        var top = padding;
        var bottom = svgHeight - Math.max(padding, 72);
        var containerRect = container.getBoundingClientRect();
        var visibleTop = Math.max(0, -containerRect.top);
        var visibleBottom = Math.min(svgHeight, window.innerHeight - containerRect.top);
        if (visibleBottom - visibleTop >= 240) {
          top = Math.max(top, visibleTop + padding);
          bottom = Math.min(bottom, visibleBottom - Math.max(padding, 72));
        }
        if (canvas) top = Math.max(top, Archify.canvas.topInset());
        var chip = document.getElementById('focus-chip');
        if (chip && !chip.hidden) {
          var lensEnd = chip.offsetLeft + chip.offsetWidth + 24 - (svg.offsetLeft || 0);
          left = Math.max(left, Math.min(svgWidth * 0.42, lensEnd));
        }
        var routeReceipt = document.getElementById('route-probe');
        if (routeReceipt && !routeReceipt.hidden && routeReceipt.hasAttribute('data-route-journey')) {
          var receiptTop = routeReceipt.offsetTop;
          var receiptBottom = receiptTop + routeReceipt.offsetHeight;
          if (receiptTop < svgHeight / 2) top = Math.max(top, receiptBottom + 24);
          else bottom = Math.min(bottom, receiptTop - 24);
        }
        if (right <= left || bottom <= top) return false;
        var maxScale = options.maxScale || (options.includeNeighbors ? 1.9 : 2.15);
        // On a large canvas "fit" can be far below reading size, so a semantic
        // frame may zoom as far as real-pixel reading scale needs.
        if (canvas) maxScale = Math.max(maxScale, Archify.canvas.readableScale(fitScale()) * (options.includeNeighbors ? 1 : 1.15));
        var targetScale = Math.min((right - left) / bounds.width, (bottom - top) / bounds.height) * 0.9;
        targetScale = Math.max(1, Math.min(maxScale, targetScale));
        if (targetScale < 1.08) targetScale = 1;
        var target = {
          scale: Math.round(targetScale * 100) / 100,
          x: 0,
          y: 0,
          mode: 'semantic'
        };
        target.x = (left + right) / 2 - (bounds.x + bounds.width / 2) * target.scale;
        target.y = (top + bottom) / 2 - (bounds.y + bounds.height / 2) * target.scale;
        var start = sampleRenderedState();
        stopCameraMotion('replaced', false);
        var transaction = cameraReceipt(target, options);
        cameraTransaction = transaction;
        var instant = options.instant === true || reducedMotion() || document.hidden;
        if (instant) {
          state = target;
          apply();
          finishCameraTransaction(transaction, reducedMotion() ? 'reduced-motion' : (document.hidden ? 'hidden' : 'complete'));
          return transaction;
        }
        var duration = Math.max(180, Math.min(520, Number(options.duration) || 420));
        var startedAt = 0;
        state = start;
        state.mode = 'semantic';
        apply();
        container.classList.add('is-camera-moving');
        container.classList.add('is-camera-transaction');
        container.setAttribute('data-camera-transaction', String(transaction.id));
        var step = function (timestamp) {
          if (cameraTransaction !== transaction || transaction.settled) return;
          if (!startedAt) startedAt = timestamp;
          var fraction = Math.max(0, Math.min(1, (timestamp - startedAt) / duration));
          var eased = 1 - Math.pow(1 - fraction, 3);
          state = {
            scale: start.scale + (target.scale - start.scale) * eased,
            x: start.x + (target.x - start.x) * eased,
            y: start.y + (target.y - start.y) * eased,
            mode: 'semantic'
          };
          apply();
          if (fraction < 1) {
            transaction.frame = requestAnimationFrame(step);
            cameraFrame = transaction.frame;
          } else {
            state = target;
            apply();
            finishCameraTransaction(transaction, 'complete');
          }
        };
        transaction.frame = requestAnimationFrame(step);
        cameraFrame = transaction.frame;
        return transaction;
      }
      function reveal(ids, options) {
        options = options || {};
        if (window.innerWidth > 720) return frameDesktop(ids, options);
        stopCameraMotion('replaced', false);
        state.scale = 1;
        state.x = 0;
        state.y = 0;
        state.mode = 'semantic';
        apply();
        if (!container.hasAttribute('data-wide-diagram')) {
          var contained = cameraReceipt({ scale: 1, x: 0, y: 0, mode: 'semantic' }, options);
          cameraTransaction = contained;
          finishCameraTransaction(contained, 'complete');
          return contained;
        }
        var boxes = boxesFor(ids, options.includeNeighbors === true);
        if (!boxes.length || !viewBox || viewBox.width <= 0) return false;
        var minX = Math.min.apply(Math, boxes.map(function (box) { return box.x; }));
        var maxX = Math.max.apply(Math, boxes.map(function (box) { return box.x + box.width; }));
        var center = ((minX + maxX) / 2 / viewBox.width) * (svg.clientWidth || 1);
        var target = Math.max(0, Math.min(svg.clientWidth - container.clientWidth, center - container.clientWidth / 2));
        var transaction = cameraReceipt({ scrollLeft: target }, options);
        cameraTransaction = transaction;
        var instant = options.instant === true || reducedMotion() || document.hidden;
        autoScrollUntil = Date.now() + (instant ? 50 : 470);
        try { container.scrollTo({ left: target, behavior: instant ? 'auto' : 'smooth' }); }
        catch (_) { container.scrollLeft = target; }
        if (instant) finishCameraTransaction(transaction, reducedMotion() ? 'reduced-motion' : (document.hidden ? 'hidden' : 'complete'));
        else {
          transaction.timer = setTimeout(function () { finishCameraTransaction(transaction, 'complete'); }, 460);
          cameraTimer = transaction.timer;
          container.classList.add('is-camera-moving');
          container.setAttribute('data-camera-transaction', String(transaction.id));
        }
        return transaction;
      }
      function syncSemantic() {
        var guided = Archify.guidedViews && typeof Archify.guidedViews.focus === 'function'
          ? Archify.guidedViews.focus() : [];
        if (guided && guided.length) return reveal(guided, { reason: 'guided-sync' });
        var active = Archify.focus && typeof Archify.focus.active === 'function' ? Archify.focus.active() : null;
        if (typeof active === 'string') return reveal([active], { includeNeighbors: true, reason: 'focus-sync' });
        if (Array.isArray(active) && active.length) return reveal(active, { reason: 'selection-sync' });
        return false;
      }
      function pinControls() {
        container.style.setProperty('--archify-scroll-x', container.scrollLeft + 'px');
      }
      function onScroll() {
        pinControls();
        if (Archify.radar && typeof Archify.radar.sync === 'function') Archify.radar.sync();
        if (window.innerWidth <= 720 && container.hasAttribute('data-wide-diagram') && Date.now() > autoScrollUntil) {
          interruptCamera();
        }
      }
      function onPointerEnd(event) {
        if (touches[event.pointerId]) {
          delete touches[event.pointerId];
          pinch = null;
        }
        if (!drag) return;
        var moved = drag.moved;
        drag = null;
        container.classList.remove('is-panning');
        try { container.releasePointerCapture(event.pointerId); } catch (_) {}
        if (moved) {
          container.setAttribute('data-just-panned', 'true');
          setTimeout(function () { container.removeAttribute('data-just-panned'); }, 80);
        }
      }

      function stepIn() { zoom(canvas ? state.scale * 1.25 : state.scale + 0.25); }
      function stepOut() { zoom(canvas ? state.scale / 1.25 : state.scale - 0.25); }
      function localPoint(clientX, clientY) {
        // The SVG's untransformed layout box is the container's content box.
        var rect = container.getBoundingClientRect();
        var style = window.getComputedStyle(container);
        return {
          x: clientX - rect.left - (parseFloat(style.borderLeftWidth) || 0) - (parseFloat(style.paddingLeft) || 0),
          y: clientY - rect.top - (parseFloat(style.borderTopWidth) || 0) - (parseFloat(style.paddingTop) || 0)
        };
      }
      function zoomAt(clientX, clientY, factor) {
        if (!Number.isFinite(factor) || factor <= 0) return;
        zoom(state.scale * factor, { anchor: localPoint(clientX, clientY) });
      }
      function panBy(dx, dy) {
        if (!Number.isFinite(dx) || !Number.isFinite(dy) || (!dx && !dy)) return;
        interruptCamera();
        state.x += dx;
        state.y += dy;
        apply();
      }
      function actualSize() {
        zoom(1 / fitScale());
      }
      inBtn.addEventListener('click', stepIn);
      outBtn.addEventListener('click', stepOut);
      resetBtn.addEventListener('click', reset);
      container.addEventListener('pointerdown', function (event) {
        if (canvas && event.pointerType === 'touch') {
          touches[event.pointerId] = { x: event.clientX, y: event.clientY };
          var ids = Object.keys(touches);
          if (ids.length === 2) {
            var a = touches[ids[0]];
            var b = touches[ids[1]];
            drag = null;
            container.classList.remove('is-panning');
            interruptCamera();
            pinch = { distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
            return;
          }
        }
        if ((!canvas && state.scale <= 1) || event.button !== 0 || event.target.closest('.diagram-nav, .focus-chip, .node-finder, .diagram-guide, .overview-map, .route-probe, .semantic-lens') || event.target.closest('[data-node-id]') || event.target.closest('[data-relationship-hit-key]')) return;
        interruptCamera();
        drag = { startX: event.clientX, startY: event.clientY, x: state.x, y: state.y, moved: false };
        container.classList.add('is-panning');
        try { container.setPointerCapture(event.pointerId); } catch (_) {}
      });
      container.addEventListener('pointermove', function (event) {
        if (canvas && touches[event.pointerId]) {
          touches[event.pointerId] = { x: event.clientX, y: event.clientY };
          var ids = Object.keys(touches);
          if (pinch && ids.length === 2) {
            var a = touches[ids[0]];
            var b = touches[ids[1]];
            var distance = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
            var midX = (a.x + b.x) / 2;
            var midY = (a.y + b.y) / 2;
            state.x += midX - pinch.x;
            state.y += midY - pinch.y;
            zoom(state.scale * (distance / pinch.distance), { manual: false, anchor: localPoint(midX, midY) });
            pinch = { distance: distance, x: midX, y: midY };
            apply();
            return;
          }
        }
        if (!drag) return;
        var dx = event.clientX - drag.startX;
        var dy = event.clientY - drag.startY;
        if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
        state.x = drag.x + dx;
        state.y = drag.y + dy;
        apply();
      });
      container.addEventListener('pointerup', onPointerEnd);
      container.addEventListener('pointercancel', onPointerEnd);
      container.addEventListener('scroll', onScroll, { passive: true });
      window.addEventListener('resize', function () {
        if (resizeFrame) cancelAnimationFrame(resizeFrame);
        resizeFrame = requestAnimationFrame(function () {
          resizeFrame = 0;
          if (state.mode === 'semantic') syncSemantic();
          else apply();
        });
      });
      window.addEventListener('hashchange', function () { requestAnimationFrame(syncSemantic); });
      apply();
      pinControls();
      requestAnimationFrame(syncSemantic);

      return {
        zoomIn: stepIn,
        zoomOut: stepOut,
        zoomAt: zoomAt,
        panBy: panBy,
        actualSize: actualSize,
        fitScale: fitScale,
        reset: reset,
        reveal: reveal,
        centerAt: centerAt,
        logicalViewport: logicalViewport,
        sync: syncSemantic,
        state: function () { return { scale: state.scale, x: state.x, y: state.y, mode: state.mode }; }
      };
    })();
