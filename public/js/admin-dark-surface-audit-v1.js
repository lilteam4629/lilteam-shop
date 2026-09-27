(function () {
  'use strict';

  var documentElement = document.documentElement;
  var body = document.body;
  if (!documentElement || !body || !body.classList.contains('experiment-admin')) return;

  var neutralCanvas = { r: 23, g: 24, b: 21 };
  var pending = new Set();
  var timer = 0;

  function parseColor(value) {
    if (!value) return null;
    var text = String(value).trim().toLowerCase();
    if (text === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
    var hex = text.match(/^#([0-9a-f]{3,8})$/i);
    if (hex) {
      var raw = hex[1];
      if (raw.length === 3 || raw.length === 4) {
        return {
          r: parseInt(raw[0] + raw[0], 16),
          g: parseInt(raw[1] + raw[1], 16),
          b: parseInt(raw[2] + raw[2], 16),
          a: raw.length === 4 ? parseInt(raw[3] + raw[3], 16) / 255 : 1,
        };
      }
      if (raw.length === 6 || raw.length === 8) {
        return {
          r: parseInt(raw.slice(0, 2), 16),
          g: parseInt(raw.slice(2, 4), 16),
          b: parseInt(raw.slice(4, 6), 16),
          a: raw.length === 8 ? parseInt(raw.slice(6, 8), 16) / 255 : 1,
        };
      }
    }
    var rgb = text.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/);
    if (!rgb) return null;
    return {
      r: Math.max(0, Math.min(255, Number(rgb[1]))),
      g: Math.max(0, Math.min(255, Number(rgb[2]))),
      b: Math.max(0, Math.min(255, Number(rgb[3]))),
      a: rgb[4] ? (rgb[4].endsWith('%') ? Number(rgb[4].slice(0, -1)) / 100 : Number(rgb[4])) : 1,
    };
  }

  function blend(color, under) {
    var alpha = Math.max(0, Math.min(1, color.a === undefined ? 1 : color.a));
    return {
      r: color.r * alpha + under.r * (1 - alpha),
      g: color.g * alpha + under.g * (1 - alpha),
      b: color.b * alpha + under.b * (1 - alpha),
    };
  }

  function channel(value) {
    var normalized = value / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : Math.pow((normalized + 0.055) / 1.055, 2.4);
  }

  function luminance(color) {
    return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
  }

  function contrast(a, b) {
    var light = Math.max(luminance(a), luminance(b));
    var dark = Math.min(luminance(a), luminance(b));
    return (light + 0.05) / (dark + 0.05);
  }

  function neutral(color) {
    var max = Math.max(color.r, color.g, color.b);
    var min = Math.min(color.r, color.g, color.b);
    return max - min <= 48;
  }

  function imageHasNeutralLightGradient(backgroundImage) {
    if (!backgroundImage || backgroundImage === 'none' || /url\s*\(/i.test(backgroundImage)) return false;
    var colors = backgroundImage.match(/rgba?\([^)]*\)|#[\da-f]{3,8}\b/gi) || [];
    var parsed = colors.map(parseColor).filter(function (color) { return color && color.a > 0.05; });
    if (!parsed.length || parsed.some(function (color) { return !neutral(color); })) return false;
    var lightCount = parsed.filter(function (color) { return luminance(blend(color, neutralCanvas)) > 0.72; }).length;
    return lightCount / parsed.length >= 0.6;
  }

  function isVisualAsset(element) {
    return /^(IMG|VIDEO|CANVAS|PICTURE|IFRAME|OBJECT|EMBED)$/.test(element.tagName)
      || element.matches('.experiment-chart-bar')
      || element.closest('[data-admin-dark-preserve], .admin-dark-mode-preserve');
  }

  function semanticSurface(element) {
    return element.matches('[class*="success"], [class*="error"], [class*="danger"], [class*="warning"], [class*="pending"], [class*="status"], [class*="badge"], [class*="alert"], [class*="toast"]');
  }

  function backgroundRole(element, style) {
    var color = parseColor(style.backgroundColor);
    var visibleColor = color && color.a > 0.02 ? blend(color, neutralCanvas) : null;
    var image = imageHasNeutralLightGradient(style.backgroundImage);
    if (!image && (!visibleColor || !neutral(visibleColor) || luminance(visibleColor) < 0.69)) return '';

    if (/^(INPUT|SELECT|TEXTAREA)$/.test(element.tagName)) return 'input';
    if (image) return 'surface';
    return luminance(visibleColor) > 0.9 ? 'surface' : 'raised';
  }

  function foregroundRole(element, color, surface) {
    if (contrast(neutralCanvas, surface) >= 4.5) return 'dark';
    var className = typeof element.className === 'string' ? element.className.toLowerCase() : '';
    if (element.tagName === 'SMALL' || /muted|description|subtitle|helper|hint|secondary|text-gray|text-slate|text-zinc/.test(className)) return 'muted';
    if (!neutral(color)) return 'accent';
    return 'primary';
  }

  function nearestSurface(element) {
    var current = element;
    while (current && current !== body) {
      var currentStyle = window.getComputedStyle(current);
      var color = parseColor(currentStyle.backgroundColor);
      if (color && color.a > 0.02) {
        var effective = blend(color, neutralCanvas);
        if (current.hasAttribute('data-admin-dark-bg')) {
          return current.getAttribute('data-admin-dark-bg') === 'input' ? { r: 41, g: 42, b: 36 } : { r: 36, g: 37, b: 32 };
        }
        if (color.a > 0.92) return effective;
      }
      current = current.parentElement;
    }
    return neutralCanvas;
  }

  function annotateBackground(element) {
    // Keep our own override stable during a broad DOM rescan. The computed
    // color is dark after the first pass, so reclassifying it would erase the
    // evidence that its authored color was light.
    if (element.hasAttribute('data-admin-dark-bg')) return;
    if (isVisualAsset(element) || semanticSurface(element)) {
      element.removeAttribute('data-admin-dark-bg');
      return;
    }
    var style = window.getComputedStyle(element);
    var role = backgroundRole(element, style);
    if (role) element.setAttribute('data-admin-dark-bg', role);
    else element.removeAttribute('data-admin-dark-bg');
  }

  function annotateInk(element) {
    if (element.hasAttribute('data-admin-dark-ink')) return;
    var hasOwnText = false;
    for (var i = 0; i < element.childNodes.length; i += 1) {
      var node = element.childNodes[i];
      if (node.nodeType === 3 && node.nodeValue.trim()) { hasOwnText = true; break; }
    }
    if (!hasOwnText || isVisualAsset(element) || semanticSurface(element)) {
      element.removeAttribute('data-admin-dark-ink');
      return;
    }
    var color = parseColor(window.getComputedStyle(element).color);
    if (!color || color.a <= 0.02) return;
    var surface = nearestSurface(element);
    if (contrast(blend(color, surface), surface) >= 4.5) {
      element.removeAttribute('data-admin-dark-ink');
      return;
    }
    element.setAttribute('data-admin-dark-ink', foregroundRole(element, color, surface));
  }

  function annotatePseudo(element, pseudo, type) {
    var style = window.getComputedStyle(element, pseudo);
    var bg = parseColor(style.backgroundColor);
    var effective = bg && bg.a > 0.02 ? blend(bg, neutralCanvas) : null;
    var hasGradient = imageHasNeutralLightGradient(style.backgroundImage);
    var bgName = 'data-admin-dark-' + type + '-bg';
    if (!element.hasAttribute(bgName) && !semanticSurface(element) && (hasGradient || (effective && neutral(effective) && luminance(effective) > 0.72))) {
      element.setAttribute(bgName, 'surface');
    }
    var color = parseColor(style.color);
    var content = style.content;
    var inkName = 'data-admin-dark-' + type + '-ink';
    if (!element.hasAttribute(inkName) && content && content !== 'none' && content !== 'normal' && color && luminance(blend(color, neutralCanvas)) < 0.2) {
      element.setAttribute(inkName, 'primary');
    }
  }

  function scan(root) {
    if (!root || (root.nodeType === 1 && isVisualAsset(root))) return;
    var elements = [];
    if (root.nodeType === 1) elements.push(root);
    if (root.querySelectorAll) elements.push.apply(elements, Array.from(root.querySelectorAll('*')));
    elements = elements.filter(function (element) { return !isVisualAsset(element); });

    elements.forEach(annotateBackground);
    elements.forEach(function (element) {
      annotateInk(element);
      annotatePseudo(element, '::before', 'before');
      annotatePseudo(element, '::after', 'after');
    });
  }

  function clearOwnAnnotations(root) {
    if (!root || root.nodeType !== 1) return;
    [
      'data-admin-dark-bg', 'data-admin-dark-ink',
      'data-admin-dark-before-bg', 'data-admin-dark-after-bg',
      'data-admin-dark-before-ink', 'data-admin-dark-after-ink',
    ].forEach(function (attribute) { root.removeAttribute(attribute); });
  }

  function flush() {
    timer = 0;
    if (documentElement.dataset.adminTheme !== 'dark') { pending.clear(); return; }
    var roots = Array.from(pending);
    pending.clear();
    roots.forEach(scan);
  }

  function schedule(root) {
    if (documentElement.dataset.adminTheme !== 'dark') return;
    pending.add(root);
    if (!timer) timer = window.setTimeout(flush, 45);
  }

  scan(body);
  new MutationObserver(function (mutations) {
    var fullScan = false;
    mutations.forEach(function (mutation) {
      if (mutation.type === 'attributes') {
        if (mutation.target === documentElement && mutation.attributeName === 'data-admin-theme') {
          if (documentElement.dataset.adminTheme === 'dark') fullScan = true;
        } else if (mutation.attributeName === 'class' || mutation.attributeName === 'style') {
          clearOwnAnnotations(mutation.target);
          scan(mutation.target);
        }
        return;
      }
      mutation.addedNodes.forEach(function (node) {
        if (node.nodeType !== 1) return;
        if (/^(STYLE|LINK)$/.test(node.tagName)) fullScan = true;
        else schedule(node);
      });
    });
    if (fullScan) schedule(body);
  }).observe(documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-admin-theme', 'class', 'style'] });
  document.addEventListener('load', function (event) {
    var target = event.target;
    if (!target || target.tagName !== 'LINK' || target.rel !== 'stylesheet') return;
    schedule(body);
  }, true);
})();
