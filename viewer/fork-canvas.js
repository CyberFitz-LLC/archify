    /* ============================================================
       CyberFitz fork — Infinite Canvas reader.

       The diagram owns the whole viewport. The camera pans freely and zooms
       across a wide range, so an authored viewBox can be as large as the
       subject needs instead of being squeezed into a first screen. Title,
       chapters and summary cards float above the canvas as chrome.

       This fragment only declares policy and input; the camera itself stays in
       viewer-camera.js and asks Archify.canvas for its limits. Embeds keep the
       upstream boxed reader because an iframe is not a canvas.
       ============================================================ */
    Archify.canvas = (function () {
      var html = document.documentElement;
      var enabled = html.getAttribute('data-layout') === 'canvas' &&
        html.getAttribute('data-embed') !== 'true';
      var container = document.querySelector('.diagram-container');
      var cards = document.querySelector('.cards');
      var GRID = 32;
      var READ_PX = 1;      // real-pixel scale at which authored type is read as drawn
      var MAX_PX = 4;       // deepest zoom, in real pixels
      var MIN_FIT = 0.2;    // farthest zoom-out, as a fraction of "fit everything"

      if (!enabled) {
        if (html.getAttribute('data-layout') === 'canvas') html.setAttribute('data-layout', 'page');
        return { enabled: false };
      }

      function minScale() { return MIN_FIT; }
      function maxScale(fit) { return Math.max(3, MAX_PX / (fit || 1)); }
      function readableScale(fit) { return Math.max(1, READ_PX / (fit || 1)); }
      function detailLevel(pixelScale) {
        if (pixelScale >= 1.2) return 'full';
        if (pixelScale >= 0.55) return 'read';
        return 'map';
      }
      // The dot grid is part of the plane, not the screen: it moves and scales
      // with the camera so panning reads as travelling across one surface.
      function paint(state, fit) {
        if (!container) return;
        var pixel = state.scale * (fit || 1);
        var step = GRID * pixel;
        while (step < 14) step *= 4;
        while (step > 96) step /= 4;
        container.style.setProperty('--archify-canvas-grid', step.toFixed(3) + 'px');
        container.style.setProperty('--archify-canvas-x', state.x.toFixed(2) + 'px');
        container.style.setProperty('--archify-canvas-y', state.y.toFixed(2) + 'px');
      }

      function overChrome(target) {
        return Boolean(target && target.closest &&
          target.closest('.diagram-nav, .focus-chip, .node-finder, .diagram-guide, .overview-map, .route-probe, .semantic-lens, .canvas-notes, .guided-views, .toolbar'));
      }
      function onWheel(event) {
        if (!Archify.view || overChrome(event.target)) return;
        event.preventDefault();
        var unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? window.innerHeight : 1;
        var dx = event.deltaX * unit;
        var dy = event.deltaY * unit;
        if (event.ctrlKey || event.metaKey) {
          // Trackpad pinch arrives as ctrl+wheel with small deltas; a mouse
          // wheel arrives in large notches, so a notch is a fixed ~20% step.
          var notch = Math.abs(dy) >= 50;
          var power = notch ? (dy > 0 ? 0.18 : -0.18) : Math.max(-0.3, Math.min(0.3, dy * 0.01));
          Archify.view.zoomAt(event.clientX, event.clientY, Math.exp(-power));
        } else if (event.shiftKey && !dx) {
          Archify.view.panBy(-dy, 0);
        } else {
          Archify.view.panBy(-dx, -dy);
        }
      }
      function onKey(event) {
        if (event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented || !Archify.view) return;
        var t = event.target;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
        if (t && t.closest && t.closest('[role="dialog"], [role="menu"], [role="listbox"], .overview-map-surface')) return;
        if (event.key === '1') {
          event.preventDefault();
          Archify.view.actualSize();
          return;
        }
        var step = event.shiftKey ? 240 : 80;
        var move = {
          ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step]
        }[event.key];
        if (!move || (t && t !== document.body && t !== container && !(t.closest && t.closest('svg')))) return;
        event.preventDefault();
        Archify.view.panBy(move[0], move[1]);
      }

      // Summary cards become a collapsible Notes drawer so they never cover the
      // plane unless the reader asks for them.
      function mountNotes() {
        if (!cards || !cards.children.length) return;
        var drawer = document.createElement('section');
        drawer.className = 'canvas-notes no-print';
        drawer.setAttribute('data-open', 'false');
        var toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'canvas-notes-toggle';
        toggle.setAttribute('aria-expanded', 'false');
        var label = document.createElement('span');
        label.textContent = 'Notes';
        var count = document.createElement('span');
        count.className = 'canvas-notes-count';
        count.textContent = String(cards.querySelectorAll('.card').length || cards.children.length);
        toggle.appendChild(label);
        toggle.appendChild(count);
        cards.parentNode.insertBefore(drawer, cards);
        drawer.appendChild(toggle);
        drawer.appendChild(cards);
        toggle.addEventListener('click', function () {
          var open = drawer.getAttribute('data-open') !== 'true';
          drawer.setAttribute('data-open', open ? 'true' : 'false');
          toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        });
      }

      if (container) {
        container.addEventListener('wheel', onWheel, { passive: false });
        // Safari reports trackpad pinch as gesture events; without this the
        // page itself zooms and the canvas chrome scales with it.
        ['gesturestart', 'gesturechange'].forEach(function (name) {
          container.addEventListener(name, function (event) { event.preventDefault(); });
        });
      }
      document.addEventListener('keydown', onKey);
      mountNotes();

      return {
        enabled: true,
        minScale: minScale,
        maxScale: maxScale,
        readableScale: readableScale,
        detailLevel: detailLevel,
        paint: paint
      };
    })();
