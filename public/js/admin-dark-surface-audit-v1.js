(function () {
  'use strict';

  var documentElement = document.documentElement;
  var body = document.body;
  if (!documentElement || !body || !body.classList.contains('experiment-admin')) return;

  var neutralCanvas = { r: 0, g: 0, b: 0 };

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
    if (!rgb) {
      var srgb = text.match(/^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+%?))?\s*\)$/);
      if (!srgb) return null;
      return {
        r: Math.max(0, Math.min(255, Number(srgb[1]) * 255)),
        g: Math.max(0, Math.min(255, Number(srgb[2]) * 255)),
        b: Math.max(0, Math.min(255, Number(srgb[3]) * 255)),
        a: srgb[4] ? (srgb[4].endsWith('%') ? Number(srgb[4].slice(0, -1)) / 100 : Number(srgb[4])) : 1,
      };
    }
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

  function imageHasNeutralGradient(backgroundImage) {
    if (!backgroundImage || backgroundImage === 'none' || /url\s*\(/i.test(backgroundImage)) return false;
    var colors = backgroundImage.match(/rgba?\([^)]*\)|color\(srgb[^)]*\)|#[\da-f]{3,8}\b/gi) || [];
    var parsed = colors.map(parseColor).filter(function (color) { return color && color.a > 0.05; });
    if (!parsed.length || parsed.some(function (color) { return !neutral(color); })) return false;
    // Even a mostly-black gradient can leave a tinted endpoint visible. Treat
    // any neutral gradient with a non-black stop as a surface so dark mode can
    // replace the whole gradient with the exact black canvas color.
    return parsed.some(function (color) { return luminance(blend(color, neutralCanvas)) > 0.001; });
  }

  function isVisualAsset(element) {
    return /^(IMG|VIDEO|CANVAS|PICTURE|IFRAME|OBJECT|EMBED)$/.test(element.tagName)
      || element.matches('.experiment-chart-bar, .admin-theme-swatch, .welcome-live-save-indicator')
      || element.closest('[data-admin-dark-preserve], .admin-dark-mode-preserve');
  }

  function semanticSurface(element) {
    var semanticSelector = '[class*="success"], [class*="error"], [class*="danger"], [class*="warning"], [class*="pending"], [class*="status"], [class*="badge"], [class*="alert"], [class*="toast"], [class*="ready"], [class*="complete"], [class*="available"], .as-live-pill';
    return element.matches(semanticSelector) || Boolean(element.closest(semanticSelector));
  }

  function backgroundRole(element, style) {
    var color = parseColor(style.backgroundColor);
    var visibleColor = color && color.a > 0.02 ? blend(color, neutralCanvas) : null;
    var image = imageHasNeutralGradient(style.backgroundImage);
    if (!image && (!visibleColor || !neutral(visibleColor) || luminance(visibleColor) < 0.001)) return '';

    if (/^(INPUT|SELECT|TEXTAREA)$/.test(element.tagName)) return 'input';
    if (image) return 'surface';
    return luminance(visibleColor) > 0.9 ? 'surface' : 'raised';
  }

  function foregroundRole(element, color, surface) {
    var ancestor = element;
    while (ancestor && ancestor !== body && !ancestor.hasAttribute('data-admin-dark-bg')) ancestor = ancestor.parentElement;
    if (ancestor && ancestor !== body && ancestor.hasAttribute('data-admin-dark-bg')) {
      if (!neutral(color)) return 'accent';
      return luminance(color) < 0.45 ? 'primary' : 'muted';
    }
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
          return neutralCanvas;
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
    var hasGradient = imageHasNeutralGradient(style.backgroundImage);
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

  scan(body);
  documentElement.classList.remove('admin-theme-booting');
  new MutationObserver(function (mutations) {
    mutations.forEach(function (mutation) {
      if (mutation.type === 'attributes') {
        if (mutation.target === documentElement && mutation.attributeName === 'data-admin-theme') {
          if (documentElement.dataset.adminTheme === 'dark') scan(body);
        } else if (mutation.attributeName === 'class' || mutation.attributeName === 'style') {
          clearOwnAnnotations(mutation.target);
          scan(mutation.target);
        }
        return;
      }
      mutation.addedNodes.forEach(function (node) {
        if (node.nodeType !== 1) return;
        if (/^(STYLE|LINK)$/.test(node.tagName)) scan(body);
        else scan(node);
      });
    });
  }).observe(documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-admin-theme', 'class', 'style'] });
  document.addEventListener('load', function (event) {
    var target = event.target;
    if (!target || target.tagName !== 'LINK' || target.rel !== 'stylesheet') return;
    scan(body);
  }, true);
})();
