/* =============================================================================
   tweaks.js — vanilla Tweaks panel for features.html
   Speaks the host edit-mode protocol (__edit_mode_available / __activate_edit_mode
   / __deactivate_edit_mode / __edit_mode_dismissed) so the toolbar toggle works,
   persists choices to localStorage, and drives window.LFTweaks.speed (read live by
   the sim engine) plus pure-CSS body attributes for layout/visual tweaks.
   ============================================================================= */
(function () {
  'use strict';
  var DEFAULTS = { speed: 1, density: 'regular', glow: true, float: true };
  var KEY = 'lf_features_tweaks_v1';
  var state = load();

  function load() { try { var s = JSON.parse(localStorage.getItem(KEY)); return Object.assign({}, DEFAULTS, s || {}); } catch (e) { return Object.assign({}, DEFAULTS); } }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} }
  function apply() {
    window.LFTweaks = window.LFTweaks || {};
    window.LFTweaks.speed = state.speed;
    var b = document.body;
    b.setAttribute('data-density', state.density);
    b.setAttribute('data-glow', state.glow ? 'on' : 'off');
    b.setAttribute('data-float', state.float ? 'on' : 'off');
  }
  apply();

  function build() {
    var panel = document.createElement('div');
    panel.className = 'twk';
    panel.innerHTML =
      '<div class="twk-hd"><b>Tweaks</b><button class="twk-x" title="Close">\u2715</button></div>' +
      '<div class="twk-body">' +
        '<div class="twk-sec">Motion</div>' +
        '<div class="twk-row"><div class="twk-lbl"><span>Animation speed</span><span class="v" data-v="speed"></span></div>' +
          '<input class="twk-rng" type="range" min="0.4" max="2" step="0.1" data-k="speed"></div>' +
        '<div class="twk-row"><div class="twk-lbl"><span>Device float</span></div>' +
          '<div class="twk-seg" data-seg="float"><button data-val="true">On</button><button data-val="false">Off</button></div></div>' +
        '<div class="twk-sec">Layout</div>' +
        '<div class="twk-row"><div class="twk-lbl"><span>Density</span></div>' +
          '<div class="twk-seg" data-seg="density"><button data-val="compact">Compact</button><button data-val="regular">Regular</button><button data-val="comfy">Comfy</button></div></div>' +
        '<div class="twk-row"><div class="twk-lbl"><span>Accent rim glow</span></div>' +
          '<div class="twk-seg" data-seg="glow"><button data-val="true">On</button><button data-val="false">Off</button></div></div>' +
        '<div class="twk-foot">Each row runs a live sim on a phone. Speed scales every animation at once.</div>' +
      '</div>';
    document.body.appendChild(panel);

    var vSpeed = panel.querySelector('[data-v="speed"]');
    var rng = panel.querySelector('[data-k="speed"]');
    function syncSpeed() { rng.value = state.speed; vSpeed.textContent = state.speed.toFixed(1) + '\u00d7'; }
    rng.addEventListener('input', function () { state.speed = parseFloat(rng.value); vSpeed.textContent = state.speed.toFixed(1) + '\u00d7'; apply(); save(); });

    function wireSeg(name, parse) {
      var seg = panel.querySelector('[data-seg="' + name + '"]');
      function paint() { [].forEach.call(seg.children, function (b) { b.classList.toggle('on', b.getAttribute('data-val') === String(state[name])); }); }
      seg.addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; state[name] = parse(b.getAttribute('data-val')); apply(); save(); paint(); });
      paint();
      return paint;
    }
    var id = function (x) { return x; };
    var bool = function (x) { return x === 'true'; };
    wireSeg('float', bool);
    wireSeg('density', id);
    wireSeg('glow', bool);
    syncSpeed();

    // close
    panel.querySelector('.twk-x').addEventListener('click', function () { panel.classList.remove('open'); try { window.parent.postMessage({ type: '__edit_mode_dismissed' }, '*'); } catch (e) {} });

    // drag to move
    var hd = panel.querySelector('.twk-hd'), drag = null;
    hd.addEventListener('mousedown', function (e) {
      if (e.target.closest('.twk-x')) return;
      var r = panel.getBoundingClientRect();
      drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
      panel.style.right = 'auto'; panel.style.bottom = 'auto'; panel.style.left = r.left + 'px'; panel.style.top = r.top + 'px';
      e.preventDefault();
    });
    window.addEventListener('mousemove', function (e) {
      if (!drag) return;
      var x = Math.max(6, Math.min(window.innerWidth - panel.offsetWidth - 6, e.clientX - drag.dx));
      var y = Math.max(6, Math.min(window.innerHeight - panel.offsetHeight - 6, e.clientY - drag.dy));
      panel.style.left = x + 'px'; panel.style.top = y + 'px';
    });
    window.addEventListener('mouseup', function () { drag = null; });

    return panel;
  }

  function init() {
    var panel = build();
    window.addEventListener('message', function (e) {
      var ty = e && e.data && e.data.type;
      if (ty === '__activate_edit_mode') panel.classList.add('open');
      else if (ty === '__deactivate_edit_mode') panel.classList.remove('open');
    });
    try { window.parent.postMessage({ type: '__edit_mode_available' }, '*'); } catch (e) {}
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
