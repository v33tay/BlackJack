(() => {
  "use strict";

  const EDITOR_ID = "visual-editor";
  const STYLE_ID = "visual-editor-style";
  const STORAGE_KEY = "blackjack.visual-editor:" + location.pathname;

  const FIELDS = [
    { key: "width", label: "Ширина", length: true },
    { key: "height", label: "Высота", length: true },
    { key: "padding", label: "Отступ внутри", length: true },
    { key: "margin", label: "Отступ снаружи", length: true },
    { key: "gap", label: "Промежуток", length: true },
    { key: "font-size", label: "Размер шрифта", length: true },
    { key: "font-weight", label: "Насыщенность" },
    { key: "line-height", label: "Высота строки" },
    { key: "color", label: "Цвет текста", type: "color" },
    { key: "background-color", label: "Фон", type: "color" },
    { key: "border-radius", label: "Скругление", length: true },
    { key: "border-width", label: "Толщина рамки", length: true },
    { key: "border-color", label: "Цвет рамки", type: "color" },
    { key: "border-style", label: "Стиль рамки", type: "select", options: ["none", "solid", "dashed", "dotted", "double"] },
    { key: "opacity", label: "Прозрачность", type: "range", min: 0, max: 1, step: 0.05 },
    { key: "text-align", label: "Выравнивание", type: "select", options: ["start", "left", "center", "right", "justify"] },
    { key: "display", label: "Отображение", type: "select", options: ["block", "flex", "grid", "inline", "inline-flex", "none"] }
  ];

  const LENGTH_KEYS = new Set(FIELDS.filter((field) => field.length).map((field) => field.key));
  const originalStyles = new WeakMap();

  let root = null;
  let panel = null;
  let fieldsHost = null;
  let targetLabel = null;
  let statusLabel = null;
  let launcherButton = null;
  let editMode = false;
  let collapsed = false;
  let selected = null;
  let hovered = null;
  let saveTimer = null;
  let suspended = false;

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function injectStyles() {
    if (document.querySelector("#" + STYLE_ID)) return;
    const style = element("style");
    style.id = STYLE_ID;
    style.textContent = `
      #visual-editor .ve-launcher {
        position: fixed;
        top: 50%;
        right: 0;
        z-index: 2147483000;
        padding: 13px 5px;
        border: 1px solid rgba(226, 194, 123, .38);
        border-right: 0;
        border-radius: 10px 0 0 10px;
        background: rgba(13, 41, 31, .94);
        box-shadow: -8px 0 22px rgba(0, 0, 0, .3);
        color: var(--gold, #e2c27b);
        font: 700 11px/1 Inter, "Segoe UI", sans-serif;
        letter-spacing: .12em;
        text-transform: uppercase;
        writing-mode: vertical-rl;
        cursor: pointer;
      }

      #visual-editor .ve-launcher:hover {
        background: rgba(28, 70, 52, .98);
      }

      #visual-editor.ve-open:not(.ve-collapsed) .ve-launcher {
        display: none;
      }

      #visual-editor .ve-panel {
        position: fixed;
        top: 0;
        right: 0;
        bottom: 0;
        z-index: 2147483001;
        width: min(342px, 94vw);
        padding: 14px 14px 20px;
        overflow-y: auto;
        border-left: 1px solid rgba(226, 194, 123, .32);
        background: rgba(8, 27, 20, .97);
        box-shadow: -24px 0 70px rgba(0, 0, 0, .5);
        color: #e8eee3;
        font: 12px/1.45 Inter, "Segoe UI", sans-serif;
        backdrop-filter: blur(8px);
      }

      #visual-editor .ve-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        margin-bottom: 6px;
      }

      #visual-editor .ve-head strong {
        color: var(--gold, #e2c27b);
        font-size: 13px;
        letter-spacing: .08em;
        text-transform: uppercase;
      }

      #visual-editor .ve-head-actions {
        display: flex;
        gap: 6px;
      }

      #visual-editor .ve-close {
        width: 28px;
        height: 28px;
        padding: 0;
        border: 1px solid rgba(226, 194, 123, .3);
        border-radius: 8px;
        background: rgba(255, 255, 255, .04);
        color: inherit;
        font: 18px/1 Inter, "Segoe UI", sans-serif;
        cursor: pointer;
      }

      #visual-editor .ve-hint,
      #visual-editor .ve-note {
        margin: 0 0 12px;
        color: #93a89a;
        font-size: 11px;
      }

      #visual-editor .ve-note {
        margin: 12px 0 0;
      }

      #visual-editor .ve-status {
        min-height: 18px;
        margin: 8px 0 0;
        color: #79d39b;
        font-size: 11px;
      }

      #visual-editor .ve-target {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        margin: 0 0 10px;
        padding: 8px 10px;
        border: 1px solid rgba(121, 211, 155, .22);
        border-radius: 9px;
        background: rgba(121, 211, 155, .07);
      }

      #visual-editor .ve-target code {
        flex: 1 1 100%;
        overflow-wrap: anywhere;
        color: #cfe4d4;
        font: 11px/1.3 Consolas, monospace;
      }

      #visual-editor .ve-parent {
        flex: 0 0 auto;
        padding: 4px 8px;
        border: 1px solid rgba(226, 194, 123, .26);
        border-radius: 7px;
        background: transparent;
        color: var(--gold, #e2c27b);
        font: inherit;
        font-size: 10px;
        cursor: pointer;
      }

      #visual-editor .ve-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 148px;
        align-items: center;
        gap: 8px;
        margin: 6px 0;
      }

      #visual-editor .ve-name {
        color: #a7b9ab;
        font-size: 11px;
      }

      #visual-editor .ve-row input[type="text"],
      #visual-editor .ve-row select {
        width: 100%;
        min-height: 28px;
        padding: 4px 7px;
        border: 1px solid rgba(226, 194, 123, .24);
        border-radius: 7px;
        background: rgba(255, 255, 255, .05);
        color: #f2f4ea;
        font: inherit;
      }

      #visual-editor .ve-row input[type="text"]::placeholder {
        color: #7d9285;
      }

      #visual-editor .ve-row select option {
        background: #0c2a1f;
      }

      #visual-editor .ve-row input[type="color"] {
        width: 36px;
        height: 28px;
        padding: 2px;
        border: 1px solid rgba(226, 194, 123, .24);
        border-radius: 7px;
        background: rgba(255, 255, 255, .05);
        cursor: pointer;
      }

      #visual-editor .ve-row input[type="range"] {
        width: 100%;
        accent-color: #e2c27b;
      }

      #visual-editor .ve-row output {
        color: var(--gold, #e2c27b);
        font: 11px/1 Consolas, monospace;
        text-align: right;
      }

      #visual-editor .ve-color-wrap {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 6px;
      }

      #visual-editor .ve-clear {
        width: 26px;
        height: 26px;
        padding: 0;
        border: 1px solid rgba(226, 194, 123, .24);
        border-radius: 7px;
        background: transparent;
        color: #c6d4c9;
        font: 14px/1 Inter, sans-serif;
        cursor: pointer;
      }

      #visual-editor .ve-actions {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
        margin-top: 14px;
      }

      #visual-editor .ve-actions button {
        min-height: 32px;
        padding: 6px 8px;
        border: 1px solid rgba(226, 194, 123, .3);
        border-radius: 8px;
        background: rgba(226, 194, 123, .08);
        color: #f0e6cc;
        font: 11px/1.3 Inter, "Segoe UI", sans-serif;
        cursor: pointer;
      }

      #visual-editor .ve-actions button:hover {
        background: rgba(226, 194, 123, .18);
      }

      #visual-editor .ve-actions button[data-act="export"] {
        grid-column: 1 / -1;
        background: linear-gradient(150deg, #f0d79a, #c9a15c);
        color: #17251a;
        font-weight: 700;
      }

      .ve-hover {
        outline: 1px dashed rgba(226, 194, 123, .9) !important;
        outline-offset: -1px !important;
        cursor: crosshair !important;
      }

      .ve-selected {
        outline: 2px solid #e2c27b !important;
        outline-offset: -2px !important;
      }

      .ve-text-editing {
        outline: 2px solid #79d39b !important;
        cursor: text !important;
      }
    `;
    document.head.append(style);
  }

  function build() {
    if (document.querySelector("#" + EDITOR_ID)) return;
    injectStyles();

    root = element("div");
    root.id = EDITOR_ID;

    const launcher = element("button", "ve-launcher", "Правка");
    launcher.type = "button";
    launcher.title = "Включить визуальную правку макета";
    launcherButton = launcher;
    launcher.addEventListener("click", () => {
      if (!editMode) setEditMode(true);
      else setCollapsed(!collapsed);
    });

    panel = element("aside", "ve-panel");
    panel.hidden = true;

    const head = element("div", "ve-head");
    const title = element("strong", null, "Визуальная правка");
    const collapse = element("button", "ve-close", "›");
    collapse.type = "button";
    collapse.title = "Свернуть панель";
    collapse.setAttribute("aria-label", "Свернуть панель");
    collapse.addEventListener("click", () => setCollapsed(true));
    const close = element("button", "ve-close", "×");
    close.type = "button";
    close.setAttribute("aria-label", "Закрыть редактор");
    close.addEventListener("click", () => setEditMode(false));
    const headActions = element("div", "ve-head-actions");
    headActions.append(collapse, close);
    head.append(title, headActions);

    const hint = element("p", "ve-hint", "Клик — выбрать элемент, двойной клик — править текст. Панель сворачивается кнопкой ›, Esc — выйти.");

    const target = element("div", "ve-target");
    targetLabel = element("code", null, "Ничего не выбрано");
    const editText = element("button", "ve-parent", "Текст");
    editText.type = "button";
    editText.title = "Редактировать текст выбранного элемента";
    editText.addEventListener("click", () => {
      if (selected) startTextEditing(selected);
    });
    const parentButton = element("button", "ve-parent", "↑ родитель");
    parentButton.type = "button";
    parentButton.addEventListener("click", selectParent);
    target.append(targetLabel, editText, parentButton);

    fieldsHost = element("div", "ve-fields");

    const actions = element("div", "ve-actions");
    const resetElement = element("button", null, "Сбросить элемент");
    resetElement.type = "button";
    resetElement.dataset.act = "reset-element";
    const resetAll = element("button", null, "Сбросить всё");
    resetAll.type = "button";
    resetAll.dataset.act = "reset-all";
    const exportButton = element("button", null, "Сохранить HTML…");
    exportButton.type = "button";
    exportButton.dataset.act = "export";
    actions.append(resetElement, resetAll, exportButton);
    actions.addEventListener("click", handleAction);

    const note = element("p", "ve-note", "Правки сохраняются в этом браузере. «Сохранить HTML» отдаёт макет с уже применёнными стилями.");
    statusLabel = element("p", "ve-status");
    statusLabel.setAttribute("role", "status");

    panel.append(head, hint, target, fieldsHost, actions, statusLabel, note);
    root.append(launcher, panel);
    document.body.append(root);
  }

  function setEditMode(on) {
    editMode = Boolean(on);
    collapsed = false;
    root.classList.toggle("ve-open", editMode);
    root.classList.remove("ve-collapsed");
    panel.hidden = !editMode;
    if (launcherButton) launcherButton.textContent = "Правка";
    if (!editMode) {
      stopTextEditing();
      clearHighlights();
      scheduleSave();
    }
  }

  function setCollapsed(on) {
    collapsed = Boolean(on) && editMode;
    root.classList.toggle("ve-collapsed", collapsed);
    panel.hidden = !editMode || collapsed;
    if (launcherButton) launcherButton.textContent = collapsed ? "Панель" : "Правка";
  }

  function clearHighlights() {
    if (hovered) hovered.classList.remove("ve-hover");
    if (selected) selected.classList.remove("ve-selected");
    hovered = null;
    selected = null;
    fieldsHost.replaceChildren();
    targetLabel.textContent = "Ничего не выбрано";
  }

  function stopTextEditing() {
    document.querySelectorAll('[contenteditable="true"]').forEach((node) => {
      if (node.closest("#" + EDITOR_ID)) return;
      node.removeAttribute("contenteditable");
      node.classList.remove("ve-text-editing");
    });
  }

  function select(node) {
    if (!node || !(node instanceof Element)) return;
    if (node.closest("#" + EDITOR_ID) || node === document.documentElement) return;
    if (selected === node) return;
    if (selected) selected.classList.remove("ve-selected");
    if (!originalStyles.has(node)) originalStyles.set(node, node.getAttribute("style") || "");
    selected = node;
    selected.classList.add("ve-selected");
    targetLabel.textContent = describe(node);
    renderFields();
    if (collapsed) setCollapsed(false);
  }

  function selectParent() {
    if (!selected || !selected.parentElement) return;
    select(selected.parentElement);
  }

  function describe(node) {
    let label = node.tagName.toLowerCase();
    if (node.id) label += "#" + node.id;
    const classes = [...node.classList].filter((name) => !name.startsWith("ve-")).slice(0, 2);
    if (classes.length) label += "." + classes.join(".");
    return label;
  }

  function rgbToHex(value) {
    const match = String(value || "").match(/rgba?\(([^)]+)\)/i);
    if (!match) return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value) ? value : null;
    const parts = match[1].split(",").map((part) => Number(part.trim()));
    if (parts.length > 3 && parts[3] === 0) return null;
    return "#" + parts.slice(0, 3).map((part) => Math.round(part).toString(16).padStart(2, "0")).join("");
  }

  function normalizeValue(key, value) {
    if (!value) return value;
    if (!LENGTH_KEYS.has(key)) return value;
    if (/^-?[\d.\s]+$/.test(value)) {
      return value.split(/\s+/).map((part) => part + "px").join(" ");
    }
    return value;
  }

  function applyStyle(key, rawValue) {
    if (!selected) return;
    const value = normalizeValue(key, rawValue);
    if (value) selected.style.setProperty(key, value);
    else selected.style.removeProperty(key);
    scheduleSave();
  }

  function renderFields() {
    fieldsHost.replaceChildren();
    if (!selected) return;
    const computed = getComputedStyle(selected);

    for (const field of FIELDS) {
      const row = element("label", "ve-row");
      const name = element("span", "ve-name", field.label);
      row.append(name);

      if (field.type === "select") {
        const control = element("select");
        for (const option of field.options) control.add(new Option(option, option));
        const current = computed.getPropertyValue(field.key).trim();
        if (current && ![...control.options].some((option) => option.value === current)) {
          control.add(new Option(current, current));
        }
        control.value = current || field.options[0];
        control.addEventListener("change", () => applyStyle(field.key, control.value));
        row.append(control);
      } else if (field.type === "color") {
        const wrap = element("span", "ve-color-wrap");
        const control = element("input");
        control.type = "color";
        control.value = rgbToHex(computed.getPropertyValue(field.key)) || "#000000";
        control.addEventListener("input", () => applyStyle(field.key, control.value));
        const clear = element("button", "ve-clear", "×");
        clear.type = "button";
        clear.title = "Вернуть значение из стилей";
        clear.addEventListener("click", () => {
          if (!selected) return;
          selected.style.removeProperty(field.key);
          renderFields();
          scheduleSave();
        });
        wrap.append(control, clear);
        row.append(wrap);
      } else if (field.type === "range") {
        const control = element("input");
        control.type = "range";
        control.min = String(field.min);
        control.max = String(field.max);
        control.step = String(field.step);
        control.value = computed.getPropertyValue(field.key) || "1";
        const output = element("output", null, Number(control.value).toFixed(2));
        control.addEventListener("input", () => {
          output.textContent = Number(control.value).toFixed(2);
          applyStyle(field.key, control.value);
        });
        const wrap = element("span", "ve-color-wrap");
        wrap.append(control, output);
        row.append(wrap);
      } else {
        const control = element("input");
        control.type = "text";
        control.value = selected.style.getPropertyValue(field.key);
        control.placeholder = computed.getPropertyValue(field.key) || "auto";
        control.addEventListener("change", () => {
          applyStyle(field.key, control.value.trim());
          control.value = selected.style.getPropertyValue(field.key);
        });
        row.append(control);
      }

      fieldsHost.append(row);
    }
  }

  function handleAction(event) {
    const button = event.target.closest("button[data-act]");
    if (!button) return;
    const action = button.dataset.act;

    if (action === "reset-element" && selected) {
      const original = originalStyles.get(selected) || "";
      if (original) selected.setAttribute("style", original);
      else selected.removeAttribute("style");
      renderFields();
      scheduleSave();
      return;
    }

    if (action === "reset-all") {
      suspended = true;
      window.clearTimeout(saveTimer);
      saveTimer = null;
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch (error) {
        void error;
      }
      location.reload();
      return;
    }

    if (action === "export") exportHTML();
  }

  function snapshot() {
    const clone = document.body.cloneNode(true);
    const editor = clone.querySelector("#" + EDITOR_ID);
    if (editor) editor.remove();
    clone.querySelectorAll("[contenteditable]").forEach((node) => node.removeAttribute("contenteditable"));
    clone.querySelectorAll(".ve-hover, .ve-selected, .ve-text-editing").forEach((node) => {
      node.classList.remove("ve-hover", "ve-selected", "ve-text-editing");
    });
    return clone.innerHTML;
  }

  function scheduleSave() {
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(saveNow, 250);
  }

  function saveNow() {
    window.clearTimeout(saveTimer);
    saveTimer = null;
    if (suspended) return;
    try {
      localStorage.setItem(STORAGE_KEY, snapshot());
    } catch (error) {
      void error;
    }
  }

  function setStatus(message) {
    if (statusLabel) statusLabel.textContent = message;
  }

  function exportFilename() {
    const base = location.pathname.split("/").pop() || "preview.html";
    return base.replace(/\.html?$/i, "") + "-edited.html";
  }

  function exportMarkup() {
    const clone = document.documentElement.cloneNode(true);
    clone.querySelector("#" + EDITOR_ID)?.remove();
    clone.querySelector("#" + STYLE_ID)?.remove();
    clone.querySelectorAll("[contenteditable]").forEach((node) => node.removeAttribute("contenteditable"));
    clone.querySelectorAll(".ve-hover, .ve-selected, .ve-text-editing").forEach((node) => {
      node.classList.remove("ve-hover", "ve-selected", "ve-text-editing");
    });
    return "<!doctype html>\n" + clone.outerHTML;
  }

  function downloadMarkup(html, filename) {
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  async function exportHTML() {
    saveNow();
    const html = exportMarkup();
    const filename = exportFilename();
    setStatus("Сохраняю…");

    if (typeof window.showSaveFilePicker === "function") {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: filename,
          types: [{ description: "HTML", accept: { "text/html": [".html"] } }]
        });
        const writable = await handle.createWritable();
        await writable.write(html);
        await writable.close();
        setStatus("Файл сохранён.");
        return;
      } catch (error) {
        if (error && error.name === "AbortError") {
          setStatus("Сохранение отменено.");
          return;
        }
      }
    }

    downloadMarkup(html, filename);
    setStatus("Файл скачан в папку загрузок.");
  }

  const STRUCTURAL_TAGS = new Set(["BODY", "MAIN", "HEADER", "FOOTER", "SECTION", "NAV", "ARTICLE", "FORM"]);

  function canEditText(node) {
    if (!(node instanceof Element)) return false;
    if (STRUCTURAL_TAGS.has(node.tagName)) return false;
    return node.textContent.trim().length > 0;
  }

  function startTextEditing(node) {
    if (!canEditText(node)) return;
    if (node.closest("#" + EDITOR_ID) || node === document.documentElement) return;
    select(node);
    node.setAttribute("contenteditable", "true");
    node.classList.add("ve-text-editing");
    node.focus();
    const range = document.createRange();
    range.selectNodeContents(node);
    range.collapse(false);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }

  document.addEventListener("click", (event) => {
    if (!editMode) return;
    if (event.target.closest("#" + EDITOR_ID)) return;
    if (event.target.closest('[contenteditable="true"]')) return;
    event.preventDefault();
    event.stopPropagation();
    select(event.target);
  }, true);

  document.addEventListener("dblclick", (event) => {
    if (!editMode) return;
    if (event.target.closest("#" + EDITOR_ID)) return;
    if (event.target.closest('[contenteditable="true"]')) return;
    if (!canEditText(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
    startTextEditing(event.target);
  }, true);

  document.addEventListener("mouseover", (event) => {
    if (!editMode) return;
    const node = event.target;
    if (!(node instanceof Element) || node === document.documentElement || node === document.body) return;
    if (node.closest("#" + EDITOR_ID) || node === hovered) return;
    if (hovered) hovered.classList.remove("ve-hover");
    hovered = node;
    hovered.classList.add("ve-hover");
  }, true);

  document.addEventListener("focusout", (event) => {
    const node = event.target;
    if (!(node instanceof Element) || !node.hasAttribute("contenteditable")) return;
    if (node.closest("#" + EDITOR_ID)) return;
    node.removeAttribute("contenteditable");
    node.classList.remove("ve-text-editing");
    scheduleSave();
  }, true);

  document.addEventListener("keydown", (event) => {
    const node = event.target;
    if (node instanceof Element && node.hasAttribute("contenteditable")) {
      if (event.key === "Enter") {
        event.preventDefault();
        node.blur();
      }
      return;
    }
    if (event.key === "Escape" && editMode) setEditMode(false);
  }, true);

  window.addEventListener("beforeunload", saveNow);

  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) document.body.innerHTML = saved;
  } catch (error) {
    void error;
  }

  build();
})();
