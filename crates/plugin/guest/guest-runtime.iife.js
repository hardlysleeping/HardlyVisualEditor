"use strict";
(() => {
  // ../../node_modules/@tauri-apps/api/external/tslib/tslib.es6.js
  function __classPrivateFieldGet(receiver, state, kind, f) {
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
    return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
  }
  function __classPrivateFieldSet(receiver, state, value, kind, f) {
    if (kind === "m") throw new TypeError("Private method is not writable");
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a setter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot write private member to an object whose class did not declare it");
    return kind === "a" ? f.call(receiver, value) : f ? f.value = value : state.set(receiver, value), value;
  }

  // ../../node_modules/@tauri-apps/api/core.js
  var _Channel_onmessage;
  var _Channel_nextMessageIndex;
  var _Channel_pendingMessages;
  var _Channel_messageEndIndex;
  var _Resource_rid;
  var SERIALIZE_TO_IPC_FN = "__TAURI_TO_IPC_KEY__";
  function transformCallback(callback, once = false) {
    return window.__TAURI_INTERNALS__.transformCallback(callback, once);
  }
  var Channel = class {
    constructor(onmessage) {
      _Channel_onmessage.set(this, void 0);
      _Channel_nextMessageIndex.set(this, 0);
      _Channel_pendingMessages.set(this, []);
      _Channel_messageEndIndex.set(this, void 0);
      __classPrivateFieldSet(this, _Channel_onmessage, onmessage || (() => {
      }), "f");
      this.id = transformCallback((rawMessage) => {
        const index = rawMessage.index;
        if ("end" in rawMessage) {
          if (index == __classPrivateFieldGet(this, _Channel_nextMessageIndex, "f")) {
            this.cleanupCallback();
          } else {
            __classPrivateFieldSet(this, _Channel_messageEndIndex, index, "f");
          }
          return;
        }
        const message = rawMessage.message;
        if (index == __classPrivateFieldGet(this, _Channel_nextMessageIndex, "f")) {
          __classPrivateFieldGet(this, _Channel_onmessage, "f").call(this, message);
          __classPrivateFieldSet(this, _Channel_nextMessageIndex, __classPrivateFieldGet(this, _Channel_nextMessageIndex, "f") + 1, "f");
          while (__classPrivateFieldGet(this, _Channel_nextMessageIndex, "f") in __classPrivateFieldGet(this, _Channel_pendingMessages, "f")) {
            const message2 = __classPrivateFieldGet(this, _Channel_pendingMessages, "f")[__classPrivateFieldGet(this, _Channel_nextMessageIndex, "f")];
            __classPrivateFieldGet(this, _Channel_onmessage, "f").call(this, message2);
            delete __classPrivateFieldGet(this, _Channel_pendingMessages, "f")[__classPrivateFieldGet(this, _Channel_nextMessageIndex, "f")];
            __classPrivateFieldSet(this, _Channel_nextMessageIndex, __classPrivateFieldGet(this, _Channel_nextMessageIndex, "f") + 1, "f");
          }
          if (__classPrivateFieldGet(this, _Channel_nextMessageIndex, "f") === __classPrivateFieldGet(this, _Channel_messageEndIndex, "f")) {
            this.cleanupCallback();
          }
        } else {
          __classPrivateFieldGet(this, _Channel_pendingMessages, "f")[index] = message;
        }
      });
    }
    cleanupCallback() {
      window.__TAURI_INTERNALS__.unregisterCallback(this.id);
    }
    set onmessage(handler) {
      __classPrivateFieldSet(this, _Channel_onmessage, handler, "f");
    }
    get onmessage() {
      return __classPrivateFieldGet(this, _Channel_onmessage, "f");
    }
    [(_Channel_onmessage = /* @__PURE__ */ new WeakMap(), _Channel_nextMessageIndex = /* @__PURE__ */ new WeakMap(), _Channel_pendingMessages = /* @__PURE__ */ new WeakMap(), _Channel_messageEndIndex = /* @__PURE__ */ new WeakMap(), SERIALIZE_TO_IPC_FN)]() {
      return `__CHANNEL__:${this.id}`;
    }
    toJSON() {
      return this[SERIALIZE_TO_IPC_FN]();
    }
  };
  async function invoke(cmd, args = {}, options) {
    return window.__TAURI_INTERNALS__.invoke(cmd, args, options);
  }
  _Resource_rid = /* @__PURE__ */ new WeakMap();

  // src/inspector-ui-guard.ts
  var INSPECTOR_UI_SELECTOR = [
    "#visual-editor-overlay-root",
    "#visual-editor-toolbar-root",
    "[data-visual-editor-toolbar]",
    "[data-visual-editor-ui]",
    "[data-visual-editor-picker-toggle]",
    "[data-visual-editor-screenshot-editor]",
    "[data-visual-editor-chip]",
    "[data-visual-editor-capture-chip]",
    "[data-visual-editor-composer-tail]",
    "[data-visual-editor-nav]"
  ].join(",");
  function isInspectorUiElement(el) {
    if (!(el instanceof HTMLElement)) {
      return false;
    }
    return Boolean(el.closest(INSPECTOR_UI_SELECTOR));
  }
  function eventHitsInspectorUi(event) {
    if (typeof event.composedPath === "function") {
      for (const node of event.composedPath()) {
        if (isInspectorUiElement(node)) {
          return true;
        }
      }
    }
    if (event.target instanceof Element && isInspectorUiElement(event.target)) {
      return true;
    }
    if ("clientX" in event && "clientY" in event && typeof event.clientX === "number" && typeof event.clientY === "number") {
      const hit = document.elementFromPoint(event.clientX, event.clientY);
      return isInspectorUiElement(hit);
    }
    return false;
  }

  // src/hover.ts
  var INTERACTIVE_TAGS = /* @__PURE__ */ new Set(["button", "input", "a", "select", "textarea", "label"]);
  function hasInspectorId(el) {
    return el.hasAttribute("data-inspector-id");
  }
  function hasInspectorComponent(el) {
    return el.hasAttribute("data-inspector-component");
  }
  function isInteractive(el) {
    const tag = el.tagName.toLowerCase();
    if (INTERACTIVE_TAGS.has(tag)) {
      return true;
    }
    const role = el.getAttribute("role");
    return role !== null && role.length > 0;
  }
  function isSensibleSize(el) {
    const rect = el.getBoundingClientRect();
    return rect.width >= 8 && rect.height >= 8;
  }
  function scoreCandidate(el) {
    if (hasInspectorId(el)) {
      return 50;
    }
    if (hasInspectorComponent(el)) {
      return 40;
    }
    if (isInteractive(el)) {
      return 30;
    }
    if (isSensibleSize(el)) {
      return 20;
    }
    if (el.children.length === 0) {
      return 10;
    }
    return 0;
  }
  function resolveHoverTarget(raw) {
    if (isInspectorUiElement(raw)) {
      return null;
    }
    let current = raw;
    let best = null;
    let bestScore = -1;
    while (current && current !== document.documentElement) {
      if (isInspectorUiElement(current)) {
        current = current.parentElement;
        continue;
      }
      const score = scoreCandidate(current);
      if (score > bestScore) {
        best = current;
        bestScore = score;
      }
      if (score >= 50) {
        return current;
      }
      current = current.parentElement;
    }
    return best ?? raw;
  }

  // src/dom-resolve.ts
  function findElementBySelector(selector) {
    if (!selector.trim()) return null;
    try {
      return document.querySelector(selector);
    } catch {
      return null;
    }
  }
  function findElementForSnapshot(snapshot, selector) {
    const bySelector = findElementBySelector(selector);
    if (bySelector) return bySelector;
    const id = snapshot.attributes.find(([key]) => key === "id")?.[1];
    if (id) {
      const byId = document.getElementById(id);
      if (byId) return byId;
    }
    const inspectorId = snapshot.attributes.find(([key]) => key === "data-inspector-id")?.[1];
    if (inspectorId) {
      const byInspector = document.querySelector(`[data-inspector-id="${CSS.escape(inspectorId)}"]`);
      if (byInspector) return byInspector;
    }
    return null;
  }

  // src/constants.ts
  var CURATED_CSS_PROPERTIES = [
    "display",
    "position",
    "top",
    "right",
    "bottom",
    "left",
    "width",
    "height",
    "min-width",
    "max-width",
    "min-height",
    "max-height",
    "margin",
    "padding",
    "flex",
    "flex-direction",
    "flex-wrap",
    "flex-grow",
    "flex-shrink",
    "flex-basis",
    "grid-template-columns",
    "order",
    "align-items",
    "align-self",
    "justify-content",
    "gap",
    "z-index",
    "overflow",
    "pointer-events",
    "opacity",
    "transform",
    "translate",
    "color",
    "background-color",
    "font-size",
    "border-radius",
    "border-width",
    "border-color"
  ];
  var MAX_CSS_PROPERTIES = 40;
  var CLOSED_SHADOW_HINT = " [closed shadow root \u2014 outer host only]";

  // src/dom-path.ts
  function segment(element) {
    const tag = element.tagName.toLowerCase();
    if (element.id) {
      return `${tag}#${escapeId(element.id)}`;
    }
    const parent = element.parentElement;
    if (!parent) {
      return tag;
    }
    const siblings = Array.from(parent.children).filter((child) => child.tagName === element.tagName);
    if (siblings.length <= 1) {
      return tag;
    }
    const index = siblings.indexOf(element) + 1;
    return `${tag}:nth-of-type(${index})`;
  }
  function escapeId(value) {
    return Array.from(value, (character, index) => {
      const code = character.codePointAt(0) ?? 0;
      if (index === 0 && /[0-9]/.test(character) || code === 0) return `\\${code.toString(16)} `;
      if (/[-_a-zA-Z0-9]/.test(character) || code >= 128) return character;
      return `\\${character}`;
    }).join("");
  }
  function buildDomPath(element) {
    const parts = [];
    let closedHint = false;
    let current = element;
    while (current) {
      parts.unshift(segment(current));
      const parent = current.parentElement;
      if (parent) {
        current = parent;
        continue;
      }
      const root = current.getRootNode();
      if (root instanceof ShadowRoot) {
        if (root.mode === "closed") {
          closedHint = true;
        }
        current = root.host;
        continue;
      }
      break;
    }
    const path = parts.join(" > ");
    return closedHint ? `${path}${CLOSED_SHADOW_HINT}` : path;
  }

  // src/text-nodes.ts
  function ownTextNodes(element) {
    return Array.from(element.childNodes).filter(
      (node) => node instanceof Text && node.data.trim().length > 0
    );
  }

  // src/measure.ts
  var REUSABLE_LAYOUT_PROPERTIES = [
    "display",
    "flex-direction",
    "flex-wrap",
    "flex-grow",
    "flex-shrink",
    "flex-basis",
    "grid-template-columns",
    "order",
    "align-items",
    "align-self",
    "justify-content",
    "gap",
    "width",
    "height",
    "min-width",
    "max-width",
    "min-height",
    "max-height",
    "margin",
    "margin-top",
    "margin-right",
    "margin-bottom",
    "margin-left",
    "padding",
    "padding-top",
    "padding-right",
    "padding-bottom",
    "padding-left",
    "color",
    "background-color",
    "font-size",
    "font-weight",
    "line-height",
    "border-radius",
    "border-width",
    "border-color",
    "translate"
  ];
  function round(value) {
    return Math.round(value * 1e3) / 1e3;
  }
  function rectToBounds(rect) {
    return {
      x: round(rect.x),
      y: round(rect.y),
      width: round(rect.width),
      height: round(rect.height)
    };
  }
  function reusableMarkup(element) {
    const raw = element.outerHTML;
    if (raw.length > 1e5) return void 0;
    const sources = [element, ...Array.from(element.querySelectorAll("*"))];
    if (sources.length > 50) return raw;
    for (const source of sources) {
      let depth = 0;
      for (let parent = source.parentElement; parent && parent !== element; parent = parent.parentElement) depth += 1;
      if (depth > 8) return raw;
    }
    const clone = element.cloneNode(true);
    const copies = [clone, ...Array.from(clone.querySelectorAll("*"))];
    sources.forEach((source, index) => {
      const target = copies[index];
      if (!(target instanceof HTMLElement)) return;
      const computed = globalThis.getComputedStyle(source);
      for (const property of REUSABLE_LAYOUT_PROPERTIES) {
        const value = computed.getPropertyValue(property).trim();
        if (value && !["auto", "normal", "none"].includes(value)) target.style.setProperty(property, value);
      }
    });
    const markup = clone.outerHTML;
    return markup.length <= 1e5 ? markup : raw;
  }
  function intersectBounds(a, b) {
    const x1 = Math.max(a.x, b.x);
    const y1 = Math.max(a.y, b.y);
    const x2 = Math.min(a.x + a.width, b.x + b.width);
    const y2 = Math.min(a.y + a.height, b.y + b.height);
    if (x2 <= x1 || y2 <= y1) {
      return null;
    }
    return { x: round(x1), y: round(y1), width: round(x2 - x1), height: round(y2 - y1) };
  }
  function resolveViewport(ctx) {
    const width = ctx.viewportWidth ?? globalThis.innerWidth ?? 0;
    const height = ctx.viewportHeight ?? globalThis.innerHeight ?? 0;
    return { x: 0, y: 0, width, height };
  }
  function computeVisibility(cssBounds, viewport) {
    if (cssBounds.width <= 0 || cssBounds.height <= 0) {
      return {
        visibility: "outside_viewport",
        visibleBounds: null,
        fullBounds: cssBounds
      };
    }
    const intersection = intersectBounds(cssBounds, viewport);
    if (!intersection) {
      return {
        visibility: "outside_viewport",
        visibleBounds: null,
        fullBounds: cssBounds
      };
    }
    const fullyVisible = intersection.x <= cssBounds.x + 1e-3 && intersection.y <= cssBounds.y + 1e-3 && intersection.width >= cssBounds.width - 1e-3 && intersection.height >= cssBounds.height - 1e-3;
    if (fullyVisible) {
      return { visibility: "visible", visibleBounds: null, fullBounds: null };
    }
    return {
      visibility: "partially_visible",
      visibleBounds: intersection,
      fullBounds: cssBounds
    };
  }
  function collectAttributes(element) {
    const pairs = [];
    for (const attr of Array.from(element.attributes)) {
      pairs.push([attr.name, attr.value]);
    }
    return pairs;
  }
  function collectComputedLayout(element) {
    const style = globalThis.getComputedStyle(element);
    const layout = [];
    for (const key of CURATED_CSS_PROPERTIES) {
      if (layout.length >= MAX_CSS_PROPERTIES) {
        break;
      }
      const value = style.getPropertyValue(key);
      if (value) {
        layout.push([key, value]);
      }
    }
    layout.push(["--hardlyui-viewport-width", String(document.documentElement?.clientWidth || globalThis.innerWidth || 0)]);
    layout.push(["--hardlyui-viewport-height", String(document.documentElement?.clientHeight || globalThis.innerHeight || 0)]);
    layout.push(["--hardlyui-root-font-size", globalThis.getComputedStyle(document.documentElement).fontSize]);
    return layout;
  }
  function collectCssVariables(element) {
    const values = /* @__PURE__ */ new Map();
    for (const source of [
      globalThis.getComputedStyle(document.documentElement),
      globalThis.getComputedStyle(element)
    ]) {
      for (let index = 0; index < source.length; index += 1) {
        const name = source.item(index);
        if (!name.startsWith("--")) continue;
        const value = source.getPropertyValue(name).trim();
        if (value && value.length <= 200) values.set(name, value);
      }
    }
    const designTokenPriority = /(?:color|colour|background|foreground|surface|text|space|spacing|gap|font|type|radius|round|shadow|border|accent)/i;
    return [...values.entries()].sort(([left], [right]) => {
      const priority = Number(designTokenPriority.test(right)) - Number(designTokenPriority.test(left));
      return priority || left.localeCompare(right);
    }).slice(0, 40);
  }
  function toPhysical(bounds, dpr) {
    return {
      x: round(bounds.x * dpr),
      y: round(bounds.y * dpr),
      width: round(bounds.width * dpr),
      height: round(bounds.height * dpr)
    };
  }
  function elementText(element) {
    const text = element.textContent?.trim() ?? "";
    if (!text) {
      return null;
    }
    return text.length > 200 ? `${text.slice(0, 197)}...` : text;
  }
  function editableLeafText(element) {
    if (element.children.length > 0) return null;
    const text = element.textContent ?? "";
    return text.length <= 5e3 ? text : null;
  }
  function ownTextNodeValues(element) {
    return ownTextNodes(element).map((node) => node.data ?? "").filter((value) => value.trim().length > 0).slice(0, 32).map((value) => value.length > 5e3 ? value.slice(0, 5e3) : value);
  }
  function measureElement(element, ctx) {
    const dpr = ctx.devicePixelRatio ?? globalThis.devicePixelRatio ?? 1;
    const rect = element.getBoundingClientRect();
    const cssBounds = rectToBounds(rect);
    const viewport = resolveViewport(ctx);
    const { visibility, visibleBounds, fullBounds } = computeVisibility(cssBounds, viewport);
    return {
      webview_id: ctx.webviewId,
      tag: element.tagName.toLowerCase(),
      text: elementText(element),
      editable_text: editableLeafText(element),
      text_nodes: ownTextNodeValues(element),
      attributes: collectAttributes(element),
      dom_path: buildDomPath(element),
      outer_html: element.outerHTML.length <= 1e5 ? element.outerHTML : void 0,
      reusable_html: reusableMarkup(element),
      parent_dom_path: element.parentElement ? buildDomPath(element.parentElement) : null,
      parent_child_index: element.parentElement ? Array.from(element.parentElement.children).indexOf(element) : null,
      visibility,
      css_bounds: cssBounds,
      physical_bounds: toPhysical(cssBounds, dpr),
      visible_bounds: visibleBounds,
      full_bounds: fullBounds,
      computed_layout: collectComputedLayout(element),
      css_variables: collectCssVariables(element),
      layout_children: Array.from(element.children).slice(0, 20).map((child, index) => {
        const childBounds = child.getBoundingClientRect();
        const childStyle = globalThis.getComputedStyle(child);
        const margin = (side) => childStyle[`margin${side}`] === "auto" ? 1e6 : round(Number.parseFloat(childStyle[`margin${side}`]) || 0);
        return {
          index,
          x: round(childBounds.left - rect.left),
          y: round(childBounds.top - rect.top),
          width: round(childBounds.width),
          height: round(childBounds.height),
          margin_left: margin("Left"),
          margin_right: margin("Right"),
          margin_top: margin("Top"),
          margin_bottom: margin("Bottom"),
          position: childStyle.position
        };
      })
    };
  }

  // src/navigation-watch.ts
  function watchNavigation(onNavigate) {
    let lastHref = location.href;
    const fire = () => {
      const href = location.href;
      if (href === lastHref) return;
      lastHref = href;
      onNavigate();
    };
    const onPopState = () => fire();
    const onHashChange = () => fire();
    window.addEventListener("popstate", onPopState);
    window.addEventListener("hashchange", onHashChange);
    const historyRef = window.history;
    const origPush = historyRef.pushState.bind(historyRef);
    const origReplace = historyRef.replaceState.bind(historyRef);
    historyRef.pushState = (...args) => {
      origPush(...args);
      queueMicrotask(fire);
    };
    historyRef.replaceState = (...args) => {
      origReplace(...args);
      queueMicrotask(fire);
    };
    return () => {
      window.removeEventListener("popstate", onPopState);
      window.removeEventListener("hashchange", onHashChange);
      historyRef.pushState = origPush;
      historyRef.replaceState = origReplace;
    };
  }

  // src/capture-ui.ts
  var HIDE_ATTR = "data-visual-editor-capture-hide";
  function markCaptureHideRoot(el) {
    el.setAttribute(HIDE_ATTR, "true");
  }
  function suspendCaptureUi() {
    for (const el of document.querySelectorAll(`[${HIDE_ATTR}]`)) {
      if (!(el instanceof HTMLElement)) continue;
      if (el.dataset.veCaptureHidden === "true") continue;
      el.dataset.veCaptureHidden = "true";
      el.dataset.veCapturePrevDisplay = el.style.display;
      el.style.display = "none";
    }
  }
  function resumeCaptureUi() {
    for (const el of document.querySelectorAll(`[${HIDE_ATTR}]`)) {
      if (!(el instanceof HTMLElement)) continue;
      if (el.dataset.veCaptureHidden !== "true") continue;
      el.style.display = el.dataset.veCapturePrevDisplay ?? "";
      delete el.dataset.veCaptureHidden;
      delete el.dataset.veCapturePrevDisplay;
    }
  }

  // src/overlay.ts
  var ROOT_ID = "visual-editor-overlay-root";
  function ensureRoot() {
    let root = document.getElementById(ROOT_ID);
    if (!root) {
      root = document.createElement("div");
      root.id = ROOT_ID;
      root.setAttribute("data-visual-editor-overlay", "true");
      markCaptureHideRoot(root);
      Object.assign(root.style, {
        position: "fixed",
        inset: "0",
        pointerEvents: "none",
        zIndex: "2147483646"
      });
      document.documentElement.appendChild(root);
    }
    return root;
  }
  function boxStyle(bounds, color) {
    return {
      position: "fixed",
      left: `${bounds.x}px`,
      top: `${bounds.y}px`,
      width: `${bounds.width}px`,
      height: `${bounds.height}px`,
      border: `1px solid ${color}`,
      boxSizing: "border-box",
      pointerEvents: "none"
    };
  }
  function labelFor(snapshot) {
    const component = snapshot.attributes.find(([k]) => k === "data-inspector-component")?.[1];
    return component ?? snapshot.tag;
  }
  var OverlayRenderer = class {
    hoverEl = null;
    hoverLabel = null;
    focusEl = null;
    focusLabel = null;
    overlayColor = "#3b82f6";
    selectionColor = "#22c55e";
    focusColor = "#f59e0b";
    guideElements = [];
    zoomLabel = null;
    configure(options) {
      if (options.overlayColor) {
        this.overlayColor = options.overlayColor;
      }
    }
    mount() {
      ensureRoot();
    }
    unmount() {
      document.getElementById(ROOT_ID)?.remove();
      this.hoverEl = null;
      this.hoverLabel = null;
      this.focusEl = null;
      this.focusLabel = null;
    }
    setHover(snapshot) {
      const root = ensureRoot();
      if (!snapshot) {
        this.hoverEl?.remove();
        this.hoverLabel?.remove();
        this.hoverEl = null;
        this.hoverLabel = null;
        return;
      }
      if (!this.hoverEl) {
        this.hoverEl = document.createElement("div");
        this.hoverLabel = document.createElement("div");
        Object.assign(this.hoverLabel.style, {
          position: "fixed",
          font: "11px/1.2 system-ui, sans-serif",
          background: "rgba(59,130,246,0.9)",
          color: "#fff",
          padding: "2px 4px",
          borderRadius: "2px",
          pointerEvents: "none"
        });
        root.appendChild(this.hoverEl);
        root.appendChild(this.hoverLabel);
      }
      Object.assign(this.hoverEl.style, boxStyle(snapshot.css_bounds, this.overlayColor));
      Object.assign(this.hoverLabel.style, {
        left: `${snapshot.css_bounds.x}px`,
        top: `${Math.max(0, snapshot.css_bounds.y - 16)}px`
      });
      this.hoverLabel.textContent = labelFor(snapshot);
    }
    setFocus(snapshot) {
      const root = ensureRoot();
      if (!snapshot) {
        this.focusEl?.remove();
        this.focusLabel?.remove();
        this.focusEl = null;
        this.focusLabel = null;
        return;
      }
      if (!this.focusEl) {
        this.focusEl = document.createElement("div");
        this.focusLabel = document.createElement("div");
        Object.assign(this.focusLabel.style, {
          position: "fixed",
          font: "11px/1.2 system-ui, sans-serif",
          background: "rgba(245,158,11,0.95)",
          color: "#111",
          padding: "2px 6px",
          borderRadius: "2px",
          pointerEvents: "none",
          fontWeight: "600"
        });
        root.appendChild(this.focusEl);
        root.appendChild(this.focusLabel);
      }
      Object.assign(this.focusEl.style, {
        ...boxStyle(snapshot.css_bounds, this.focusColor),
        borderWidth: "2px",
        boxShadow: "0 0 0 2px rgba(245,158,11,0.35)"
      });
      Object.assign(this.focusLabel.style, {
        left: `${snapshot.css_bounds.x}px`,
        top: `${Math.max(0, snapshot.css_bounds.y - 18)}px`
      });
      this.focusLabel.textContent = labelFor(snapshot);
    }
    setGuides(vertical, horizontal) {
      this.guideElements.forEach((guide) => guide.remove());
      this.guideElements = [];
      const root = ensureRoot();
      if (vertical !== null) {
        const guide = document.createElement("div");
        guide.setAttribute("aria-hidden", "true");
        Object.assign(guide.style, {
          position: "fixed",
          left: `${vertical}px`,
          top: "0",
          bottom: "0",
          width: "1px",
          background: "rgba(255,91,110,0.95)",
          boxShadow: "0 0 3px rgba(255,91,110,0.8)",
          pointerEvents: "none"
        });
        root.appendChild(guide);
        this.guideElements.push(guide);
      }
      if (horizontal !== null) {
        const guide = document.createElement("div");
        guide.setAttribute("aria-hidden", "true");
        Object.assign(guide.style, {
          position: "fixed",
          left: "0",
          top: `${horizontal}px`,
          right: "0",
          height: "1px",
          background: "rgba(255,91,110,0.95)",
          boxShadow: "0 0 3px rgba(255,91,110,0.8)",
          pointerEvents: "none"
        });
        root.appendChild(guide);
        this.guideElements.push(guide);
      }
    }
    setZoom(zoom) {
      if (zoom <= 0) {
        this.zoomLabel?.remove();
        this.zoomLabel = null;
        return;
      }
      const root = ensureRoot();
      if (!this.zoomLabel) {
        this.zoomLabel = document.createElement("div");
        Object.assign(this.zoomLabel.style, {
          position: "fixed",
          right: "12px",
          bottom: "12px",
          padding: "4px 7px",
          border: "1px solid rgba(255,255,255,0.2)",
          borderRadius: "6px",
          background: "rgba(15,18,24,0.9)",
          color: "#fff",
          font: "11px/1.2 system-ui,sans-serif",
          pointerEvents: "none"
        });
        root.appendChild(this.zoomLabel);
      }
      this.zoomLabel.textContent = `Canvas ${Math.round(zoom * 100)}% \xB7 snap ${Math.round(8 * zoom)}px`;
    }
    renderSelections(selections, onGestureStart) {
      const root = ensureRoot();
      root.querySelectorAll("[data-ve-selection]").forEach((el) => el.remove());
      selections.forEach((item, index) => {
        const box = document.createElement("div");
        box.setAttribute("data-ve-selection", item.id);
        const badge = document.createElement("div");
        badge.setAttribute("data-ve-selection", item.id);
        badge.textContent = `#${index + 1}`;
        Object.assign(box.style, boxStyle(item.snapshot.css_bounds, this.selectionColor));
        Object.assign(badge.style, {
          position: "fixed",
          left: `${item.snapshot.css_bounds.x}px`,
          top: `${Math.max(0, item.snapshot.css_bounds.y - 16)}px`,
          font: "11px/1.2 system-ui, sans-serif",
          background: "rgba(34,197,94,0.95)",
          color: "#fff",
          padding: "2px 4px",
          borderRadius: "2px",
          pointerEvents: "none"
        });
        root.appendChild(box);
        root.appendChild(badge);
        const moveHandle = document.createElement("button");
        moveHandle.type = "button";
        moveHandle.setAttribute("data-ve-selection", item.id);
        moveHandle.setAttribute("aria-label", selections.length > 1 ? `Drag to move ${selections.length} selected items. Hold Shift to lock an axis.` : `Drag to move ${labelFor(item.snapshot)}. Hold Shift to lock an axis.`);
        moveHandle.title = selections.length > 1 ? `Drag ${selections.length} selected items \xB7 Shift locks an axis` : "Drag to move \xB7 hold Shift to lock an axis";
        Object.assign(moveHandle.style, {
          position: "fixed",
          left: `${Math.max(0, Math.min(window.innerWidth - 24, item.snapshot.css_bounds.x + item.snapshot.css_bounds.width - 22))}px`,
          top: `${Math.max(0, item.snapshot.css_bounds.y)}px`,
          width: "22px",
          height: "22px",
          display: "grid",
          placeItems: "center",
          padding: "0",
          border: `1px solid ${this.selectionColor}`,
          borderRadius: "5px",
          background: "rgba(8,18,14,0.92)",
          color: "#fff",
          font: "14px/1 system-ui,sans-serif",
          cursor: "move",
          pointerEvents: "auto",
          touchAction: "none"
        });
        moveHandle.textContent = "\u283F";
        moveHandle.addEventListener("pointerdown", (event) => onGestureStart?.(event, item, "move"));
        root.appendChild(moveHandle);
        const resizeHandle = document.createElement("button");
        resizeHandle.type = "button";
        resizeHandle.setAttribute("data-ve-selection", item.id);
        resizeHandle.setAttribute("aria-label", selections.length > 1 ? `Drag to resize ${selections.length} selected items` : `Drag to resize ${labelFor(item.snapshot)}`);
        resizeHandle.title = selections.length > 1 ? `Resize ${selections.length} selected items together` : "Drag to resize";
        Object.assign(resizeHandle.style, {
          position: "fixed",
          left: `${Math.max(0, Math.min(window.innerWidth - 12, item.snapshot.css_bounds.x + item.snapshot.css_bounds.width - 12))}px`,
          top: `${Math.max(0, Math.min(window.innerHeight - 12, item.snapshot.css_bounds.y + item.snapshot.css_bounds.height - 12))}px`,
          width: "12px",
          height: "12px",
          padding: "0",
          border: `2px solid ${this.selectionColor}`,
          borderRadius: "3px",
          background: "#fff",
          cursor: "nwse-resize",
          pointerEvents: "auto",
          touchAction: "none"
        });
        resizeHandle.addEventListener("pointerdown", (event) => onGestureStart?.(event, item, "resize"));
        root.appendChild(resizeHandle);
      });
    }
  };

  // src/selection.ts
  function parsePixelTranslation(value) {
    if (!value || value === "none") return [0, 0];
    const match = value.trim().match(/^(-?(?:\d+\.?\d*|\.\d+))px(?:\s+(-?(?:\d+\.?\d*|\.\d+))px)?$/);
    return match ? [Number(match[1]), Number(match[2] ?? 0)] : null;
  }
  function stableIdentity(element, webviewId2) {
    const selector = buildDomPath(element);
    let hash = 2166136261;
    for (let index = 0; index < selector.length; index += 1) hash = Math.imul(hash ^ selector.charCodeAt(index), 16777619);
    return {
      webview_id: webviewId2,
      inspector_id: element.getAttribute("data-inspector-id"),
      html_id: element.id || null,
      semantic_selector: selector,
      generated_id: element.getAttribute("data-hardlyui-id") ?? `hardlyui-${(hash >>> 0).toString(36)}`
    };
  }
  function roundPixel(value) {
    return `${Math.round(value * 100) / 100}px`;
  }
  var SelectionEngine = class {
    overlay = new OverlayRenderer();
    options;
    active = false;
    passthrough = false;
    hoverTarget = null;
    selections = [];
    nextId = 1;
    canvasGesture = null;
    zoomFactor = 1;
    originalBodyZoom = "";
    unwatchNavigation = null;
    constructor(options) {
      this.options = options;
      this.unwatchNavigation = watchNavigation(() => this.handleNavigation());
    }
    /** Remove all overlay boxes (selection, hover, chip focus). */
    clearVisuals() {
      this.selections = [];
      this.hoverTarget = null;
      this.overlay.setHover(null);
      this.overlay.setFocus(null);
      this.overlay.renderSelections([]);
    }
    handleNavigation() {
      this.clearVisuals();
      this.options.onNavigation?.(this.options.webviewId);
    }
    destroy() {
      this.unwatchNavigation?.();
      this.unwatchNavigation = null;
      this.deactivate();
      this.overlay.unmount();
    }
    configure(options) {
      this.overlay.configure(options);
    }
    activate() {
      if (this.active) {
        return;
      }
      this.active = true;
      this.originalBodyZoom = document.body?.style.zoom ?? "";
      this.zoomFactor = 1;
      this.overlay.mount();
      this.overlay.setZoom(this.zoomFactor);
      window.addEventListener("pointerdown", this.onPointerDown, true);
      window.addEventListener("pointermove", this.onPointerMove, true);
      window.addEventListener("pointerup", this.onPointerUp, true);
      window.addEventListener("pointercancel", this.onPointerCancel, true);
      window.addEventListener("wheel", this.onWheel, { capture: true, passive: false });
      window.addEventListener("click", this.onClick, true);
      window.addEventListener("keydown", this.onKeyDown, true);
      window.addEventListener("keyup", this.onKeyUp, true);
    }
    deactivate() {
      if (!this.active) {
        return;
      }
      this.active = false;
      window.removeEventListener("pointerdown", this.onPointerDown, true);
      window.removeEventListener("pointermove", this.onPointerMove, true);
      window.removeEventListener("pointerup", this.onPointerUp, true);
      window.removeEventListener("pointercancel", this.onPointerCancel, true);
      window.removeEventListener("wheel", this.onWheel, true);
      window.removeEventListener("click", this.onClick, true);
      window.removeEventListener("keydown", this.onKeyDown, true);
      window.removeEventListener("keyup", this.onKeyUp, true);
      this.cancelCanvasGesture();
      if (document.body) document.body.style.zoom = this.originalBodyZoom;
      this.zoomFactor = 1;
      this.overlay.setZoom(0);
      this.clearVisuals();
    }
    highlightElement(element) {
      const hubSnapshot = element.snapshot;
      const live = findElementForSnapshot(hubSnapshot, element.selector);
      const snapshot = live ? this.measure(live) : hubSnapshot;
      this.overlay.mount();
      this.overlay.setFocus(snapshot);
      live?.scrollIntoView({ block: "center", behavior: "smooth" });
    }
    async selectElement(selector) {
      let matches;
      try {
        matches = document.querySelectorAll(selector);
      } catch {
        throw new Error("The structure item no longer matches this page");
      }
      if (matches.length !== 1 || !(matches[0] instanceof HTMLElement)) {
        throw new Error("The structure item is no longer unique on this page");
      }
      const target = matches[0];
      const snapshot = this.measure(target);
      await this.options.reportSelection(snapshot, "replace");
      const selection = { id: `tree-${this.nextId++}`, label: snapshot.tag, snapshot };
      this.selections = [selection];
      this.overlay.mount();
      this.overlay.renderSelections(this.selections, this.onOverlayGestureStart);
      this.overlay.setFocus(snapshot);
      target.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
    measure(el) {
      return measureElement(el, { webviewId: this.options.webviewId });
    }
    onPointerDown = (event) => {
      if (!this.active) {
        return;
      }
      if (eventHitsInspectorUi(event)) {
        this.hoverTarget = null;
        this.overlay.setHover(null);
      }
    };
    onPointerMove = (event) => {
      if (this.canvasGesture?.pointerId === event.pointerId) {
        this.updateCanvasGesture(event);
        return;
      }
      if (!this.active || this.passthrough) {
        return;
      }
      const raw = document.elementFromPoint(event.clientX, event.clientY);
      if (isInspectorUiElement(raw)) {
        this.hoverTarget = null;
        this.overlay.setHover(null);
        return;
      }
      const target = resolveHoverTarget(raw);
      this.hoverTarget = target;
      this.overlay.setHover(target ? this.measure(target) : null);
    };
    onPointerUp = (event) => {
      if (this.canvasGesture?.pointerId === event.pointerId) void this.finishCanvasGesture();
    };
    onPointerCancel = (event) => {
      if (this.canvasGesture?.pointerId === event.pointerId) this.cancelCanvasGesture();
    };
    onWheel = (event) => {
      if (!this.active || !event.ctrlKey || eventHitsInspectorUi(event)) return;
      event.preventDefault();
      event.stopPropagation();
      this.zoomFactor = Math.min(2.5, Math.max(0.5, this.zoomFactor * (event.deltaY < 0 ? 1.1 : 1 / 1.1)));
      if (document.body) document.body.style.zoom = String(Math.round(this.zoomFactor * 1e3) / 1e3);
      this.overlay.setZoom(this.zoomFactor);
      this.selections = this.selections.map((selection) => {
        const live = findElementForSnapshot(selection.snapshot, selection.snapshot.dom_path);
        return live ? { ...selection, snapshot: this.measure(live) } : selection;
      });
      this.overlay.renderSelections(this.selections, this.onOverlayGestureStart);
    };
    onOverlayGestureStart = (event, selection, kind) => {
      if (!this.active || event.button !== 0 || this.canvasGesture) return;
      const live = findElementForSnapshot(selection.snapshot, selection.snapshot.dom_path);
      if (!(live instanceof HTMLElement) || live === document.body || live === document.documentElement) return;
      const computed = getComputedStyle(live);
      if (computed.getPropertyValue("--hardlyui-locked").trim() === "1") return;
      const translation = parsePixelTranslation(computed.translate);
      if (!translation) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      const handle = event.currentTarget;
      if (handle instanceof HTMLElement) {
        try {
          handle.setPointerCapture(event.pointerId);
        } catch {
        }
      }
      const bounds = live.getBoundingClientRect();
      const targets = this.selections.length > 1 ? this.selections : [selection];
      const entries = targets.flatMap((candidate) => {
        const target = findElementForSnapshot(candidate.snapshot, candidate.snapshot.dom_path);
        if (!(target instanceof HTMLElement) || target === document.body || target === document.documentElement) return [];
        const targetStyle = getComputedStyle(target);
        if (targetStyle.getPropertyValue("--hardlyui-locked").trim() === "1") return [];
        const targetTranslation = parsePixelTranslation(targetStyle.translate);
        if (!targetTranslation) return [];
        const targetBounds = target.getBoundingClientRect();
        return [{
          element: target,
          snapshot: candidate.snapshot,
          beforeTranslate: target.style.getPropertyValue("translate") || null,
          beforeWidth: target.style.getPropertyValue("width") || null,
          beforeHeight: target.style.getPropertyValue("height") || null,
          baseX: targetTranslation[0],
          baseY: targetTranslation[1],
          baseWidth: Number.parseFloat(targetStyle.width) || targetBounds.width,
          baseHeight: Number.parseFloat(targetStyle.height) || targetBounds.height
        }];
      });
      if (!entries.some((entry) => entry.element === live)) return;
      const moving = kind === "move" ? entries.filter((entry) => !entries.some((other) => other.element !== entry.element && other.element.contains(entry.element))) : entries;
      const left = Math.min(...moving.map(({ element }) => element.getBoundingClientRect().left));
      const top = Math.min(...moving.map(({ element }) => element.getBoundingClientRect().top));
      const right = Math.max(...moving.map(({ element }) => element.getBoundingClientRect().right));
      const bottom = Math.max(...moving.map(({ element }) => element.getBoundingClientRect().bottom));
      const guideBounds = new DOMRect(left, top, right - left, bottom - top);
      this.canvasGesture = {
        pointerId: event.pointerId,
        kind,
        element: live,
        snapshot: selection.snapshot,
        startX: event.clientX,
        startY: event.clientY,
        bounds,
        beforeTranslate: live.style.getPropertyValue("translate") || null,
        beforeWidth: live.style.getPropertyValue("width") || null,
        beforeHeight: live.style.getPropertyValue("height") || null,
        baseX: translation[0],
        baseY: translation[1],
        baseWidth: Number.parseFloat(computed.width) || bounds.width,
        baseHeight: Number.parseFloat(computed.height) || bounds.height,
        entries: moving,
        guideBounds
      };
      this.overlay.setHover(null);
    };
    updateCanvasGesture(event) {
      const gesture = this.canvasGesture;
      if (!gesture) return;
      let dx = event.clientX - gesture.startX;
      let dy = event.clientY - gesture.startY;
      const snapScreen = (value) => event.altKey ? Math.round(value * 100) / 100 : Math.round(value / (8 * this.zoomFactor)) * 8 * this.zoomFactor;
      const snapSize = (value) => event.altKey ? Math.round(value * 100) / 100 : Math.round(value / 8) * 8;
      if (gesture.kind === "move") {
        if (event.shiftKey) {
          if (Math.abs(dx) >= Math.abs(dy)) dy = 0;
          else dx = 0;
        }
        const rawLeft = gesture.guideBounds.left + dx;
        const rawTop = gesture.guideBounds.top + dy;
        const findGuide = (axis, proposed) => {
          if (event.altKey) return null;
          const parent = gesture.element.parentElement;
          if (!parent) return null;
          const size = axis === "x" ? gesture.guideBounds.width : gesture.guideBounds.height;
          const candidates = [];
          for (const sibling of Array.from(parent.children)) {
            if (gesture.entries.some(({ element }) => sibling === element || element.contains(sibling)) || !(sibling instanceof HTMLElement)) continue;
            const bounds = sibling.getBoundingClientRect();
            if (!bounds.width || !bounds.height) continue;
            const start = axis === "x" ? bounds.left : bounds.top;
            const otherSize = axis === "x" ? bounds.width : bounds.height;
            candidates.push(
              start,
              start + otherSize / 2 - size / 2,
              start + otherSize - size
            );
          }
          const viewportSize = axis === "x" ? window.innerWidth : window.innerHeight;
          candidates.push(0, (viewportSize - size) / 2, viewportSize - size);
          let closest = null;
          let distance = 6.01;
          for (const candidate of candidates) {
            const offset = Math.abs(candidate - proposed);
            if (offset < distance) {
              closest = candidate;
              distance = offset;
            }
          }
          return closest;
        };
        const guideX = this.selections.length ? findGuide("x", rawLeft) : null;
        const guideY = this.selections.length ? findGuide("y", rawTop) : null;
        const nextLeft = guideX ?? snapScreen(rawLeft);
        const nextTop = guideY ?? snapScreen(rawTop);
        this.overlay.setGuides(guideX === null ? null : guideX, guideY === null ? null : guideY);
        const deltaX = (nextLeft - gesture.guideBounds.left) / this.zoomFactor;
        const deltaY = (nextTop - gesture.guideBounds.top) / this.zoomFactor;
        for (const entry of gesture.entries) {
          entry.element.style.setProperty("translate", `${roundPixel(entry.baseX + deltaX)} ${roundPixel(entry.baseY + deltaY)}`);
        }
        return;
      }
      this.overlay.setGuides(null, null);
      for (const entry of gesture.entries) {
        entry.element.style.setProperty("width", roundPixel(Math.max(16, snapSize(entry.baseWidth + dx / this.zoomFactor))));
        entry.element.style.setProperty("height", roundPixel(Math.max(16, snapSize(entry.baseHeight + dy / this.zoomFactor))));
      }
    }
    async finishCanvasGesture() {
      const gesture = this.canvasGesture;
      if (!gesture) return;
      this.canvasGesture = null;
      this.overlay.setGuides(null, null);
      const operations = [];
      if (gesture.kind === "move") {
        for (const entry of gesture.entries) {
          const after = entry.element.style.getPropertyValue("translate") || null;
          if (after !== entry.beforeTranslate) operations.push({
            operation: "set_style",
            identity: stableIdentity(entry.element, this.options.webviewId),
            property: "translate",
            before: entry.beforeTranslate,
            after
          });
        }
      } else {
        for (const entry of gesture.entries) {
          const identity = stableIdentity(entry.element, this.options.webviewId);
          const afterWidth = entry.element.style.getPropertyValue("width") || null;
          const afterHeight = entry.element.style.getPropertyValue("height") || null;
          if (afterWidth !== entry.beforeWidth) operations.push({ operation: "set_style", identity, property: "width", before: entry.beforeWidth, after: afterWidth });
          if (afterHeight !== entry.beforeHeight) operations.push({ operation: "set_style", identity, property: "height", before: entry.beforeHeight, after: afterHeight });
        }
      }
      if (operations.length) {
        const transaction = {
          id: globalThis.crypto?.randomUUID?.() ?? `canvas-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          label: gesture.kind === "move" ? operations.length > 1 ? `Move ${gesture.entries.length} elements` : `Move ${gesture.snapshot.tag}` : gesture.entries.length > 1 ? `Resize ${gesture.entries.length} elements` : `Resize ${gesture.snapshot.tag}`,
          operations
        };
        try {
          await invoke("plugin:visual-editor|commit_edit", { transaction });
        } catch {
          for (const entry of gesture.entries) {
            if (gesture.kind === "move") {
              if (entry.beforeTranslate === null) entry.element.style.removeProperty("translate");
              else entry.element.style.setProperty("translate", entry.beforeTranslate);
            } else {
              if (entry.beforeWidth === null) entry.element.style.removeProperty("width");
              else entry.element.style.setProperty("width", entry.beforeWidth);
              if (entry.beforeHeight === null) entry.element.style.removeProperty("height");
              else entry.element.style.setProperty("height", entry.beforeHeight);
            }
          }
        }
      }
      this.selections = this.selections.map((selection) => {
        const live = findElementForSnapshot(selection.snapshot, selection.snapshot.dom_path);
        return live ? { ...selection, snapshot: this.measure(live) } : selection;
      });
      this.overlay.renderSelections(this.selections, this.onOverlayGestureStart);
    }
    cancelCanvasGesture() {
      const gesture = this.canvasGesture;
      if (!gesture) return;
      this.canvasGesture = null;
      for (const entry of gesture.entries) {
        if (gesture.kind === "move") {
          if (entry.beforeTranslate === null) entry.element.style.removeProperty("translate");
          else entry.element.style.setProperty("translate", entry.beforeTranslate);
        } else {
          if (entry.beforeWidth === null) entry.element.style.removeProperty("width");
          else entry.element.style.setProperty("width", entry.beforeWidth);
          if (entry.beforeHeight === null) entry.element.style.removeProperty("height");
          else entry.element.style.setProperty("height", entry.beforeHeight);
        }
      }
    }
    onClick = (event) => {
      if (!this.active) {
        return;
      }
      if (eventHitsInspectorUi(event)) {
        this.hoverTarget = null;
        return;
      }
      if (this.passthrough || event.altKey) {
        return;
      }
      const hit = document.elementFromPoint(event.clientX, event.clientY);
      const target = resolveHoverTarget(hit);
      if (!target) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      const snapshot = this.measure(target);
      const action = event.shiftKey ? "toggle" : "add";
      void this.options.reportSelection(snapshot, action).then(() => {
        const existing = this.selections.findIndex(
          (s) => s.snapshot.dom_path === snapshot.dom_path
        );
        if (action === "add") {
          if (existing < 0) {
            const id = `sel-${this.nextId++}`;
            this.selections.push({ id, label: id, snapshot });
          }
        } else if (existing >= 0) {
          this.selections.splice(existing, 1);
        } else {
          const id = `sel-${this.nextId++}`;
          this.selections.push({ id, label: id, snapshot });
        }
        this.overlay.renderSelections(this.selections, this.onOverlayGestureStart);
      });
    };
    onKeyDown = (event) => {
      if (!this.active) {
        return;
      }
      if (event.code === "Space") {
        this.passthrough = true;
        this.overlay.setHover(null);
      }
      if (event.code === "Escape") {
        this.hoverTarget = null;
        this.overlay.setHover(null);
      }
    };
    onKeyUp = (event) => {
      if (event.code === "Space") {
        this.passthrough = false;
      }
    };
  };

  // ../../node_modules/@tauri-apps/api/event.js
  var TauriEvent;
  (function(TauriEvent2) {
    TauriEvent2["WINDOW_RESIZED"] = "tauri://resize";
    TauriEvent2["WINDOW_MOVED"] = "tauri://move";
    TauriEvent2["WINDOW_CLOSE_REQUESTED"] = "tauri://close-requested";
    TauriEvent2["WINDOW_DESTROYED"] = "tauri://destroyed";
    TauriEvent2["WINDOW_FOCUS"] = "tauri://focus";
    TauriEvent2["WINDOW_BLUR"] = "tauri://blur";
    TauriEvent2["WINDOW_SCALE_FACTOR_CHANGED"] = "tauri://scale-change";
    TauriEvent2["WINDOW_THEME_CHANGED"] = "tauri://theme-changed";
    TauriEvent2["WINDOW_CREATED"] = "tauri://window-created";
    TauriEvent2["WINDOW_SUSPENDED"] = "tauri://suspended";
    TauriEvent2["WINDOW_RESUMED"] = "tauri://resumed";
    TauriEvent2["WEBVIEW_CREATED"] = "tauri://webview-created";
    TauriEvent2["DRAG_ENTER"] = "tauri://drag-enter";
    TauriEvent2["DRAG_OVER"] = "tauri://drag-over";
    TauriEvent2["DRAG_DROP"] = "tauri://drag-drop";
    TauriEvent2["DRAG_LEAVE"] = "tauri://drag-leave";
  })(TauriEvent || (TauriEvent = {}));
  async function _unlisten(event, eventId) {
    window.__TAURI_EVENT_PLUGIN_INTERNALS__.unregisterListener(event, eventId);
    await invoke("plugin:event|unlisten", {
      event,
      eventId
    });
  }
  async function listen(event, handler, options) {
    var _a;
    const target = typeof (options === null || options === void 0 ? void 0 : options.target) === "string" ? { kind: "AnyLabel", label: options.target } : (_a = options === null || options === void 0 ? void 0 : options.target) !== null && _a !== void 0 ? _a : { kind: "Any" };
    return invoke("plugin:event|listen", {
      event,
      target,
      handler: transformCallback(handler)
    }).then((eventId) => {
      return async () => _unlisten(event, eventId);
    });
  }

  // src/toolbar-icons.ts
  var ICON_RELOAD = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
  <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M21 3v5h-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
  var ICON_SEARCH = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
  <circle cx="11" cy="11" r="6.5" stroke="currentColor" stroke-width="2"/>
  <path d="M16 16l4.5 4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
</svg>`;
  var ICON_POINTER = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
  <path d="M4 4l7 16 2.5-6.5L20 11 4 4z" fill="currentColor" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
</svg>`;
  var ICON_INSPECT_PICKER = `<span style="display:inline-flex;align-items:center;gap:1px" aria-hidden="true">${ICON_SEARCH}${ICON_POINTER}</span>`;
  var ICON_SCREENSHOT = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
  <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" stroke-width="2"/>
  <circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2"/>
</svg>`;
  var ICON_CONTEXT = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
  <path d="M7 8h10M7 12h10M7 16h6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  <rect x="4" y="5" width="16" height="14" rx="2" stroke="currentColor" stroke-width="2"/>
</svg>`;
  var ICON_CHIP = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
  <rect x="4" y="4" width="16" height="16" rx="2" stroke="currentColor" stroke-width="2"/>
  <path d="M9 9l6 6M15 9l-6 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
</svg>`;
  var ICON_CHEVRON_UP = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
  <path d="M6 14l6-6 6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
  var ICON_CHEVRON_DOWN = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
  <path d="M6 10l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
  var ICON_GRIP = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
  <circle cx="9" cy="8" r="1.2"/><circle cx="15" cy="8" r="1.2"/>
  <circle cx="9" cy="12" r="1.2"/><circle cx="15" cy="12" r="1.2"/>
  <circle cx="9" cy="16" r="1.2"/><circle cx="15" cy="16" r="1.2"/>
</svg>`;
  var ICON_DEVTOOLS = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
  <rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" stroke-width="2"/>
  <path d="M7 9l3 3-3 3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M12 15h5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
</svg>`;
  var ICON_CAPTURE_CHIP = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
  <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" stroke-width="2"/>
  <circle cx="12" cy="12" r="2.5" stroke="currentColor" stroke-width="1.5"/>
</svg>`;
  var ICON_CHECK = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
  <path d="M5 12l5 5L19 7" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
  var ICON_DRAW = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
  <path d="M12 20h9" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
</svg>`;
  var ICON_TEXT = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
  <path d="M4 7V5h16v2" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M12 5v14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  <path d="M8 19h8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
</svg>`;
  var ICON_SCISSORS = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
  <circle cx="6" cy="6" r="3" stroke="currentColor" stroke-width="2"/>
  <circle cx="6" cy="18" r="3" stroke="currentColor" stroke-width="2"/>
  <path d="M8.5 8.5L20 20" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  <path d="M8.5 15.5L20 4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
</svg>`;
  var ICON_UNDO = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
  <path d="M9 14 4 9l5-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
  var ICON_REDO = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
  <path d="m15 14 5-5-5-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
  var ICON_SAVE = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
  <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
  <path d="M17 21v-8H7v8" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
  <path d="M7 3v5h8" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
</svg>`;

  // src/capture-image.ts
  var PLUGIN = "plugin:visual-editor";
  async function loadCaptureBlobUrl(captureId) {
    const bytes = await invoke(`${PLUGIN}|read_capture_image`, { captureId });
    const blob = new Blob([Uint8Array.from(bytes)], { type: "image/png" });
    return URL.createObjectURL(blob);
  }

  // src/composer-flow.ts
  var COMPOSER_TAIL_ATTR = "data-visual-editor-composer-tail";
  var ZWSP = "\u200B";
  var CHIP_SELECTOR = "[data-visual-editor-chip], [data-visual-editor-capture-chip]";
  function stripComposerZwsp(text) {
    return text.replace(/\u200B/g, "");
  }
  function isComposerChipNode(node) {
    return node instanceof HTMLElement && (node.hasAttribute("data-visual-editor-chip") || node.hasAttribute("data-visual-editor-capture-chip"));
  }
  function isLegacyTailNode(node) {
    return node instanceof HTMLElement && node.hasAttribute(COMPOSER_TAIL_ATTR);
  }
  function isGapTextNode(node) {
    return node.nodeType === Node.TEXT_NODE && stripComposerZwsp(node.textContent ?? "").length === 0;
  }
  function hasVisibleText(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      return stripComposerZwsp(node.textContent ?? "").length > 0;
    }
    if (node instanceof HTMLElement && !isComposerChipNode(node) && !isLegacyTailNode(node)) {
      return stripComposerZwsp(node.textContent ?? "").length > 0;
    }
    return false;
  }
  function removeLegacyTails(composer) {
    composer.querySelectorAll(`[${COMPOSER_TAIL_ATTR}]`).forEach((node) => node.remove());
  }
  function removeGapTextNodes(composer) {
    for (const node of [...composer.childNodes]) {
      if (isGapTextNode(node)) node.remove();
    }
  }
  function stripZwspFromTextNodes(composer) {
    for (const node of [...composer.childNodes]) {
      if (node.nodeType === Node.TEXT_NODE) {
        const cleaned = stripComposerZwsp(node.textContent ?? "");
        if (!cleaned) {
          node.remove();
        } else if (cleaned !== node.textContent) {
          node.textContent = cleaned;
        }
        continue;
      }
      if (node instanceof HTMLElement && !isComposerChipNode(node) && !isLegacyTailNode(node)) {
        stripZwspFromTextNodes(node);
      }
    }
  }
  function mergeAdjacentTextNodes(composer) {
    let i = 0;
    while (i < composer.childNodes.length) {
      const node = composer.childNodes[i];
      if (node.nodeType !== Node.TEXT_NODE) {
        i++;
        continue;
      }
      let text = stripComposerZwsp(node.textContent ?? "");
      if (!text) {
        node.remove();
        continue;
      }
      let j = i + 1;
      while (j < composer.childNodes.length) {
        const next = composer.childNodes[j];
        if (next.nodeType === Node.TEXT_NODE) {
          text += stripComposerZwsp(next.textContent ?? "");
          next.remove();
          continue;
        }
        break;
      }
      node.textContent = text;
      i++;
    }
  }
  function insertGapBefore(composer, ref) {
    const prev = ref?.previousSibling;
    if (prev && isGapTextNode(prev)) return;
    composer.insertBefore(document.createTextNode(ZWSP), ref);
  }
  function removeOrphanGapNodes(composer) {
    for (const node of [...composer.childNodes]) {
      if (!isGapTextNode(node)) continue;
      const prev = node.previousSibling;
      const next = node.nextSibling;
      const besideChip = prev instanceof HTMLElement && isComposerChipNode(prev) || next instanceof HTMLElement && isComposerChipNode(next);
      if (!besideChip) node.remove();
    }
    let last = composer.lastChild;
    while (last && isGapTextNode(last)) {
      const prev = last.previousSibling;
      if (prev instanceof HTMLElement && isComposerChipNode(prev)) break;
      const orphan = last;
      last = prev;
      orphan.remove();
    }
  }
  function ensureBoundaryGaps(composer) {
    const children = [...composer.childNodes].filter((node) => !isLegacyTailNode(node));
    for (let i = children.length - 1; i > 0; i--) {
      const prev = children[i - 1];
      const curr = children[i];
      if (isGapTextNode(prev) || isGapTextNode(curr)) continue;
      if (!isComposerChipNode(prev) && !isComposerChipNode(curr)) continue;
      composer.insertBefore(document.createTextNode(ZWSP), curr);
    }
    const first = composer.firstChild;
    if (first && isComposerChipNode(first)) {
      insertGapBefore(composer, first);
    }
    const last = composer.lastChild;
    if (last && isComposerChipNode(last)) {
      const next = last.nextSibling;
      if (!next || !isGapTextNode(next)) {
        composer.appendChild(document.createTextNode(ZWSP));
      }
    }
    removeOrphanGapNodes(composer);
  }
  function normalizeComposerInlines(composer) {
    removeLegacyTails(composer);
    removeGapTextNodes(composer);
    stripZwspFromTextNodes(composer);
    mergeAdjacentTextNodes(composer);
    ensureBoundaryGaps(composer);
  }
  function ensureComposerTail(composer) {
    removeLegacyTails(composer);
    const hasChips = composer.querySelector(CHIP_SELECTOR);
    if (hasChips) {
      normalizeComposerInlines(composer);
      return;
    }
    removeOrphanGapNodes(composer);
    stripZwspFromTextNodes(composer);
    mergeAdjacentTextNodes(composer);
  }
  function saveComposerCaret(composer) {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    const anchor = sel.anchorNode;
    if (!anchor || !composer.contains(anchor)) return null;
    return sel.getRangeAt(0).cloneRange();
  }
  function restoreComposerCaret(range) {
    if (!range) return;
    const sel = window.getSelection();
    if (!sel) return;
    sel.removeAllRanges();
    sel.addRange(range);
  }
  function placeCaretInTextNode(textNode, offset) {
    const range = document.createRange();
    range.setStart(textNode, Math.max(0, Math.min(offset, textNode.length)));
    range.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }
  function ensureZwspGapBefore(chip) {
    const prev = chip.previousSibling;
    if (prev && isGapTextNode(prev)) return prev;
    const gap = document.createTextNode(ZWSP);
    chip.parentElement?.insertBefore(gap, chip);
    return gap;
  }
  function ensureZwspGapAfter(chip) {
    const next = chip.nextSibling;
    if (next && isGapTextNode(next)) return next;
    const gap = document.createTextNode(ZWSP);
    chip.parentElement?.insertBefore(gap, chip.nextSibling);
    return gap;
  }
  function placeCaretBesideChip(chip, after) {
    const gap = after ? ensureZwspGapAfter(chip) : ensureZwspGapBefore(chip);
    placeCaretInTextNode(gap, 0);
  }
  function focusComposerAtChip(composer, clientX, clientY) {
    normalizeComposerInlines(composer);
    composer.focus();
    const hit = document.elementFromPoint(clientX, clientY);
    const chip = hit?.closest(CHIP_SELECTOR);
    if (!(chip instanceof HTMLElement) || !composer.contains(chip)) return;
    const rect = chip.getBoundingClientRect();
    placeCaretBesideChip(chip, clientX > rect.left + rect.width / 2);
  }
  function extractComposerText(composer) {
    const parts = [];
    for (const node of composer.childNodes) {
      if (isLegacyTailNode(node) || isComposerChipNode(node) || isGapTextNode(node)) continue;
      if (node.nodeType === Node.TEXT_NODE) {
        parts.push(stripComposerZwsp(node.textContent ?? ""));
        continue;
      }
      if (node instanceof HTMLElement) {
        if (node.tagName === "BR") {
          parts.push("\n");
          continue;
        }
        if (node.tagName === "DIV" || node.tagName === "P") {
          if (parts.length > 0) parts.push("\n");
          parts.push(stripComposerZwsp(node.textContent ?? ""));
          continue;
        }
        if (hasVisibleText(node)) {
          parts.push(stripComposerZwsp(node.textContent ?? ""));
        }
      }
    }
    return parts.join("");
  }
  function readElementChipId(chip) {
    return chip.getAttribute("data-chip-id");
  }
  function readCaptureChipId(chip) {
    return chip.getAttribute("data-visual-editor-capture-chip");
  }
  function extractComposerBlocks(composer) {
    const blocks = [];
    const pushText = (raw) => {
      const text = stripComposerZwsp(raw);
      if (!text) return;
      const last = blocks[blocks.length - 1];
      if (last?.type === "text") {
        last.content += text;
        return;
      }
      blocks.push({ type: "text", content: text });
    };
    const walk = (parent) => {
      for (const node of parent.childNodes) {
        if (isLegacyTailNode(node) || isGapTextNode(node)) continue;
        if (node instanceof HTMLElement) {
          if (node.hasAttribute("data-visual-editor-chip")) {
            const id = readElementChipId(node);
            if (id) blocks.push({ type: "element", id });
            continue;
          }
          if (node.hasAttribute("data-visual-editor-capture-chip")) {
            const id = readCaptureChipId(node);
            if (id) blocks.push({ type: "capture", id });
            continue;
          }
          if (node.tagName === "BR") {
            pushText("\n");
            continue;
          }
          if (node.tagName === "DIV" || node.tagName === "P") {
            if (blocks.length > 0) pushText("\n");
            walk(node);
            continue;
          }
          pushText(node.textContent ?? "");
          continue;
        }
        if (node.nodeType === Node.TEXT_NODE) {
          pushText(node.textContent ?? "");
        }
      }
    };
    walk(composer);
    return blocks;
  }
  function setupComposerChip(chip, composer, options = {}) {
    chip.setAttribute("contenteditable", "false");
    chip.draggable = true;
    chip.style.cursor = "grab";
    chip.addEventListener("dragstart", (event) => {
      const id = chip.getAttribute("data-chip-id") ?? chip.getAttribute("data-visual-editor-capture-chip") ?? "";
      event.dataTransfer?.setData("application/x-visual-editor-chip", id);
      event.dataTransfer?.setData("text/plain", id);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
      chip.style.opacity = "0.55";
    });
    chip.addEventListener("dragend", () => {
      chip.style.opacity = "";
      normalizeComposerInlines(composer);
    });
    chip.addEventListener("mousedown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      normalizeComposerInlines(composer);
      composer.focus();
      const rect = chip.getBoundingClientRect();
      placeCaretBesideChip(chip, event.clientX > rect.left + rect.width / 2);
    });
    chip.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      options.onChipClick?.();
    });
  }
  function findChipById(composer, id) {
    const el = composer.querySelector(`[data-chip-id="${id}"]`);
    if (el instanceof HTMLElement) return el;
    const cap = composer.querySelector(`[data-visual-editor-capture-chip="${id}"]`);
    return cap instanceof HTMLElement ? cap : null;
  }
  function insertChipAtPoint(composer, chip, clientX, clientY) {
    const doc = composer.ownerDocument;
    const range = doc.caretRangeFromPoint?.(clientX, clientY);
    if (!range || !composer.contains(range.startContainer)) {
      composer.appendChild(chip);
      return;
    }
    insertChipAtRange(composer, chip, range);
  }
  function insertChipAtRange(composer, chip, range) {
    const { startContainer, startOffset } = range;
    if (startContainer.nodeType === Node.TEXT_NODE) {
      const textNode = startContainer;
      if (isGapTextNode(textNode)) {
        composer.insertBefore(chip, textNode);
        return;
      }
      const text = textNode.textContent ?? "";
      const before = stripComposerZwsp(text.slice(0, startOffset));
      const after = stripComposerZwsp(text.slice(startOffset));
      textNode.textContent = before;
      const afterNode = document.createTextNode(after);
      const parent = textNode.parentNode;
      if (!parent) return;
      parent.insertBefore(chip, textNode.nextSibling);
      if (after) {
        parent.insertBefore(afterNode, chip.nextSibling);
      }
      return;
    }
    if (startContainer === composer) {
      const ref = composer.childNodes[startOffset] ?? null;
      composer.insertBefore(chip, ref);
      return;
    }
    composer.appendChild(chip);
  }
  function setupComposerDropTarget(composer) {
    composer.addEventListener("dragover", (event) => {
      if (!event.dataTransfer?.types.includes("application/x-visual-editor-chip")) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
    });
    composer.addEventListener("drop", (event) => {
      const id = event.dataTransfer?.getData("application/x-visual-editor-chip");
      if (!id) return;
      event.preventDefault();
      const chip = findChipById(composer, id);
      if (!chip) return;
      chip.remove();
      insertChipAtPoint(composer, chip, event.clientX, event.clientY);
      normalizeComposerInlines(composer);
      composer.focus();
      composer.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertFromDrop" }));
    });
  }
  function sanitizeComposerWhileTyping(composer) {
    removeLegacyTails(composer);
    const sel = window.getSelection();
    const anchorNode = sel?.anchorNode ?? null;
    const anchorOffset = sel?.anchorOffset ?? 0;
    const hadFocus = document.activeElement === composer;
    for (const node of [...composer.childNodes]) {
      if (node.nodeType !== Node.TEXT_NODE) continue;
      const text = node.textContent ?? "";
      const cleaned = stripComposerZwsp(text);
      const isActiveText = node === anchorNode || node.contains(anchorNode);
      if (!cleaned) {
        const prev = node.previousSibling;
        const next = node.nextSibling;
        const besideChip = prev instanceof HTMLElement && isComposerChipNode(prev) || next instanceof HTMLElement && isComposerChipNode(next);
        if (!besideChip) {
          if (isActiveText && sel) {
            const target = next ?? prev;
            if (target) {
              const range = document.createRange();
              if (target instanceof Text) {
                range.setStart(target, next ? 0 : target.length);
              } else {
                range.setStartBefore(target);
              }
              range.collapse(true);
              sel.removeAllRanges();
              sel.addRange(range);
            }
          }
          node.remove();
        }
        continue;
      }
      if (cleaned !== text) {
        if (isActiveText && sel) {
          const leadingZwsp = text.length - text.replace(/^\u200B+/, "").length;
          const offset = Math.max(0, anchorOffset - leadingZwsp);
          node.textContent = cleaned;
          const clamped = Math.min(offset, cleaned.length);
          const range = document.createRange();
          range.setStart(node, clamped);
          range.collapse(true);
          sel.removeAllRanges();
          sel.addRange(range);
        } else {
          node.textContent = cleaned;
        }
      }
    }
    removeOrphanGapNodes(composer);
    if (hadFocus) composer.focus();
  }
  function isAnyComposerChip(node) {
    return isComposerChipNode(node) || node instanceof HTMLElement && (node.hasAttribute("data-ve-chip") || node.hasAttribute("data-ve-capture-chip"));
  }
  function chipElementId(chip) {
    return chip.getAttribute("data-chip-id") ?? chip.getAttribute("data-ve-chip-id");
  }
  function chipCaptureId(chip) {
    const id = chip.getAttribute("data-visual-editor-capture-chip") ?? chip.getAttribute("data-ve-capture-chip");
    if (!id || id === "true") return null;
    return id;
  }
  function resolveChipSibling(node, direction) {
    if (!node) return null;
    if (isAnyComposerChip(node)) return node;
    if (isGapTextNode(node)) {
      const adjacent = direction === "before" ? node.previousSibling : node.nextSibling;
      if (adjacent instanceof HTMLElement && isAnyComposerChip(adjacent)) return adjacent;
    }
    return null;
  }
  function getAdjacentComposerChip(composer, direction) {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return null;
    if (!sel.anchorNode || !composer.contains(sel.anchorNode)) return null;
    const { startContainer, startOffset } = sel.getRangeAt(0);
    if (startContainer.nodeType === Node.TEXT_NODE) {
      const textNode = startContainer;
      if (direction === "before") {
        if (startOffset === 0) {
          return resolveChipSibling(textNode.previousSibling, "before");
        }
        if (isGapTextNode(textNode)) {
          const beforeCaret = textNode.textContent?.slice(0, startOffset) ?? "";
          if (stripComposerZwsp(beforeCaret).length === 0) {
            return resolveChipSibling(textNode.previousSibling, "before");
          }
        }
        return null;
      }
      if (direction === "after" && startOffset === textNode.length) {
        return resolveChipSibling(textNode.nextSibling, "after");
      }
      if (direction === "after" && isGapTextNode(textNode)) {
        const afterCaret = textNode.textContent?.slice(startOffset) ?? "";
        if (stripComposerZwsp(afterCaret).length === 0) {
          return resolveChipSibling(textNode.nextSibling, "after");
        }
      }
      return null;
    }
    if (startContainer === composer) {
      const index = direction === "before" ? startOffset - 1 : startOffset;
      const node = composer.childNodes[index];
      if (node instanceof HTMLElement && isAnyComposerChip(node)) return node;
      if (node) return resolveChipSibling(node, direction);
    }
    return null;
  }
  function handleComposerChipKeydown(composer, event, handlers) {
    if (event.key !== "Backspace" && event.key !== "Delete") return;
    if (event.isComposing) return;
    const direction = event.key === "Backspace" ? "before" : "after";
    const chip = getAdjacentComposerChip(composer, direction);
    if (!chip) return;
    event.preventDefault();
    const elementId = chipElementId(chip);
    const captureId = chipCaptureId(chip);
    if (elementId) void handlers.onRemoveElement?.(elementId);
    if (captureId) void handlers.onRemoveCapture?.(captureId);
    composer.dispatchEvent(new InputEvent("input", { bubbles: true }));
  }
  function setupComposerChipKeydown(composer, handlers) {
    composer.addEventListener("keydown", (event) => {
      handleComposerChipKeydown(composer, event, handlers);
    });
  }

  // src/floating-ui.ts
  var FLOATING_ROOT_ID = "visual-editor-floating-root";
  var Z_FLOATING_LAYER = 2147483647;
  function ensureFloatingRoot() {
    let host = document.getElementById(FLOATING_ROOT_ID);
    if (!host) {
      host = document.createElement("div");
      host.id = FLOATING_ROOT_ID;
      Object.assign(host.style, {
        position: "fixed",
        inset: "0",
        zIndex: String(Z_FLOATING_LAYER),
        pointerEvents: "none",
        overflow: "visible"
      });
      document.documentElement.appendChild(host);
    }
    document.documentElement.appendChild(host);
    return host;
  }
  function mountFloatingElement(el) {
    ensureFloatingRoot().appendChild(el);
  }
  function mountFloatingModal(el) {
    if (!el.style.pointerEvents) {
      el.style.pointerEvents = "auto";
    }
    if (!el.style.zIndex) {
      el.style.zIndex = String(Z_FLOATING_LAYER);
    }
    document.documentElement.appendChild(el);
  }

  // src/toolbar-ui.ts
  var activeTooltip = null;
  var activeInfo = null;
  function attachTooltip(anchor, text) {
    anchor.addEventListener("mouseenter", () => {
      hideTooltip();
      const tip = document.createElement("div");
      tip.textContent = text;
      Object.assign(tip.style, {
        position: "fixed",
        maxWidth: "220px",
        padding: "6px 10px",
        borderRadius: "6px",
        background: "#0d1117",
        color: "#e6edf3",
        fontSize: "11px",
        lineHeight: "1.35",
        boxShadow: "0 4px 16px rgba(0,0,0,0.45)",
        border: "1px solid #3d3d3d",
        pointerEvents: "none",
        fontFamily: "system-ui, -apple-system, sans-serif",
        transform: "translateY(-50%)"
      });
      const rect = anchor.getBoundingClientRect();
      mountFloatingElement(tip);
      const gap = 8;
      const left = Math.max(8, rect.left - tip.offsetWidth - gap);
      tip.style.left = `${left}px`;
      tip.style.top = `${rect.top + rect.height / 2}px`;
      activeTooltip = tip;
    });
    anchor.addEventListener("mouseleave", hideTooltip);
  }
  function hideTooltip() {
    activeTooltip?.remove();
    activeTooltip = null;
  }
  function attrValue(attributes, key) {
    return attributes.find(([k]) => k === key)?.[1];
  }
  function isLayoutUtilityClass(className) {
    const lower = className.toLowerCase();
    const single = /* @__PURE__ */ new Set([
      "flex",
      "inline-flex",
      "grid",
      "inline-grid",
      "block",
      "inline-block",
      "inline",
      "hidden",
      "contents",
      "relative",
      "absolute",
      "fixed",
      "sticky",
      "static",
      "container",
      "truncate",
      "sr-only"
    ]);
    if (single.has(lower)) return true;
    const prefixes = [
      "flex-",
      "items-",
      "justify-",
      "gap-",
      "space-",
      "p-",
      "px-",
      "py-",
      "pt-",
      "pb-",
      "pl-",
      "pr-",
      "m-",
      "mx-",
      "my-",
      "mt-",
      "mb-",
      "ml-",
      "mr-",
      "w-",
      "h-",
      "min-",
      "max-",
      "col-",
      "row-",
      "grid-",
      "self-",
      "place-",
      "overflow-",
      "z-",
      "order-",
      "basis-"
    ];
    return prefixes.some((prefix) => lower.startsWith(prefix));
  }
  function chipClassFromAttributes(attributes) {
    const cls = attrValue(attributes, "class");
    if (!cls) return void 0;
    for (const token of cls.split(/\s+/).filter(Boolean)) {
      if (!isLayoutUtilityClass(token)) return token;
    }
    return void 0;
  }
  function elementChipLabel(el) {
    const { tag, attributes } = el.snapshot;
    const component = el.component || attrValue(attributes, "data-inspector-component");
    if (component) return `<${component}>`;
    const inspectorId = el.inspector_id || attrValue(attributes, "data-inspector-id");
    if (inspectorId) return `<${tag} data-inspector-id="${inspectorId}">`;
    const id = attrValue(attributes, "id");
    if (id) return `<${tag} id="${id}">`;
    const cls = chipClassFromAttributes(attributes);
    if (cls) return `<${tag} class="${cls}">`;
    return `<${tag}>`;
  }
  function section(title, body) {
    return `<div style="margin-bottom:10px"><div style="font-size:10px;font-weight:600;color:#8b949e;margin-bottom:4px">${title}</div><div style="font-family:ui-monospace,monospace;font-size:11px;color:#e6edf3;white-space:pre-wrap;word-break:break-all">${body}</div></div>`;
  }
  function buildElementInfoHtml(el) {
    const snap = el.snapshot;
    const attrs = snap.attributes.filter(([k]) => !k.startsWith("data-cursor-")).slice(0, 12).map(([k, v]) => `${k}: ${v}`).join("\n");
    const layout = snap.computed_layout.slice(0, 16).map(([k, v]) => `${k}: ${v}`).join("\n");
    const elementLine = elementChipLabel(el);
    return section("ELEMENT", elementLine) + section("PATH", el.selector || snap.dom_path) + (attrs ? section("ATTRIBUTES", attrs) : "") + (layout ? section("COMPUTED STYLES", layout) : "");
  }
  function hideElementInfo() {
    activeInfo?.remove();
    activeInfo = null;
  }
  function createChipRemoveButton(composer, chip, label, onRemove) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.setAttribute("aria-label", label);
    btn.setAttribute("data-visual-editor-chip-remove", "true");
    btn.setAttribute("data-visual-editor-ui", "true");
    btn.textContent = "\xD7";
    Object.assign(btn.style, {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      width: "14px",
      height: "14px",
      marginLeft: "2px",
      padding: "0",
      border: "none",
      borderRadius: "4px",
      background: "transparent",
      color: "#8b949e",
      fontSize: "13px",
      lineHeight: "1",
      cursor: "pointer",
      flexShrink: "0"
    });
    btn.addEventListener("mouseenter", () => {
      btn.style.background = "rgba(248,81,73,0.2)";
      btn.style.color = "#f85149";
    });
    btn.addEventListener("mouseleave", () => {
      btn.style.background = "transparent";
      btn.style.color = "#8b949e";
    });
    btn.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    btn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      hideElementInfo();
      onRemove();
    });
    return btn;
  }
  function attachElementInfo(chip, el) {
    chip.addEventListener("mouseenter", () => {
      hideElementInfo();
      const pop = document.createElement("div");
      pop.innerHTML = buildElementInfoHtml(el);
      Object.assign(pop.style, {
        position: "fixed",
        width: "320px",
        maxHeight: "360px",
        overflow: "auto",
        padding: "12px",
        borderRadius: "8px",
        background: "#0d1117",
        border: "1px solid #3d3d3d",
        boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
        pointerEvents: "none",
        fontFamily: "system-ui, -apple-system, sans-serif"
      });
      const rect = chip.getBoundingClientRect();
      mountFloatingElement(pop);
      let left = rect.left;
      let top = rect.bottom + 8;
      if (left + 320 > window.innerWidth - 8) left = window.innerWidth - 328;
      if (top + 200 > window.innerHeight - 8) top = rect.top - pop.offsetHeight - 8;
      pop.style.left = `${Math.max(8, left)}px`;
      pop.style.top = `${Math.max(8, top)}px`;
      activeInfo = pop;
    });
    chip.addEventListener("mouseleave", hideElementInfo);
  }
  function renderChip(el, composer, onChipClick, onRemove) {
    const chip = document.createElement("span");
    chip.setAttribute("data-visual-editor-chip", "true");
    Object.assign(chip.style, {
      display: "inline-flex",
      alignItems: "center",
      gap: "4px",
      padding: "2px 8px",
      borderRadius: "6px",
      border: "1px solid rgba(88,166,255,0.55)",
      background: "rgba(88,166,255,0.12)",
      color: "#e6edf3",
      fontSize: "11px",
      fontFamily: "ui-monospace, monospace",
      cursor: "pointer",
      maxWidth: "100%",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
      verticalAlign: "middle",
      userSelect: "none",
      margin: "4px 6px 10px 0"
    });
    const icon = document.createElement("span");
    icon.innerHTML = ICON_CHIP;
    icon.style.display = "flex";
    icon.style.color = "#58a6ff";
    const label = document.createElement("span");
    label.textContent = elementChipLabel(el);
    chip.append(icon, label);
    if (onRemove) {
      chip.append(createChipRemoveButton(composer, chip, "Remove element chip", () => onRemove(el.id)));
    }
    attachElementInfo(chip, el);
    setupComposerChip(chip, composer, {
      onChipClick: () => onChipClick?.(el)
    });
    return chip;
  }
  function makeDraggable(shell, handle) {
    handle.style.cursor = "grab";
    handle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      const root = shell.parentElement;
      const rect = root.getBoundingClientRect();
      const offsetX = event.clientX - rect.left;
      const offsetY = event.clientY - rect.top;
      handle.style.cursor = "grabbing";
      const onMove = (ev) => {
        const x = Math.min(Math.max(0, ev.clientX - offsetX), window.innerWidth - rect.width);
        const y = Math.min(Math.max(0, ev.clientY - offsetY), window.innerHeight - 40);
        root.style.left = `${x}px`;
        root.style.top = `${y}px`;
        root.style.right = "auto";
      };
      const onUp = () => {
        handle.style.cursor = "grab";
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    });
  }
  function iconButton(label, tooltip, svg, onClick) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.setAttribute("aria-label", label);
    btn.setAttribute("data-visual-editor-ui", "true");
    btn.innerHTML = svg;
    const baseBg = "#2a2a2a";
    const hoverBg = "#3d444d";
    const baseBorder = "#3d3d3d";
    Object.assign(btn.style, {
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      width: "44px",
      height: "44px",
      borderRadius: "8px",
      border: `1px solid ${baseBorder}`,
      background: baseBg,
      color: "#e6edf3",
      cursor: "pointer",
      transition: "background 0.15s ease, border-color 0.15s ease, transform 0.1s ease"
    });
    btn.addEventListener("mouseenter", () => {
      if (btn.dataset.active === "true") return;
      btn.style.background = hoverBg;
      btn.style.borderColor = "#58a6ff66";
    });
    btn.addEventListener("mouseleave", () => {
      if (btn.dataset.active === "true") return;
      btn.style.background = baseBg;
      btn.style.borderColor = baseBorder;
    });
    btn.addEventListener("mousedown", (event) => {
      event.stopPropagation();
      btn.style.transform = "scale(0.96)";
    });
    btn.addEventListener("mouseup", () => {
      btn.style.transform = "scale(1)";
    });
    btn.addEventListener("click", (event) => {
      event.stopPropagation();
      event.stopImmediatePropagation();
      onClick();
    });
    attachTooltip(btn, tooltip);
    return btn;
  }
  var PANEL_BTN_BASE = {
    padding: "4px 10px",
    borderRadius: "6px",
    border: "1px solid #3d3d3d",
    background: "transparent",
    color: "#e6edf3",
    fontSize: "12px",
    cursor: "pointer",
    transition: "background 0.15s ease, border-color 0.15s ease, color 0.15s ease"
  };
  function createPanelButton(label, onClick) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = label;
    Object.assign(btn.style, PANEL_BTN_BASE);
    btn.addEventListener("mouseenter", () => {
      if (btn.dataset.state === "success") return;
      btn.style.background = "#2a2a2a";
      btn.style.borderColor = "#58a6ff66";
    });
    btn.addEventListener("mouseleave", () => {
      if (btn.dataset.state === "success") return;
      btn.style.background = "transparent";
      btn.style.borderColor = "#3d3d3d";
    });
    btn.addEventListener("click", (event) => onClick(event));
    return btn;
  }
  function showCopySuccess(btn, resetMs = 2e3) {
    btn.dataset.state = "success";
    btn.innerHTML = ICON_CHECK;
    Object.assign(btn.style, {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      gap: "4px",
      background: "#58a6ff",
      borderColor: "#58a6ff",
      color: "#fff",
      minWidth: "56px"
    });
    window.setTimeout(() => {
      btn.dataset.state = "";
      btn.textContent = "Copy";
      Object.assign(btn.style, PANEL_BTN_BASE);
    }, resetMs);
  }
  function runClearWipe(textareaWrap, onDone) {
    const wipe = document.createElement("div");
    Object.assign(wipe.style, {
      position: "absolute",
      inset: "0",
      borderRadius: "6px",
      background: "linear-gradient(90deg, transparent 0%, #0d1117 50%, transparent 100%)",
      pointerEvents: "none",
      transform: "translateX(-100%)",
      animation: "ve-clear-wipe 0.45s ease forwards"
    });
    if (!document.getElementById("ve-clear-wipe-style")) {
      const style = document.createElement("style");
      style.id = "ve-clear-wipe-style";
      style.textContent = `@keyframes ve-clear-wipe { to { transform: translateX(100%); } }`;
      document.head.append(style);
    }
    textareaWrap.style.position = "relative";
    textareaWrap.append(wipe);
    wipe.addEventListener("animationend", () => {
      wipe.remove();
      onDone();
    });
  }

  // src/screenshot-editor-history.ts
  var MAX_HISTORY = 50;
  function cloneSnapshot(snapshot) {
    return {
      strokes: snapshot.strokes.map((s) => ({
        points: s.points.map((p) => ({ x: p.x, y: p.y }))
      })),
      texts: snapshot.texts.map((t) => ({ x: t.x, y: t.y, text: t.text })),
      cropRect: snapshot.cropRect ? { ...snapshot.cropRect } : null
    };
  }
  function createEditorHistory() {
    const undoStack = [];
    const redoStack = [];
    return {
      push(snapshot) {
        undoStack.push(cloneSnapshot(snapshot));
        if (undoStack.length > MAX_HISTORY) undoStack.shift();
        redoStack.length = 0;
      },
      undo(current) {
        if (undoStack.length === 0) return null;
        redoStack.push(cloneSnapshot(current));
        return undoStack.pop() ?? null;
      },
      redo(current) {
        if (redoStack.length === 0) return null;
        undoStack.push(cloneSnapshot(current));
        return redoStack.pop() ?? null;
      },
      canUndo() {
        return undoStack.length > 0;
      },
      canRedo() {
        return redoStack.length > 0;
      }
    };
  }

  // src/screenshot-text-box-canvas.ts
  function roundRect(ctx, x, y, w, h, r) {
    const radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + w - radius, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
    ctx.lineTo(x + w, y + h - radius);
    ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
    ctx.lineTo(x + radius, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }
  function wrapFillText(ctx, text, x, y, maxWidth, lineHeight) {
    for (const paragraph of text.split("\n")) {
      const words = paragraph.split(/(\s+)/);
      let line = "";
      let cy = y;
      for (const word of words) {
        const test = line + word;
        if (ctx.measureText(test).width > maxWidth && line.trim()) {
          ctx.fillText(line, x, cy);
          line = word.trimStart();
          cy += lineHeight;
        } else {
          line = test;
        }
      }
      if (line.trim()) {
        ctx.fillText(line, x, cy);
        y = cy + lineHeight;
      }
    }
  }
  function drawTextBoxOnCanvas(ctx, x, y, w, h, text, scale) {
    const handleH = 18 * scale;
    const radius = 6 * scale;
    const padding = 8 * scale;
    const fontSize = 16 * scale;
    const lineHeight = 20 * scale;
    roundRect(ctx, x, y, w, h, radius);
    ctx.fillStyle = "rgba(13,17,23,0.92)";
    ctx.fill();
    ctx.strokeStyle = "#f85149";
    ctx.lineWidth = 2 * scale;
    roundRect(ctx, x, y, w, h, radius);
    ctx.stroke();
    ctx.fillStyle = "#21262d";
    ctx.fillRect(x, y, w, handleH);
    ctx.strokeStyle = "#3d3d3d";
    ctx.lineWidth = Math.max(1, scale);
    ctx.beginPath();
    ctx.moveTo(x, y + handleH);
    ctx.lineTo(x + w, y + handleH);
    ctx.stroke();
    ctx.fillStyle = "#f85149";
    ctx.font = `bold ${fontSize}px system-ui, sans-serif`;
    wrapFillText(ctx, text, x + padding, y + handleH + padding + fontSize * 0.85, w - padding * 2, lineHeight);
  }

  // src/screenshot-editor.ts
  var editorOpen = false;
  function openScreenshotEditor(options) {
    if (editorOpen) return;
    editorOpen = true;
    let blobUrl = null;
    let mode = "draw";
    const strokes = [];
    const textOverlays = [];
    let currentStroke = null;
    let drawing = false;
    let cropRect = null;
    let cropDragging = false;
    let cropStart = null;
    const history = createEditorHistory();
    const overlay = document.createElement("div");
    overlay.setAttribute("data-visual-editor-screenshot-editor", "true");
    Object.assign(overlay.style, {
      position: "fixed",
      inset: "0",
      zIndex: "2147483647",
      pointerEvents: "auto",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      gap: "12px",
      background: "rgba(0,0,0,0.75)",
      fontFamily: "system-ui, -apple-system, sans-serif"
    });
    const toolbar2 = document.createElement("div");
    Object.assign(toolbar2.style, {
      display: "flex",
      gap: "8px",
      padding: "8px 12px",
      borderRadius: "10px",
      border: "1px solid #3d3d3d",
      background: "#1a1a1a",
      alignItems: "center"
    });
    const statusEl = document.createElement("span");
    Object.assign(statusEl.style, { fontSize: "12px", color: "#8b949e", marginRight: "4px" });
    statusEl.textContent = "Loading\u2026";
    const mkIconBtn = (icon, title, active, onClick, accent) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.title = title;
      btn.innerHTML = icon;
      const border = accent ? "#238636" : active ? "#58a6ff" : "#3d3d3d";
      const bg2 = accent ? "#238636" : active ? "#58a6ff" : "#2a2a2a";
      Object.assign(btn.style, {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "32px",
        height: "32px",
        borderRadius: "6px",
        border: `1px solid ${border}`,
        background: bg2,
        color: "#fff",
        cursor: "pointer"
      });
      btn.addEventListener("click", onClick);
      return btn;
    };
    const mkLabelBtn = (label, accent, onClick) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = label;
      Object.assign(btn.style, {
        padding: "6px 12px",
        borderRadius: "6px",
        border: `1px solid ${accent ? "#238636" : "#3d3d3d"}`,
        background: accent ? "#238636" : "#2a2a2a",
        color: "#fff",
        fontSize: "12px",
        cursor: "pointer"
      });
      btn.addEventListener("click", onClick);
      return btn;
    };
    const drawBtn = mkIconBtn(ICON_DRAW, "Draw", true, () => {
      mode = "draw";
      refreshTools();
    });
    const textBtn = mkIconBtn(ICON_TEXT, "Add text", false, () => {
      mode = "text";
      refreshTools();
      spawnDefaultTextBox();
    });
    const cropBtn = mkIconBtn(ICON_SCISSORS, "Crop", false, () => {
      mode = "crop";
      refreshTools();
    });
    const saveBtn = mkIconBtn(ICON_SAVE, "Save", false, () => void save(), true);
    const undoBtn = mkIconBtn(ICON_UNDO, "Undo", false, () => undo());
    const redoBtn = mkIconBtn(ICON_REDO, "Redo", false, () => redo());
    const cancelBtn = mkLabelBtn("Cancel", false, close);
    const refreshUndoButtons = () => {
      const canUndo = history.canUndo();
      const canRedo = history.canRedo();
      undoBtn.disabled = !canUndo;
      redoBtn.disabled = !canRedo;
      undoBtn.style.opacity = canUndo ? "1" : "0.4";
      redoBtn.style.opacity = canRedo ? "1" : "0.4";
      undoBtn.style.cursor = canUndo ? "pointer" : "not-allowed";
      redoBtn.style.cursor = canRedo ? "pointer" : "not-allowed";
    };
    const refreshTools = () => {
      for (const [btn, active] of [
        [drawBtn, mode === "draw"],
        [textBtn, mode === "text"],
        [cropBtn, mode === "crop"]
      ]) {
        if (btn === saveBtn) continue;
        btn.style.borderColor = active ? "#58a6ff" : "#3d3d3d";
        btn.style.background = active ? "#58a6ff" : "#2a2a2a";
        btn.style.color = active ? "#fff" : "#e6edf3";
      }
      canvas.style.cursor = mode === "draw" ? "crosshair" : mode === "text" ? "text" : "crosshair";
      textLayer.style.pointerEvents = mode === "text" ? "auto" : "none";
      for (const item of textOverlays) {
        item.el.style.pointerEvents = mode === "text" ? "auto" : "none";
      }
    };
    toolbar2.append(statusEl, drawBtn, textBtn, cropBtn, undoBtn, redoBtn, saveBtn, cancelBtn);
    refreshUndoButtons();
    const canvasWrap = document.createElement("div");
    Object.assign(canvasWrap.style, {
      maxWidth: "90vw",
      maxHeight: "calc(100vh - 80px)",
      overflow: "hidden",
      borderRadius: "8px",
      border: "1px solid #3d3d3d",
      boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center"
    });
    const canvasHost = document.createElement("div");
    Object.assign(canvasHost.style, { position: "relative", display: "block", lineHeight: "0" });
    const canvas = document.createElement("canvas");
    canvas.style.display = "block";
    canvas.style.cursor = "crosshair";
    const textLayer = document.createElement("div");
    Object.assign(textLayer.style, {
      position: "absolute",
      top: "0",
      left: "0",
      width: "100%",
      height: "100%",
      pointerEvents: "none"
    });
    const fitCanvasToView = () => {
      if (!canvas.width || !canvas.height) return;
      const maxW = window.innerWidth * 0.9;
      const maxH = window.innerHeight - 100;
      const scale = Math.min(maxW / canvas.width, maxH / canvas.height, 1);
      const displayW = Math.round(canvas.width * scale);
      const displayH = Math.round(canvas.height * scale);
      canvas.style.width = `${displayW}px`;
      canvas.style.height = `${displayH}px`;
      canvasHost.style.width = `${displayW}px`;
      canvasHost.style.height = `${displayH}px`;
      syncAllTextPositions();
    };
    const spawnDefaultTextBox = () => {
      if (!canvas.width || !canvas.height) return;
      const x = Math.max(16, canvas.width * 0.25);
      const y = Math.max(16, canvas.height * 0.35);
      createTextOverlay(x, y, true);
    };
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      editorOpen = false;
      return;
    }
    const bg = new Image();
    const syncTextOverlayPosition = (item) => {
      if (!canvas.width || !canvas.height) return;
      const rect = canvas.getBoundingClientRect();
      item.el.style.left = `${item.x / canvas.width * rect.width}px`;
      item.el.style.top = `${item.y / canvas.height * rect.height}px`;
    };
    const syncAllTextPositions = () => {
      for (const item of textOverlays) {
        syncTextOverlayPosition(item);
      }
    };
    const createTextOverlay = (x, y, focusInput = false, skipHistory = false) => {
      if (!skipHistory) beginMutation();
      const box = document.createElement("div");
      box.setAttribute("data-visual-editor-ui", "true");
      Object.assign(box.style, {
        position: "absolute",
        minWidth: "120px",
        maxWidth: "280px",
        border: "2px solid #f85149",
        borderRadius: "6px",
        background: "rgba(13,17,23,0.92)",
        boxShadow: "0 4px 12px rgba(0,0,0,0.45)",
        pointerEvents: "auto",
        zIndex: "2"
      });
      const handle = document.createElement("div");
      handle.title = "Move";
      Object.assign(handle.style, {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "18px",
        cursor: "move",
        background: "#21262d",
        borderBottom: "1px solid #3d3d3d",
        color: "#8b949e",
        fontSize: "10px",
        userSelect: "none"
      });
      handle.textContent = "\u22EE\u22EE";
      const content = document.createElement("textarea");
      content.placeholder = "Type text\u2026";
      content.rows = 2;
      Object.assign(content.style, {
        display: "block",
        boxSizing: "border-box",
        width: "100%",
        padding: "6px 8px",
        minHeight: "48px",
        outline: "none",
        resize: "none",
        border: "none",
        background: "transparent",
        color: "#f85149",
        font: "bold 16px system-ui, sans-serif",
        cursor: "text"
      });
      box.append(handle, content);
      textLayer.append(box);
      const item = { x, y, el: box };
      textOverlays.push(item);
      syncTextOverlayPosition(item);
      let dragging = false;
      let dragOffsetX = 0;
      let dragOffsetY = 0;
      const moveDrag = (event) => {
        if (!dragging) return;
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        item.x = Math.max(0, Math.min(canvas.width, (event.clientX - rect.left - dragOffsetX) * scaleX));
        item.y = Math.max(0, Math.min(canvas.height, (event.clientY - rect.top - dragOffsetY) * scaleY));
        syncTextOverlayPosition(item);
      };
      const endDrag = () => {
        dragging = false;
        window.removeEventListener("pointermove", moveDrag);
        window.removeEventListener("pointerup", endDrag);
      };
      handle.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        event.stopPropagation();
        beginMutation();
        const rect = box.getBoundingClientRect();
        dragging = true;
        dragOffsetX = event.clientX - rect.left;
        dragOffsetY = event.clientY - rect.top;
        handle.setPointerCapture(event.pointerId);
        window.addEventListener("pointermove", moveDrag);
        window.addEventListener("pointerup", endDrag);
      });
      content.addEventListener("pointerdown", (event) => event.stopPropagation());
      content.addEventListener("mousedown", (event) => event.stopPropagation());
      content.addEventListener("keydown", (event) => event.stopPropagation());
      content.addEventListener("keyup", (event) => event.stopPropagation());
      if (focusInput) {
        requestAnimationFrame(() => content.focus());
      }
    };
    const captureSnapshot = () => ({
      strokes: strokes.map((s) => ({ points: s.points.map((p) => ({ x: p.x, y: p.y })) })),
      texts: textOverlays.map((item) => {
        const input = item.el.querySelector("textarea");
        return {
          x: item.x,
          y: item.y,
          text: input instanceof HTMLTextAreaElement ? input.value : ""
        };
      }),
      cropRect: cropRect ? { ...cropRect } : null
    });
    const restoreSnapshot = (snapshot) => {
      strokes.length = 0;
      for (const stroke of snapshot.strokes) {
        strokes.push({ points: stroke.points.map((p) => ({ x: p.x, y: p.y })) });
      }
      cropRect = snapshot.cropRect ? { ...snapshot.cropRect } : null;
      for (const item of textOverlays) {
        item.el.remove();
      }
      textOverlays.length = 0;
      for (const t of snapshot.texts) {
        createTextOverlay(t.x, t.y, false, true);
        const last = textOverlays[textOverlays.length - 1];
        const input = last.el.querySelector("textarea");
        if (input instanceof HTMLTextAreaElement) {
          input.value = t.text;
        }
      }
      refreshTools();
      redraw();
      refreshUndoButtons();
    };
    const beginMutation = () => {
      history.push(captureSnapshot());
      refreshUndoButtons();
    };
    const undo = () => {
      const prev = history.undo(captureSnapshot());
      if (prev) restoreSnapshot(prev);
    };
    const redo = () => {
      const next = history.redo(captureSnapshot());
      if (next) restoreSnapshot(next);
    };
    const normalizeCropRect = (x1, y1, x2, y2) => {
      const x = Math.min(x1, x2);
      const y = Math.min(y1, y2);
      return { x, y, width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
    };
    const redraw = (showCropGuide = true) => {
      if (!ctx || !bg.naturalWidth) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bg, 0, 0);
      ctx.strokeStyle = "#f85149";
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      for (const stroke of strokes) {
        if (stroke.points.length < 2) continue;
        ctx.beginPath();
        ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
        for (let i = 1; i < stroke.points.length; i++) {
          ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
        }
        ctx.stroke();
      }
      if (showCropGuide && cropRect && cropRect.width > 1 && cropRect.height > 1) {
        ctx.save();
        ctx.strokeStyle = "#58a6ff";
        ctx.lineWidth = 2;
        ctx.setLineDash([8, 4]);
        ctx.strokeRect(cropRect.x, cropRect.y, cropRect.width, cropRect.height);
        ctx.fillStyle = "rgba(0,0,0,0.35)";
        ctx.fillRect(0, 0, canvas.width, cropRect.y);
        ctx.fillRect(0, cropRect.y, cropRect.x, cropRect.height);
        ctx.fillRect(
          cropRect.x + cropRect.width,
          cropRect.y,
          canvas.width - cropRect.x - cropRect.width,
          cropRect.height
        );
        ctx.fillRect(
          0,
          cropRect.y + cropRect.height,
          canvas.width,
          canvas.height - cropRect.y - cropRect.height
        );
        ctx.restore();
      }
    };
    const flattenTextToCanvas = () => {
      const canvasRect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / canvasRect.width;
      const scaleY = canvas.height / canvasRect.height;
      const scale = Math.min(scaleX, scaleY);
      for (const item of textOverlays) {
        const input = item.el.querySelector("textarea");
        const text = input instanceof HTMLTextAreaElement ? input.value.trim() : "";
        if (!text) continue;
        const w = item.el.offsetWidth * scaleX;
        const h = item.el.offsetHeight * scaleY;
        drawTextBoxOnCanvas(ctx, item.x, item.y, w, h, text, scale);
      }
    };
    const canvasPoint = (event) => {
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      return {
        x: (event.clientX - rect.left) * scaleX,
        y: (event.clientY - rect.top) * scaleY
      };
    };
    canvas.addEventListener("pointerdown", (event) => {
      if (!bg.naturalWidth) return;
      event.preventDefault();
      const pt = canvasPoint(event);
      if (mode === "text") {
        createTextOverlay(pt.x, pt.y, true);
        return;
      }
      if (mode === "crop") {
        beginMutation();
        cropDragging = true;
        cropStart = pt;
        cropRect = { x: pt.x, y: pt.y, width: 0, height: 0 };
        canvas.setPointerCapture(event.pointerId);
        redraw();
        return;
      }
      drawing = true;
      beginMutation();
      currentStroke = { points: [pt] };
      strokes.push(currentStroke);
      canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener("pointermove", (event) => {
      if (cropDragging && cropStart) {
        cropRect = normalizeCropRect(cropStart.x, cropStart.y, canvasPoint(event).x, canvasPoint(event).y);
        redraw();
        return;
      }
      if (!drawing || !currentStroke) return;
      currentStroke.points.push(canvasPoint(event));
      redraw();
    });
    const endStroke = () => {
      drawing = false;
      currentStroke = null;
      cropDragging = false;
      cropStart = null;
    };
    canvas.addEventListener("pointerup", endStroke);
    canvas.addEventListener("pointerleave", endStroke);
    const resizeObserver = new ResizeObserver(() => fitCanvasToView());
    resizeObserver.observe(canvas);
    window.addEventListener("resize", fitCanvasToView);
    canvasHost.append(canvas, textLayer);
    canvasWrap.append(canvasHost);
    overlay.append(toolbar2, canvasWrap);
    mountFloatingModal(overlay);
    const onEditorKeyDown = (event) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      const target = event.target;
      if (target instanceof HTMLTextAreaElement) return;
      const key = event.key.toLowerCase();
      if (key === "z" && !event.shiftKey) {
        event.preventDefault();
        undo();
        return;
      }
      if (key === "z" && event.shiftKey || key === "y") {
        event.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onEditorKeyDown);
    overlay.tabIndex = -1;
    requestAnimationFrame(() => overlay.focus());
    void loadCaptureBlobUrl(options.captureId).then((url) => {
      blobUrl = url;
      bg.onload = () => {
        canvas.width = bg.naturalWidth;
        canvas.height = bg.naturalHeight;
        statusEl.textContent = "";
        fitCanvasToView();
        redraw();
        syncAllTextPositions();
      };
      bg.onerror = () => {
        statusEl.textContent = "Could not load the screenshot";
        statusEl.style.color = "#f85149";
      };
      bg.src = url;
    }).catch((error) => {
      statusEl.textContent = error instanceof Error ? error.message : "Loading failed";
      statusEl.style.color = "#f85149";
    });
    function close() {
      resizeObserver.disconnect();
      window.removeEventListener("resize", fitCanvasToView);
      window.removeEventListener("keydown", onEditorKeyDown);
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      overlay.remove();
      editorOpen = false;
    }
    async function save() {
      if (!bg.naturalWidth) return;
      saveBtn.disabled = true;
      try {
        redraw(false);
        flattenTextToCanvas();
        let exportCanvas = canvas;
        if (cropRect && cropRect.width >= 4 && cropRect.height >= 4) {
          const cropped = document.createElement("canvas");
          const x = Math.round(cropRect.x);
          const y = Math.round(cropRect.y);
          const w = Math.round(cropRect.width);
          const h = Math.round(cropRect.height);
          cropped.width = w;
          cropped.height = h;
          const croppedCtx = cropped.getContext("2d");
          if (!croppedCtx) throw new Error("Export failed");
          croppedCtx.drawImage(canvas, x, y, w, h, 0, 0, w, h);
          exportCanvas = cropped;
        }
        const blob = await new Promise(
          (resolve) => exportCanvas.toBlob(resolve, "image/png")
        );
        if (!blob) throw new Error("Export failed");
        const buffer = await blob.arrayBuffer();
        await options.onSave(Array.from(new Uint8Array(buffer)));
        close();
      } catch {
        saveBtn.disabled = false;
        redraw();
      }
    }
  }

  // src/toolbar-captures.ts
  var PLUGIN2 = "plugin:visual-editor";
  var activePreview = null;
  var activePreviewUrl = null;
  function hidePreview() {
    activePreview?.remove();
    activePreview = null;
    if (activePreviewUrl) {
      URL.revokeObjectURL(activePreviewUrl);
      activePreviewUrl = null;
    }
  }
  function captureLabel(capture, index) {
    const type = capture.capture_type === "webview" ? "Screenshot" : capture.capture_type;
    return `${type} #${index + 1}`;
  }
  function renderCaptureChip(capture, index, _cacheBust, composer, onSaved, onRemove) {
    const chip = document.createElement("span");
    chip.setAttribute("data-visual-editor-capture-chip", capture.id);
    chip.setAttribute("contenteditable", "false");
    Object.assign(chip.style, {
      display: "inline-flex",
      alignItems: "center",
      gap: "4px",
      padding: "2px 8px",
      borderRadius: "6px",
      border: "1px solid rgba(63,185,80,0.55)",
      background: "rgba(63,185,80,0.12)",
      color: "#e6edf3",
      fontSize: "11px",
      cursor: "pointer",
      maxWidth: "100%",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
      verticalAlign: "middle",
      userSelect: "none",
      margin: "4px 6px 10px 0",
      transition: "background 0.15s ease, border-color 0.15s ease"
    });
    const icon = document.createElement("span");
    icon.innerHTML = ICON_CAPTURE_CHIP;
    icon.style.display = "flex";
    icon.style.color = "#3fb950";
    const label = document.createElement("span");
    label.textContent = captureLabel(capture, index);
    chip.append(icon, label);
    if (onRemove) {
      chip.append(
        createChipRemoveButton(composer, chip, "Remove screenshot chip", () => {
          hidePreview();
          onRemove(capture.id);
        })
      );
    }
    chip.addEventListener("mouseenter", () => {
      hidePreview();
      chip.style.background = "rgba(63,185,80,0.22)";
      chip.style.borderColor = "#3fb950";
      void loadCaptureBlobUrl(capture.id).then((url) => {
        activePreviewUrl = url;
        const pop = document.createElement("div");
        const img = document.createElement("img");
        img.src = url;
        img.alt = "Screenshot preview";
        Object.assign(img.style, {
          display: "block",
          maxWidth: "280px",
          maxHeight: "200px",
          borderRadius: "6px"
        });
        Object.assign(pop.style, {
          position: "fixed",
          padding: "8px",
          borderRadius: "8px",
          background: "#0d1117",
          border: "1px solid #3d3d3d",
          boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
          pointerEvents: "none"
        });
        pop.append(img);
        mountFloatingElement(pop);
        activePreview = pop;
        const rect = chip.getBoundingClientRect();
        let left = rect.left;
        let top = rect.bottom + 8;
        if (left + 300 > window.innerWidth - 8) left = window.innerWidth - 308;
        if (top + 220 > window.innerHeight - 8) top = rect.top - 228;
        pop.style.left = `${Math.max(8, left)}px`;
        pop.style.top = `${Math.max(8, top)}px`;
      }).catch(() => void 0);
    });
    chip.addEventListener("mouseleave", () => {
      hidePreview();
      chip.style.background = "rgba(63,185,80,0.12)";
      chip.style.borderColor = "rgba(63,185,80,0.55)";
    });
    setupComposerChip(chip, composer, {
      onChipClick: () => {
        hidePreview();
        openScreenshotEditor({
          captureId: capture.id,
          onSave: async (pngBytes) => {
            await invoke(`${PLUGIN2}|save_capture_image`, {
              captureId: capture.id,
              pngBytes
            });
            onSaved();
          }
        });
      }
    });
    return chip;
  }

  // src/messages.ts
  var RULES = [
    {
      match: /projectRoot|project root/i,
      title: "This project is not set up for HardlyUI yet",
      action: 'Run "hardlyui init" in the project, or ask whoever set it up, then reopen the editor.'
    },
    {
      match: /version label|label must be/i,
      title: "Give the checkpoint a short name",
      action: "Use between 1 and 80 ordinary characters, with no line breaks."
    },
    {
      match: /stores at most \d+ versions/i,
      title: "You have reached the checkpoint limit",
      action: 'Delete an older checkpoint, or use "Keep newest 20", then save again.'
    },
    {
      match: /pictures must be at most \d+ MiB|larger than the media limit/i,
      title: "That picture is too big for the library",
      action: "Use a picture under 4 MB, or shrink it before uploading."
    },
    {
      match: /media library holds at most \d+ pictures/i,
      title: "The picture library is full",
      action: "Remove a picture you no longer use, then upload this one again."
    },
    {
      match: /only PNG, JPEG, WebP, GIF and SVG|media file name is not a supported picture/i,
      title: "That file is not a picture the library can store",
      action: "Use a PNG, JPEG, WebP, GIF or SVG file."
    },
    {
      match: /SVG contains script or remote content/i,
      title: "That picture can run code, so it was refused",
      action: "Export the picture again without scripts or remote content, then upload it."
    },
    {
      match: /that file is empty/i,
      title: "That file is empty",
      action: "Choose a picture file that actually contains a picture."
    },
    {
      match: /that file could not be read/i,
      title: "That picture could not be opened",
      action: "Try a different file, or export the picture again."
    },
    {
      match: /cannot delete picture/i,
      title: "That picture could not be removed",
      action: "Reopen the pictures panel to refresh the list, then try again."
    },
    {
      match: /invalid version ID|version snapshot path is invalid|version thumbnail path is invalid|no such file|not found/i,
      title: "That saved version is no longer there",
      action: "Close the version panel and reopen it to refresh the list."
    },
    {
      match: /exceeds \d+ (KiB|MiB)/i,
      title: "That file is too large",
      action: "Use a smaller picture, or reduce how much of the page you capture."
    },
    {
      match: /must be PNG data/i,
      title: "That is not a picture the editor can store",
      action: "Use a PNG, JPEG or WebP image."
    },
    {
      match: /Unknown (capture|element)/i,
      title: "That item is no longer in the selection",
      action: "Close and reopen the inspector to refresh the list."
    },
    {
      match: /thumbnail|screenshot|capture/i,
      title: "The preview picture could not be taken",
      action: "Your change is still saved. Try saving the checkpoint again; if it keeps failing, the app window has to be visible."
    },
    {
      match: /unsupported or unsafe style/i,
      title: "That block uses a setting the editor cannot write into the source file",
      action: "Keep it as a plain layout block, or change the setting here first, then save it again."
    },
    {
      match: /image must use HTTPS|needs a supported source address|unsupported address/i,
      title: "That picture cannot be linked from this project",
      action: "Upload it with the media panel, or use an https:// address."
    },
    {
      match: /Cannot reuse active content/i,
      title: "This block contains active content",
      action: "Remove the script, style or embedded frame from it, then save the block again."
    },
    {
      match: /Reusable groups are limited to/i,
      title: "This block is too big to save as one piece",
      action: "Save a smaller part of it: up to 50 elements, 8 levels deep."
    },
    {
      match: /exactly one root element/i,
      title: "A reusable block has to be a single element",
      action: "Wrap the pieces in one container, then save them again."
    },
    {
      match: /simple variable or dotted|bindings must be simple/i,
      title: "That block uses a value the editor cannot save into source",
      action: "Replace the dynamic value with plain text, or bind it from the text panel."
    },
    {
      match: /Repeated elements cannot|repeated elements/i,
      title: "This item repeats, so it cannot be edited one at a time",
      action: "Edit the template that generates the repeat instead."
    },
    {
      match: /Source changed outside HardlyUI|changed after preview/i,
      title: "The file changed while you were editing",
      action: "Undo your last change, then make it again so it applies to the current file."
    },
    {
      match: /Nothing to (undo|redo)/i,
      title: "There is nothing to undo there",
      action: "Keep undoing other changes, or save a checkpoint before your next edit."
    },
    {
      match: /Forbidden origin/i,
      title: "The editor cannot talk to this page",
      action: "Open the project from the HardlyUI launcher so the editor and the app are paired."
    },
    {
      match: /outside the project/i,
      title: "That file is outside this project",
      action: "Select the element again from the page itself."
    },
    {
      match: /Webview window not found|window not found/i,
      title: "The app window is not available",
      action: "Bring the app window to the front, then try again."
    },
    {
      match: /cannot be safely removed|cannot be removed/i,
      title: "This element cannot be removed on its own",
      action: "Select a child element, or hide it from the Structure panel."
    },
    {
      match: /nothing selected|select an element/i,
      title: "Nothing is selected",
      action: "Click the element in the page first."
    },
    {
      match: /invalid edited text|text operation must change/i,
      title: "That text cannot be saved",
      action: "Type something different, without control characters."
    },
    {
      match: /Feature (gate|is) blocked|disabled/i,
      title: "The editor is turned off for this project",
      action: "Turn HardlyUI on from the toolbar. In a production build it also needs allow_in_production."
    }
  ];
  var UNKNOWN_ACTION = "Try again. If it keeps happening, open Details and copy the text for whoever maintains the project.";
  var PLAIN = Symbol("hardlyui.plain-message");
  function explainError(raw) {
    const detail = raw instanceof Error ? raw.message : typeof raw === "string" ? raw : String(raw);
    const rule = RULES.find((candidate) => candidate.match.test(detail));
    if (rule) return { title: rule.title, action: rule.action, detail };
    if (typeof raw === "object" && raw !== null && raw[PLAIN]) {
      return { title: detail, action: "", detail };
    }
    return { title: "Something went wrong", action: UNKNOWN_ACTION, detail };
  }
  function explainErrorLine(raw) {
    const explained = explainError(raw);
    return explained.action ? `${explained.title} \u2014 ${explained.action}` : explained.title;
  }

  // src/toolbar.ts
  var PLUGIN3 = "plugin:visual-editor";
  var COMPOSER_PLACEHOLDER = "Write some context...";
  function syncComposerPlaceholder(composer) {
    const hasChips = Boolean(
      composer.querySelector("[data-visual-editor-chip], [data-visual-editor-capture-chip]")
    );
    const hasText = extractComposerText(composer).trim().length > 0;
    composer.dataset.empty = hasText || hasChips ? "false" : "true";
  }
  var STATE_EVENT = "visual-editor://state-updated";
  var ROOT_ID2 = "visual-editor-toolbar-root";
  var InspectorToolbar = class {
    root = null;
    shell = null;
    body = null;
    panel = null;
    composerBox = null;
    composerFlow = null;
    messageEl = null;
    copyBtn = null;
    pickerBtn = null;
    panelBtn = null;
    collapseBtn = null;
    devtoolsBtn = null;
    headerTitle = null;
    nav = null;
    panelOpen = false;
    collapsed = false;
    pickerEnabled = false;
    /** Last value handed to `onPickerChange`, so state pushes do not repeat it. */
    reportedPicker = null;
    prevSelectionCount = 0;
    prevCaptureCount = 0;
    captureCacheBust = /* @__PURE__ */ new Map();
    state = null;
    unlisten = null;
    issueTimer = null;
    messageTimer = null;
    pickerAutoDisabledForTyping = false;
    options;
    constructor(options = {}) {
      this.options = options;
    }
    async open() {
      if (this.root) {
        this.root.style.display = "block";
        return;
      }
      await new Promise((resolve) => {
        const mountNow = () => {
          this.mount();
          resolve();
        };
        if (typeof requestIdleCallback === "function") {
          requestIdleCallback(mountNow, { timeout: 50 });
        } else {
          setTimeout(mountNow, 0);
        }
      });
      await this.refreshState();
      this.unlisten = await listen(STATE_EVENT, (event) => {
        this.state = event.payload;
        this.syncUi();
      });
    }
    close() {
      if (this.root) {
        this.root.style.display = "none";
      }
    }
    destroy() {
      this.unlisten?.();
      this.unlisten = null;
      this.root?.remove();
      this.root = null;
      this.shell = null;
      this.panel = null;
    }
    async refreshState() {
      try {
        this.state = await invoke(`${PLUGIN3}|get_state`);
        this.syncUi();
      } catch {
      }
    }
    mount() {
      const root = document.createElement("div");
      root.id = ROOT_ID2;
      root.setAttribute("data-visual-editor-toolbar", "true");
      root.setAttribute("data-visual-editor-ui", "true");
      markCaptureHideRoot(root);
      Object.assign(root.style, {
        position: "fixed",
        top: "8px",
        right: "8px",
        zIndex: "2147483647",
        fontFamily: "system-ui, -apple-system, sans-serif",
        pointerEvents: "none"
      });
      const shell = document.createElement("div");
      shell.setAttribute("data-visual-editor-ui", "true");
      Object.assign(shell.style, {
        display: "flex",
        flexDirection: "column",
        width: "fit-content",
        borderRadius: "12px",
        border: "1px solid #3d3d3d",
        background: "rgba(26,26,26,0.96)",
        boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
        pointerEvents: "auto",
        overflow: "hidden"
      });
      const header = document.createElement("div");
      Object.assign(header.style, {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "6px",
        padding: "4px 8px",
        borderBottom: "1px solid #3d3d3d",
        background: "#1a1a1a",
        userSelect: "none"
      });
      const grip = document.createElement("span");
      grip.innerHTML = ICON_GRIP;
      grip.style.display = "flex";
      grip.style.color = "#8b949e";
      attachTooltip(grip, "Move overlay");
      const headerTitle = document.createElement("span");
      headerTitle.textContent = "Visual Inspector";
      this.headerTitle = headerTitle;
      Object.assign(headerTitle.style, {
        flex: "1",
        fontSize: "10px",
        color: "#8b949e",
        textAlign: "center"
      });
      this.collapseBtn = document.createElement("button");
      this.collapseBtn.type = "button";
      this.collapseBtn.innerHTML = ICON_CHEVRON_UP;
      Object.assign(this.collapseBtn.style, {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "24px",
        height: "24px",
        border: "none",
        borderRadius: "6px",
        background: "transparent",
        color: "#e6edf3",
        cursor: "pointer",
        transition: "background 0.15s ease"
      });
      this.collapseBtn.addEventListener("mouseenter", () => {
        this.collapseBtn.style.background = "#2a2a2a";
      });
      this.collapseBtn.addEventListener("mouseleave", () => {
        this.collapseBtn.style.background = "transparent";
      });
      attachTooltip(this.collapseBtn, "Collapse overlay");
      this.collapseBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.setCollapsed(!this.collapsed);
      });
      header.append(grip, headerTitle, this.collapseBtn);
      makeDraggable(shell, header);
      this.body = document.createElement("div");
      Object.assign(this.body.style, {
        display: "flex",
        alignItems: "flex-start",
        gap: "8px",
        padding: "8px",
        width: "fit-content"
      });
      this.panel = document.createElement("div");
      this.panel.setAttribute("data-visual-editor-ui", "true");
      Object.assign(this.panel.style, {
        display: "none",
        flexDirection: "column",
        width: "280px",
        minHeight: "300px",
        padding: "10px",
        borderRadius: "10px",
        border: "1px solid #3d3d3d",
        background: "#0d1117",
        color: "#e6edf3"
      });
      this.composerBox = document.createElement("div");
      this.composerBox.setAttribute("data-visual-editor-ui", "true");
      Object.assign(this.composerBox.style, {
        position: "relative",
        flex: "1 1 auto",
        display: "flex",
        flexDirection: "column",
        minHeight: "180px",
        marginBottom: "8px",
        borderRadius: "6px",
        border: "1px solid #3d3d3d",
        background: "#161b22",
        overflow: "hidden"
      });
      this.composerFlow = document.createElement("div");
      this.composerFlow.setAttribute("contenteditable", "true");
      this.composerFlow.setAttribute("data-visual-editor-composer", "true");
      this.composerFlow.setAttribute("data-placeholder", COMPOSER_PLACEHOLDER);
      Object.assign(this.composerFlow.style, {
        display: "block",
        flex: "1 1 auto",
        minHeight: "160px",
        padding: "8px",
        outline: "none",
        color: "#e6edf3",
        fontSize: "12px",
        lineHeight: "1.5",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        cursor: "text",
        overflowY: "auto"
      });
      syncComposerPlaceholder(this.composerFlow);
      ensureComposerTail(this.composerFlow);
      this.composerFlow.addEventListener("mousedown", (event) => {
        if (event.button !== 0) return;
        const hit = document.elementFromPoint(event.clientX, event.clientY);
        const chip = hit?.closest("[data-visual-editor-chip], [data-visual-editor-capture-chip]");
        if (!(chip instanceof HTMLElement) || !this.composerFlow.contains(chip)) return;
        event.preventDefault();
        focusComposerAtChip(this.composerFlow, event.clientX, event.clientY);
      });
      setupComposerDropTarget(this.composerFlow);
      setupComposerChipKeydown(this.composerFlow, {
        onRemoveElement: (elementId) => this.removeChip("element", elementId),
        onRemoveCapture: (captureId) => this.removeChip("capture", captureId)
      });
      this.composerFlow.addEventListener("input", () => {
        sanitizeComposerWhileTyping(this.composerFlow);
        syncComposerPlaceholder(this.composerFlow);
        void this.disablePickerIfTyping();
        if (this.issueTimer) clearTimeout(this.issueTimer);
        this.issueTimer = setTimeout(() => {
          void invoke(`${PLUGIN3}|set_issue_text`, {
            text: extractComposerText(this.composerFlow)
          });
        }, 800);
      });
      this.composerFlow.addEventListener("paste", (event) => {
        event.preventDefault();
        const text = event.clipboardData?.getData("text/plain") ?? "";
        document.execCommand("insertText", false, text);
      });
      this.composerBox.append(this.composerFlow);
      const composerStyle = document.createElement("style");
      composerStyle.textContent = `
[data-visual-editor-composer][data-empty="true"]::before{content:attr(data-placeholder);color:#8b949e;pointer-events:none}
[data-visual-editor-composer] [data-visual-editor-chip],
[data-visual-editor-composer] [data-visual-editor-capture-chip]{
  margin:4px 6px 10px 0;
  vertical-align:middle;
}`;
      root.append(composerStyle);
      const actions = document.createElement("div");
      Object.assign(actions.style, {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "8px",
        flexShrink: "0"
      });
      const btnRow = document.createElement("div");
      Object.assign(btnRow.style, { display: "flex", gap: "8px" });
      this.copyBtn = createPanelButton("Copy", (event) => void this.runAction("copy", event.shiftKey));
      attachTooltip(this.copyBtn, "Copy issue + context refs (Shift: full bundle)");
      const clearBtn = createPanelButton("Clear", () => void this.runClear());
      btnRow.append(this.copyBtn, clearBtn);
      this.messageEl = document.createElement("span");
      this.messageEl.setAttribute("data-visual-editor-status", "true");
      Object.assign(this.messageEl.style, { fontSize: "11px", color: "#8b949e" });
      actions.append(btnRow, this.messageEl);
      this.panel.append(this.composerBox, actions);
      const nav = document.createElement("nav");
      nav.setAttribute("data-visual-editor-ui", "true");
      nav.setAttribute("data-visual-editor-nav", "true");
      Object.assign(nav.style, { display: "flex", flexDirection: "column", gap: "8px" });
      this.nav = nav;
      nav.appendChild(
        iconButton(
          "Hard reload",
          "Hard Reload (Clear Cache)",
          ICON_RELOAD,
          () => void this.runAction("reload")
        )
      );
      nav.appendChild(
        iconButton(
          "Screenshot",
          "Take a Screenshot",
          ICON_SCREENSHOT,
          () => void this.runAction("capture")
        )
      );
      this.pickerBtn = iconButton(
        "Element picker",
        "Visual Inspector (Inspect Elements in UI)",
        ICON_INSPECT_PICKER,
        () => void this.togglePicker()
      );
      this.pickerBtn.setAttribute("data-visual-editor-picker-toggle", "true");
      nav.appendChild(this.pickerBtn);
      this.panelBtn = iconButton(
        "Context panel",
        "Context Box (Write Text, Edit Screenshots, Analyze inspected UI)",
        ICON_CONTEXT,
        () => this.togglePanel()
      );
      nav.appendChild(this.panelBtn);
      this.devtoolsBtn = iconButton(
        "Console",
        "Devtools (Elements, Console, Network etc..)",
        ICON_DEVTOOLS,
        () => void this.toggleDevtools()
      );
      nav.appendChild(this.devtoolsBtn);
      this.body.append(this.panel, nav);
      shell.append(header, this.body);
      root.append(shell);
      document.documentElement.appendChild(root);
      this.root = root;
      this.shell = shell;
      this.syncShellLayout();
    }
    syncShellLayout() {
      const compact = !this.panelOpen;
      if (this.headerTitle) {
        this.headerTitle.style.display = compact ? "none" : "block";
      }
      if (this.nav) {
        this.nav.style.flexShrink = "0";
      }
    }
    showTransientMessage(text, ms = 2500) {
      if (!this.messageEl) return;
      if (this.messageTimer) clearTimeout(this.messageTimer);
      this.messageEl.textContent = text;
      this.messageTimer = setTimeout(() => {
        if (this.messageEl) this.messageEl.textContent = "";
        this.messageTimer = null;
      }, ms);
    }
    setCollapsed(collapsed) {
      this.collapsed = collapsed;
      if (this.body) {
        this.body.style.display = collapsed ? "none" : "flex";
      }
      if (this.collapseBtn) {
        this.collapseBtn.innerHTML = collapsed ? ICON_CHEVRON_DOWN : ICON_CHEVRON_UP;
        attachTooltip(this.collapseBtn, collapsed ? "Expand overlay" : "Collapse overlay");
      }
    }
    renderChips() {
      if (!this.composerFlow) return;
      const isFocused = document.activeElement === this.composerFlow;
      const elements = this.state?.session.selected_elements ?? [];
      const captures = this.state?.session.captures ?? [];
      const wantedElementIds = new Set(elements.map((el) => el.id));
      const wantedCaptureIds = new Set(captures.map((c) => c.id));
      const currentElementIds = new Set(
        [...this.composerFlow.querySelectorAll("[data-visual-editor-chip]")].map((node) => node.getAttribute("data-chip-id")).filter((id) => Boolean(id))
      );
      const currentCaptureIds = new Set(
        [...this.composerFlow.querySelectorAll("[data-visual-editor-capture-chip]")].map((node) => node.getAttribute("data-visual-editor-capture-chip")).filter((id) => Boolean(id))
      );
      const chipsChanged = elements.some((el) => !currentElementIds.has(el.id)) || captures.some((cap) => !currentCaptureIds.has(cap.id)) || [...currentElementIds].some((id) => !wantedElementIds.has(id)) || [...currentCaptureIds].some((id) => !wantedCaptureIds.has(id));
      if (isFocused && !chipsChanged) {
        return;
      }
      const savedCaret = isFocused ? saveComposerCaret(this.composerFlow) : null;
      this.composerFlow.querySelectorAll("[data-visual-editor-chip]").forEach((node) => {
        const id = node.getAttribute("data-chip-id");
        if (!id || !wantedElementIds.has(id)) node.remove();
      });
      this.composerFlow.querySelectorAll("[data-visual-editor-capture-chip]").forEach((node) => {
        const id = node.getAttribute("data-visual-editor-capture-chip");
        if (!id || !wantedCaptureIds.has(id)) node.remove();
      });
      if (!isFocused) {
        ensureComposerTail(this.composerFlow);
      }
      const insertAtCaret = (chip) => {
        if (isFocused) {
          const sel = window.getSelection();
          if (sel?.rangeCount && this.composerFlow.contains(sel.anchorNode ?? null)) {
            const range = sel.getRangeAt(0);
            insertChipAtRange(this.composerFlow, chip, range);
            return;
          }
        }
        this.composerFlow.appendChild(chip);
      };
      for (const el of elements) {
        if (this.composerFlow.querySelector(`[data-chip-id="${el.id}"]`)) continue;
        const chip = renderChip(
          el,
          this.composerFlow,
          (selected) => this.options.onChipFocus?.(selected),
          (elementId) => void this.removeChip("element", elementId)
        );
        chip.setAttribute("data-chip-id", el.id);
        insertAtCaret(chip);
      }
      captures.forEach((capture, index) => {
        if (this.composerFlow.querySelector(`[data-visual-editor-capture-chip="${capture.id}"]`)) {
          return;
        }
        const bust = this.captureCacheBust.get(capture.id) ?? capture.id;
        const chip = renderCaptureChip(
          capture,
          index,
          bust,
          this.composerFlow,
          () => {
            this.captureCacheBust.set(capture.id, Date.now());
            this.renderChips();
          },
          (captureId) => void this.removeChip("capture", captureId)
        );
        insertAtCaret(chip);
      });
      if (!isFocused) {
        normalizeComposerInlines(this.composerFlow);
      }
      if (savedCaret) {
        restoreComposerCaret(savedCaret);
      }
      syncComposerPlaceholder(this.composerFlow);
    }
    setComposerIssueText(text) {
      if (!this.composerFlow) return;
      const chips = [
        ...this.composerFlow.querySelectorAll(
          "[data-visual-editor-chip], [data-visual-editor-capture-chip]"
        )
      ];
      for (const node of [...this.composerFlow.childNodes]) {
        if (!isComposerChipNode(node)) node.remove();
      }
      if (text) {
        this.composerFlow.insertBefore(document.createTextNode(text), this.composerFlow.firstChild);
      }
      for (const chip of chips) {
        this.composerFlow.appendChild(chip);
      }
      normalizeComposerInlines(this.composerFlow);
      syncComposerPlaceholder(this.composerFlow);
    }
    syncUi() {
      if (!this.state) return;
      this.pickerEnabled = this.state.enabled;
      if (this.state.enabled) {
        this.pickerAutoDisabledForTyping = false;
      }
      if (this.pickerEnabled !== this.reportedPicker) {
        this.reportedPicker = this.pickerEnabled;
        this.options.onPickerChange?.(this.pickerEnabled);
      }
      const selectionCount = this.state.session.selected_elements.length;
      const captureCount = this.state.session.captures?.length ?? 0;
      if (selectionCount > 0 && selectionCount !== this.prevSelectionCount) {
        this.setPanelOpen(true);
      }
      if (captureCount > 0 && captureCount !== this.prevCaptureCount) {
        this.setPanelOpen(true);
      }
      this.prevSelectionCount = selectionCount;
      this.prevCaptureCount = captureCount;
      this.renderChips();
      if (this.composerFlow && this.state.session.issue_text != null) {
        const next = this.state.session.issue_text;
        const composerFocused = document.activeElement === this.composerFlow;
        if (!composerFocused && extractComposerText(this.composerFlow) !== next) {
          this.setComposerIssueText(next);
        }
      }
      this.syncActiveButtons();
    }
    syncActiveButtons() {
      if (this.pickerBtn) {
        const active = this.pickerEnabled;
        this.pickerBtn.dataset.active = active ? "true" : "";
        this.pickerBtn.style.borderColor = active ? "#58a6ff" : "#3d3d3d";
        this.pickerBtn.style.background = active ? "#58a6ff" : "#2a2a2a";
        this.pickerBtn.style.color = active ? "#fff" : "#e6edf3";
      }
      if (this.panelBtn) {
        const active = this.panelOpen;
        this.panelBtn.dataset.active = active ? "true" : "";
        this.panelBtn.style.borderColor = active ? "#58a6ff" : "#3d3d3d";
        this.panelBtn.style.background = active ? "#58a6ff" : "#2a2a2a";
        this.panelBtn.style.color = active ? "#fff" : "#e6edf3";
      }
    }
    togglePanel() {
      this.setPanelOpen(!this.panelOpen);
    }
    setPanelOpen(open) {
      this.panelOpen = open;
      if (this.panel) {
        this.panel.style.display = open ? "flex" : "none";
      }
      this.syncShellLayout();
      this.syncActiveButtons();
    }
    async disablePickerIfTyping() {
      if (this.pickerAutoDisabledForTyping || !this.pickerEnabled || !this.composerFlow) {
        return;
      }
      if (extractComposerText(this.composerFlow).length === 0) return;
      this.pickerAutoDisabledForTyping = true;
      try {
        await invoke(`${PLUGIN3}|disable`);
        this.pickerEnabled = false;
        this.options.onPickerChange?.(false);
      } catch {
        this.pickerAutoDisabledForTyping = false;
        await this.refreshState();
      }
    }
    async toggleDevtools() {
      try {
        const open = await invoke(`${PLUGIN3}|toggle_devtools`);
        if (this.devtoolsBtn) {
          this.devtoolsBtn.dataset.active = open ? "true" : "";
          this.devtoolsBtn.style.borderColor = open ? "#58a6ff" : "#3d3d3d";
          this.devtoolsBtn.style.background = open ? "#58a6ff" : "#2a2a2a";
          this.devtoolsBtn.style.color = open ? "#fff" : "#e6edf3";
        }
        this.showTransientMessage(open ? "DevTools opened" : "DevTools closed");
      } catch (error) {
        this.showTransientMessage(explainErrorLine(error), 6e3);
        if (!this.panelOpen) {
          this.setPanelOpen(true);
        }
      }
    }
    async togglePicker() {
      const nextEnabled = !this.pickerEnabled;
      try {
        if (nextEnabled) {
          await invoke(`${PLUGIN3}|enable`);
        } else {
          await invoke(`${PLUGIN3}|disable`);
        }
        this.pickerEnabled = nextEnabled;
        this.reportedPicker = nextEnabled;
        this.options.onPickerChange?.(nextEnabled);
        await this.refreshState();
      } catch (error) {
        await this.refreshState();
        this.showTransientMessage(explainErrorLine(error), 6e3);
        if (!this.panelOpen) {
          this.setPanelOpen(true);
        }
      }
    }
    /**
     * A chip can outlive what it points at: the page reloaded, the capture was
     * deleted elsewhere. The backend then refuses the removal, and discarding
     * that left the user pressing a remove button that did nothing.
     */
    async removeChip(kind, id) {
      try {
        if (kind === "element") {
          await invoke(`${PLUGIN3}|remove_element`, { elementId: id });
        } else {
          await invoke(`${PLUGIN3}|remove_capture`, { captureId: id });
        }
      } catch (error) {
        if (!this.panelOpen) this.setPanelOpen(true);
        this.showTransientMessage(explainErrorLine(error), 6e3);
      }
    }
    runClear() {
      if (!this.composerBox) return;
      runClearWipe(this.composerBox, () => {
        void this.runAction("clear");
      });
    }
    async runAction(kind, fullBundle = false) {
      if (this.messageTimer) {
        clearTimeout(this.messageTimer);
        this.messageTimer = null;
      }
      if (this.messageEl) this.messageEl.textContent = "";
      try {
        if (kind === "reload") await invoke(`${PLUGIN3}|hard_reload`);
        if (kind === "capture") await invoke(`${PLUGIN3}|capture`, { options: { mode: "webview" } });
        if (kind === "copy") {
          const blocks = !fullBundle && this.composerFlow ? extractComposerBlocks(this.composerFlow) : void 0;
          await invoke(`${PLUGIN3}|copy_context_bundle`, { full: fullBundle, blocks });
          if (this.copyBtn && !fullBundle) showCopySuccess(this.copyBtn);
        }
        if (kind === "clear") {
          await invoke(`${PLUGIN3}|clear_session`);
          if (this.composerFlow) {
            this.setComposerIssueText("");
          }
          this.captureCacheBust.clear();
        }
        if (kind !== "copy") {
          const msg = kind === "reload" ? "Hard reload done" : kind === "capture" ? "Screenshot captured" : kind === "clear" ? "Session cleared" : "";
          if (msg) this.showTransientMessage(msg);
        } else if (this.messageEl) {
          this.showTransientMessage(
            fullBundle ? "Context bundle copied" : "Composer copied"
          );
        }
        await this.refreshState();
      } catch (error) {
        if (!this.panelOpen) {
          this.setPanelOpen(true);
        }
        this.showTransientMessage(explainErrorLine(error), 6e3);
      }
    }
  };

  // src/editing.ts
  var TEXT_BINDING_ATTRIBUTE = "data-hardlyui-bind-text";
  var textBindingObserver = null;
  var textBindingEventsInstalled = false;
  var responsiveStyleRules = /* @__PURE__ */ new Map();
  var ALLOWED_PROPERTIES = /* @__PURE__ */ new Set([
    "width",
    "height",
    "min-width",
    "max-width",
    "min-height",
    "max-height",
    "margin",
    "margin-top",
    "margin-right",
    "margin-bottom",
    "margin-left",
    "padding",
    "padding-top",
    "padding-right",
    "padding-bottom",
    "padding-left",
    "color",
    "background-color",
    "display",
    "flex-direction",
    "flex-wrap",
    "flex-grow",
    "flex-shrink",
    "flex-basis",
    "grid-template-columns",
    "order",
    "align-items",
    "justify-content",
    "gap",
    "align-self",
    "translate",
    "font-size",
    "font-weight",
    "line-height",
    "border-radius",
    "border-width",
    "border-color",
    "--hardlyui-locked"
  ]);
  function targetForIdentity(identity) {
    const choices = [
      ["data-inspector-id", identity.inspector_id],
      ["id", identity.html_id],
      ["data-hardlyui-id", identity.generated_id]
    ];
    for (const [attribute, value] of choices) {
      if (!value) continue;
      const match = Array.from(document.querySelectorAll(`[${attribute}]`)).find(
        (element) => element.getAttribute(attribute) === value
      );
      if (match) return match;
    }
    if (!identity.semantic_selector) return null;
    try {
      const matches = document.querySelectorAll(identity.semantic_selector);
      const match = matches.length === 1 ? matches.item(0) : null;
      if (match && identity.generated_id) match.setAttribute("data-hardlyui-id", identity.generated_id);
      return match;
    } catch {
      return null;
    }
  }
  function identityFromBinding(element) {
    try {
      const value = element.getAttribute(TEXT_BINDING_ATTRIBUTE);
      return value ? JSON.parse(value) : null;
    } catch {
      return null;
    }
  }
  function textValue(element) {
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
      return element.value;
    }
    return element.textContent ?? "";
  }
  function sourceWouldCycle(target, source) {
    const visited = /* @__PURE__ */ new Set();
    let current = source;
    while (current && !visited.has(current)) {
      if (current === target || current.contains(target) || target.contains(current)) return true;
      visited.add(current);
      const parentIdentity = identityFromBinding(current);
      current = parentIdentity ? targetForIdentity(parentIdentity) : null;
    }
    return false;
  }
  function syncTextBindings() {
    for (const target of Array.from(document.querySelectorAll(`[${TEXT_BINDING_ATTRIBUTE}]`))) {
      const identity = identityFromBinding(target);
      if (!identity || target.children.length > 0) continue;
      const source = targetForIdentity(identity);
      if (!source || source === target || sourceWouldCycle(target, source)) continue;
      const value = textValue(source);
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        if (target.value !== value) target.value = value;
      } else if (target.textContent !== value) {
        target.textContent = value;
      }
    }
  }
  function installTextBindingObserver() {
    if (!document.documentElement) return;
    if (!textBindingObserver) {
      textBindingObserver = new MutationObserver(() => syncTextBindings());
      textBindingObserver.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    }
    if (!textBindingEventsInstalled) {
      document.addEventListener("input", syncTextBindings, true);
      document.addEventListener("change", syncTextBindings, true);
      textBindingEventsInstalled = true;
    }
    syncTextBindings();
  }
  function safeArtworkUrl(value) {
    if (value.length > 2048 || /[\u0000-\u0020"'<>]/.test(value)) return false;
    return value.startsWith("https://") || value.startsWith("asset://") || value.startsWith("tauri://") || value.startsWith("http://localhost/") || value.startsWith("http://tauri.localhost/") || !value.startsWith("//") && !value.includes(":") && !value.split("/").includes("..");
  }
  function applyStyleOperation(operation, reverse = false) {
    if (operation.operation === "set_responsive_style") {
      if (!ALLOWED_PROPERTIES.has(operation.property) || !["phone", "tablet", "desktop"].includes(operation.breakpoint)) return false;
      const value = reverse ? operation.before : operation.after;
      if (value !== null && (value.length > 256 || /[{};]/.test(value))) return false;
      if (value !== null) {
        const probe = document.createElement("div").style;
        probe.setProperty(operation.property, value);
        if (!probe.getPropertyValue(operation.property)) return false;
      }
      const target2 = targetForIdentity(operation.identity);
      if (!target2) return false;
      const identity = operation.identity;
      let selector;
      let selectorKey;
      if (identity.inspector_id) {
        selector = `[data-inspector-id="${identity.inspector_id.replace(/[\\"']/g, "\\$&")}"]`;
        selectorKey = `inspector:${identity.inspector_id}`;
      } else if (identity.html_id) {
        selector = `#${CSS.escape(identity.html_id)}`;
        selectorKey = `id:${identity.html_id}`;
      } else if (identity.generated_id) {
        target2.setAttribute("data-hardlyui-id", identity.generated_id);
        selector = `[data-hardlyui-id="${identity.generated_id}"]`;
        selectorKey = `generated:${identity.generated_id}`;
      } else if (identity.semantic_selector) {
        selector = identity.semantic_selector;
        selectorKey = `selector:${identity.semantic_selector}`;
      } else return false;
      const key = `${selectorKey}\0${operation.breakpoint}\0${operation.property}`;
      if (value === null) responsiveStyleRules.delete(key);
      else responsiveStyleRules.set(key, { selector, property: operation.property, breakpoint: operation.breakpoint, value });
      let style = document.querySelector("style[data-hardlyui-responsive-edits]");
      if (!style) {
        style = document.createElement("style");
        style.setAttribute("data-hardlyui-responsive-edits", "");
        (document.head ?? document.documentElement).append(style);
      }
      const groups = /* @__PURE__ */ new Map();
      for (const rule of responsiveStyleRules.values()) {
        const key2 = `${rule.breakpoint}\0${rule.selector}`;
        groups.set(key2, [...groups.get(key2) ?? [], rule]);
      }
      style.textContent = [...groups.entries()].map(([key2, rules]) => {
        const breakpoint = key2.split("\0", 1)[0];
        const media = breakpoint === "phone" ? "(max-width: 600px)" : breakpoint === "tablet" ? "(min-width: 601px) and (max-width: 1024px)" : "(min-width: 1025px)";
        return `@media ${media}{${rules[0].selector}{${rules.map((rule) => `${rule.property}:${rule.value} !important`).join(";")}}}`;
      }).join("\n");
      return true;
    }
    if (operation.operation === "set_style") {
      if (!ALLOWED_PROPERTIES.has(operation.property)) return false;
      const value = reverse ? operation.before : operation.after;
      if (value !== null && (value.length > 256 || /[{};]/.test(value))) return false;
      if (value !== null) {
        const probe = document.createElement("div").style;
        probe.setProperty(operation.property, value);
        if (!probe.getPropertyValue(operation.property)) return false;
      }
      const target2 = targetForIdentity(operation.identity);
      if (!target2) return false;
      if (value === null) target2.style.removeProperty(operation.property);
      else target2.style.setProperty(operation.property, value);
      return true;
    }
    if (operation.operation === "set_text") {
      const value = reverse ? operation.before : operation.after;
      if (value.length > 5e3 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) return false;
      const target2 = targetForIdentity(operation.identity);
      if (!target2) return false;
      const node = ownTextNodes(target2)[operation.text_index ?? 0];
      if (!node) return false;
      if (node.data !== value) node.data = value;
      return true;
    }
    if (operation.operation === "set_attribute") {
      if (operation.name !== "data-hardlyui-name") return false;
      const value = reverse ? operation.before : operation.after;
      if (value !== null && (value.length > 80 || /[\u0000-\u001f\u007f]/.test(value))) return false;
      const target2 = targetForIdentity(operation.identity);
      if (!target2) return false;
      if (value === null) target2.removeAttribute(operation.name);
      else target2.setAttribute(operation.name, value);
      return true;
    }
    if (operation.operation === "set_text_binding") {
      const target2 = targetForIdentity(operation.identity);
      if (!target2 || target2.children.length > 0) return false;
      const sourceIdentity = reverse ? operation.before : operation.after;
      if (!sourceIdentity) {
        target2.removeAttribute(TEXT_BINDING_ATTRIBUTE);
        if (reverse && target2.textContent !== operation.before_text) target2.textContent = operation.before_text;
        installTextBindingObserver();
        return true;
      }
      const source = targetForIdentity(sourceIdentity);
      if (!source || sourceWouldCycle(target2, source)) return false;
      target2.setAttribute(TEXT_BINDING_ATTRIBUTE, JSON.stringify(sourceIdentity));
      installTextBindingObserver();
      return true;
    }
    if (operation.operation === "insert_element") {
      const existing = targetForIdentity(operation.identity);
      if (reverse) {
        existing?.remove();
        return Boolean(existing);
      }
      if (existing) return true;
      const parent2 = targetForIdentity(operation.parent);
      if (!parent2) return false;
      if (operation.tag === "img" && !operation.image_url) return false;
      if (operation.image_url && !safeArtworkUrl(operation.image_url)) return false;
      const element2 = document.createElement(operation.tag);
      for (const className of operation.class_names ?? []) {
        if (!/^[\w:/\[\].#%-]{1,128}$/.test(className)) return false;
        element2.classList.add(className);
      }
      if (operation.identity.generated_id) {
        element2.setAttribute("data-hardlyui-id", operation.identity.generated_id);
      }
      if (operation.slot_name) {
        if (!/^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(operation.slot_name)) return false;
        element2.setAttribute("data-hardlyui-slot", operation.slot_name);
      }
      if (operation.tag === "img" && operation.image_url) {
        element2.setAttribute("src", operation.image_url);
        element2.setAttribute("alt", operation.text);
      }
      if (operation.tag !== "img") element2.textContent = operation.text;
      parent2.appendChild(element2);
      return true;
    }
    if (operation.operation === "move_element") {
      const target2 = targetForIdentity(operation.identity);
      const parent2 = targetForIdentity(reverse ? operation.before_parent : operation.after_parent);
      const position = reverse ? operation.before_position : operation.after_position;
      if (!target2 || !parent2 || target2 === parent2 || target2.contains(parent2)) return false;
      const siblings = Array.from(parent2.children).filter((child) => child !== target2);
      const anchor2 = siblings[Math.max(0, position)] ?? null;
      parent2.insertBefore(target2, anchor2);
      return true;
    }
    const target = targetForIdentity(operation.identity);
    if (!reverse) {
      if (!target) return true;
      target.remove();
      return true;
    }
    if (target) return true;
    const parent = targetForIdentity(operation.parent);
    if (!parent || operation.outer_html.length > 1e5) return false;
    const template = document.createElement("template");
    template.innerHTML = operation.outer_html;
    const element = template.content.firstElementChild;
    if (!element) return false;
    const anchor = parent.children.item(Math.max(0, operation.position));
    parent.insertBefore(element, anchor);
    return true;
  }

  // src/component-drop.ts
  var COMPONENT_DRAG_TYPE = "application/x-hardlyui-component+json";
  var MAX_COMPONENT_STYLES = 40;
  var ALLOWED_STYLES = /* @__PURE__ */ new Set([
    "width",
    "height",
    "display",
    "flex-direction",
    "flex-wrap",
    "flex-grow",
    "flex-shrink",
    "flex-basis",
    "grid-template-columns",
    "order",
    "align-items",
    "justify-content",
    "align-self",
    "min-width",
    "max-width",
    "min-height",
    "max-height",
    "border-width",
    "border-color",
    "gap",
    "translate",
    "padding",
    "margin",
    "color",
    "background-color",
    "font-size",
    "font-weight",
    "line-height",
    "border-radius"
  ]);
  function validNode(value, depth, count) {
    if (!value || typeof value !== "object" || depth > 12 || ++count.value > 100) return false;
    const node = value;
    if (!["div", "p", "span", "button", "img"].includes(node.tag ?? "") || typeof node.text !== "string" || node.text.length > 500) return false;
    if (node.tag === "img" && (typeof node.image_url !== "string" || !safeArtworkUrl2(node.image_url))) return false;
    if (!Array.isArray(node.class_names) || node.class_names.length > 32 || node.class_names.some((name) => typeof name !== "string" || !/^[\w:/\[\].#%-]{1,128}$/.test(name))) return false;
    if (node.slot_name != null && (typeof node.slot_name !== "string" || !/^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(node.slot_name))) return false;
    if (!Array.isArray(node.styles) || node.styles.length > MAX_COMPONENT_STYLES || node.styles.some((entry) => !Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string" || !ALLOWED_STYLES.has(entry[0]) || typeof entry[1] !== "string" || !entry[1].length || entry[1].length > 256 || /[{};]/.test(entry[1]))) return false;
    if (!Array.isArray(node.children) || node.children.length > 50) return false;
    return node.children.every((child) => validNode(child, depth + 1, count));
  }
  function safeArtworkUrl2(value) {
    if (!value || value.length > 2048 || /[\u0000-\u0020"'<>]/.test(value)) return false;
    return value.startsWith("https://") || value.startsWith("asset://") || value.startsWith("tauri://") || value.startsWith("http://localhost/") || value.startsWith("http://tauri.localhost/") || !value.startsWith("//") && !value.includes(":") && !value.split("/").includes("..");
  }
  function isDroppableComponent(value) {
    if (!value || typeof value !== "object") return false;
    const component = value;
    return typeof component.id === "string" && component.id.length <= 80 && typeof component.name === "string" && component.name.length <= 64 && validNode(component, 0, { value: 0 });
  }
  function identityForElement(element, webviewId2, inserted = false) {
    const htmlId = element.id || null;
    const inspectorId = element.getAttribute("data-inspector-id");
    return {
      webview_id: webviewId2,
      inspector_id: inspectorId,
      html_id: htmlId,
      semantic_selector: buildDomPath(element),
      generated_id: inserted ? `hardlyui-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}` : element.getAttribute("data-hardlyui-id")
    };
  }
  function buildDropOperations(component, parent, textOverride = component.text) {
    const operations = [];
    const appendNode = (node, parentIdentity, root = false) => {
      const identity = {
        webview_id: parentIdentity.webview_id,
        inspector_id: null,
        html_id: null,
        semantic_selector: null,
        generated_id: `hardlyui-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`
      };
      operations.push({
        operation: "insert_element",
        identity,
        parent: parentIdentity,
        tag: node.tag,
        text: root ? textOverride.slice(0, 500) : node.text,
        class_names: node.class_names,
        slot_name: node.slot_name ?? null,
        image_url: node.image_url ?? null
      });
      for (const [property, after] of node.styles) {
        operations.push({ operation: "set_style", identity, property, before: null, after });
      }
      node.children.forEach((child) => appendNode(child, identity));
    };
    appendNode(component, parent, true);
    return operations;
  }
  function installComponentDrop(webviewId2) {
    let highlighted = null;
    let previousOutline = "";
    const clearHighlight = () => {
      if (highlighted) highlighted.style.outline = previousOutline;
      highlighted = null;
    };
    const dropTarget = (event) => {
      if (eventHitsInspectorUi(event) || !(event.target instanceof Element)) return null;
      return event.target.closest("[data-hardlyui-slot]") ?? event.target.closest("body *");
    };
    const onDragOver = (event) => {
      if (!Array.from(event.dataTransfer?.types ?? []).includes(COMPONENT_DRAG_TYPE)) return;
      const target = dropTarget(event);
      if (!target) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      if (highlighted !== target) {
        clearHighlight();
        highlighted = target;
        previousOutline = target.style.outline;
        target.style.outline = target.hasAttribute("data-hardlyui-slot") ? "2px solid #a371f7" : "2px solid #58a6ff";
      }
    };
    const onDragLeave = (event) => {
      if (event.relatedTarget instanceof Node && highlighted?.contains(event.relatedTarget)) return;
      clearHighlight();
    };
    const onDrop = (event) => {
      if (!Array.from(event.dataTransfer?.types ?? []).includes(COMPONENT_DRAG_TYPE)) return;
      const target = dropTarget(event);
      clearHighlight();
      if (!target || !event.dataTransfer) return;
      event.preventDefault();
      try {
        const component = JSON.parse(event.dataTransfer.getData(COMPONENT_DRAG_TYPE));
        if (!isDroppableComponent(component)) return;
        const transaction = {
          id: globalThis.crypto?.randomUUID?.() ?? `drop-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          label: `Insert ${component.name}`,
          operations: buildDropOperations(component, identityForElement(target, webviewId2))
        };
        void invoke("plugin:visual-editor|commit_edit", { transaction });
      } catch {
      }
    };
    document.addEventListener("dragover", onDragOver, true);
    document.addEventListener("dragleave", onDragLeave, true);
    document.addEventListener("drop", onDrop, true);
    return () => {
      clearHighlight();
      document.removeEventListener("dragover", onDragOver, true);
      document.removeEventListener("dragleave", onDragLeave, true);
      document.removeEventListener("drop", onDrop, true);
    };
  }

  // src/guest-runtime.ts
  var engine = null;
  var toolbar = null;
  var persistedEditObserver = null;
  var persistedEditGeneration = 0;
  var removeComponentDrop = null;
  var webviewId = null;
  async function reportSelection(snapshot, action) {
    await invoke("plugin:visual-editor|report_selection", { snapshot, action });
  }
  async function notifyNavigation(id) {
    await invoke("plugin:visual-editor|notify_navigation", { webviewId: id });
  }
  function ensureEngine() {
    if (engine) return engine;
    if (!webviewId) return null;
    removeComponentDrop?.();
    removeComponentDrop = installComponentDrop(webviewId);
    engine = new SelectionEngine({
      webviewId,
      reportSelection,
      onNavigation: (id) => {
        void notifyNavigation(id).catch(() => void 0);
      }
    });
    return engine;
  }
  var runtime = window.__VISUAL_EDITOR_GUEST__ ?? {
    version: "0.1.0",
    activate(id) {
      webviewId = id;
      ensureEngine()?.activate();
    },
    deactivate() {
      engine?.destroy();
      engine = null;
      removeComponentDrop?.();
      removeComponentDrop = null;
    },
    configure(options) {
      engine?.configure(options);
    },
    async openToolbar(id) {
      if (id) webviewId = id;
      if (!toolbar) {
        toolbar = new InspectorToolbar({
          onPickerChange: (enabled) => {
            if (enabled) {
              ensureEngine()?.activate();
            } else {
              engine?.deactivate();
            }
          },
          onChipFocus: (element) => {
            engine?.highlightElement(element);
          }
        });
      }
      await toolbar.open();
    },
    closeToolbar() {
      toolbar?.close();
    },
    async selectElement(selector) {
      if (!engine) throw new Error("Enable the visual editor before navigating the element tree");
      await engine.selectElement(selector);
    },
    applyStyleOperation,
    applyPersistedOperations(operations) {
      const generation = ++persistedEditGeneration;
      let attempts = 0;
      const replay = () => {
        if (generation !== persistedEditGeneration) return;
        const pending = operations.filter((operation) => !applyStyleOperation(operation));
        if (pending.length && attempts++ < 40) {
          window.setTimeout(replay, 150);
        }
      };
      persistedEditObserver?.disconnect();
      if (document.documentElement) {
        persistedEditObserver = new MutationObserver(() => queueMicrotask(replay));
        persistedEditObserver.observe(document.documentElement, { childList: true, subtree: true });
      }
      replay();
    }
  };
  window.__VISUAL_EDITOR_GUEST__ = runtime;
  window.__VISUAL_EDITOR_SUSPEND_CAPTURE_UI__ = suspendCaptureUi;
  window.__VISUAL_EDITOR_RESUME_CAPTURE_UI__ = resumeCaptureUi;
  var guest_runtime_default = runtime;
})();
