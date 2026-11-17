/* V2.9.10 — expose existing editor commands without changing stored HTML or review logic. */
(() => {
  'use strict';
  const VERSION = '2.9.10';
  const ranges = new WeakMap();
  let applying = false;
  let settleTimer = null;
  const shellFor = editor => editor?.closest('.rich-editor-shell');
  const ownsRange = (editor, range) => Boolean(editor?.isConnected && range &&
    editor.contains(range.startContainer) && editor.contains(range.endContainer));

  function remember(editor) {
    const selection = window.getSelection();
    if (!selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (ownsRange(editor, range)) ranges.set(editor, range.cloneRange());
  }

  function restore(editor) {
    remember(editor);
    let range = ranges.get(editor);
    if (!ownsRange(editor, range)) {
      range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
    }
    editor.focus({ preventScroll: true });
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    // The existing app owns the actual commands and its own selection cache.
    // Synchronize it before its delegated click/change handler runs.
    document.dispatchEvent(new Event('selectionchange'));
  }

  function setSelectValue(select, value, label) {
    if (!select || document.activeElement === select) return;
    select.querySelectorAll('[data-quick-current]').forEach(option => option.remove());
    if (![...select.options].some(option => option.value === value)) {
      const option = new Option(label, value);
      option.dataset.quickCurrent = 'true';
      // Display the current computed value; it is not necessarily a supported saved format.
      option.disabled = true;
      select.appendChild(option);
    }
    select.value = value;
  }

  function refresh(editor) {
    const shell = shellFor(editor);
    if (!shell?.classList.contains('rich-quick') || applying) return;
    const selection = window.getSelection();
    const current = selection?.rangeCount ? selection.getRangeAt(0) : null;
    const range = ownsRange(editor, current) ? current : ranges.get(editor);
    let node = ownsRange(editor, range) ? range.startContainer : editor;
    if (ownsRange(editor, range) && !range.collapsed) {
      // app.js surrounds selected leaves with spans and selects their boundaries.
      // Read the first selected leaf, not its unformatted parent paragraph.
      const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const text = walker.currentNode;
        if (!text.data.length || !range.intersectsNode(text)) continue;
        const start = text === range.startContainer ? range.startOffset : 0;
        const end = text === range.endContainer ? range.endOffset : text.data.length;
        if (end > start) { node = text; break; }
      }
    } else if (ownsRange(editor, range) && node.nodeType === Node.ELEMENT_NODE) {
      const atEnd = range.startOffset >= node.childNodes.length;
      node = node.childNodes[range.startOffset] || node.lastChild || node;
      while (node.nodeType === Node.ELEMENT_NODE && node.childNodes.length) {
        node = atEnd ? node.lastChild : node.firstChild;
      }
    }
    if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
    const style = getComputedStyle(node instanceof Element ? node : editor);
    const size = parseFloat(style.fontSize) || 14;
    setSelectValue(shell.querySelector('[data-rich-format="font-size"]'), String(size), `${size}px`);
    const line = parseFloat(style.lineHeight);
    if (Number.isFinite(line)) {
      const ratio = Math.round(line / size * 100) / 100;
      setSelectValue(shell.querySelector('[data-rich-format="line-height"]'), String(ratio), `${Math.round(ratio * 100)}%`);
    }
    const status = shell.querySelector('[data-quick-status]');
    if (status) {
      const count = ownsRange(editor, range) && !range.collapsed ? range.toString().length : 0;
      const text = count ? `${count}자 선택 · 다시 드래그하지 않고 서식을 연속 적용하세요.` : '부분은 드래그 · 문단은 커서만 · 전체는 ‘이 칸 전체 선택’';
      if (status.textContent !== text) status.textContent = text;
    }
  }

  function group(label) {
    const element = document.createElement('div');
    element.className = 'rich-quick-group';
    element.setAttribute('role', 'group');
    element.setAttribute('aria-label', label);
    return element;
  }

  function icon(command) {
    const paths = {
      justifyLeft: '<path d="M4 5h16M4 10h10M4 15h16M4 20h10"/>',
      justifyCenter: '<path d="M4 5h16M7 10h10M4 15h16M7 20h10"/>',
      justifyRight: '<path d="M4 5h16M10 10h10M4 15h16M10 20h10"/>',
      insertUnorderedList: '<path d="M9 5h11M9 12h11M9 19h11"/><circle cx="4" cy="5" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="19" r="1"/>',
      insertOrderedList: '<path d="M10 6h10M10 18h10M3 3h2v7M3 10h4M3 15c0-3 5-3 4 0l-4 5h4"/>'
    };
    return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[command] || ''}</svg>`;
  }

  function enhance(shell) {
    if (shell.dataset.quickToolbar === VERSION) return;
    const toolbar = shell.querySelector('.rich-editor-toolbar');
    const editor = shell.querySelector('.rich-text-editor');
    const primary = shell.querySelector('.rich-primary-tools');
    const font = shell.querySelector('[data-rich-format="font-size"]');
    const line = shell.querySelector('[data-rich-format="line-height"]');
    const commands = ['bold', 'italic', 'underline', 'justifyLeft', 'justifyCenter', 'justifyRight', 'insertUnorderedList', 'insertOrderedList'];
    const buttons = commands.map(command => shell.querySelector(`[data-rich-command="${command}"]`));
    // Fail closed to the original editor if its markup changes in a later release.
    if (!toolbar || !editor || !primary || !font || !line || buttons.some(button => !button)) return;

    const quick = document.createElement('div');
    quick.className = 'rich-quick-toolbar';
    const textRow = document.createElement('div');
    textRow.className = 'rich-quick-row';
    const paragraphRow = document.createElement('div');
    paragraphRow.className = 'rich-quick-row';
    const textLabel = document.createElement('span');
    textLabel.className = 'rich-quick-label'; textLabel.textContent = '글자';
    const paragraphLabel = document.createElement('span');
    paragraphLabel.className = 'rich-quick-label'; paragraphLabel.textContent = '문단';
    const emphasis = group('글자 강조');
    const alignment = group('문단 정렬');
    const lists = group('글머리와 번호 목록');
    const spacing = document.createElement('label');
    spacing.className = 'rich-quick-spacing';
    const spacingText = document.createElement('span'); spacingText.textContent = '줄 간격';
    font.disabled = false; line.disabled = false;
    font.title = '글자 크기 (px)'; line.title = '줄 간격';
    font.classList.add('rich-quick-size'); line.classList.add('rich-quick-line-height');
    spacing.append(spacingText, line);
    buttons.forEach((button, index) => {
      button.disabled = false;
      button.classList.add('rich-quick-button');
      const label = button.getAttribute('aria-label');
      button.title = `${label}${index < 3 ? [' (Ctrl+B)', ' (Ctrl+I)', ' (Ctrl+U)'][index] : ''}`;
      if (index < 3) emphasis.appendChild(button);
      else {
        button.classList.add('rich-quick-icon-button');
        button.innerHTML = icon(commands[index]);
        (index < 6 ? alignment : lists).appendChild(button);
      }
    });
    textRow.append(textLabel, font, emphasis);
    paragraphRow.append(paragraphLabel, alignment, lists, spacing);
    quick.append(textRow, paragraphRow);
    toolbar.prepend(quick);
    // These controls were moved, not duplicated: the existing app handles them unchanged.
    ['text', 'paragraph'].forEach(kind => {
      const trigger = shell.querySelector(`[data-rich-menu-toggle="${kind}"]`);
      const panel = trigger && document.getElementById(trigger.getAttribute('aria-controls'));
      panel?.remove(); trigger?.remove();
    });
    const all = document.createElement('button');
    all.type = 'button'; all.className = 'rich-quick-select-all';
    all.dataset.quickSelectAll = editor.id;
    all.textContent = '이 칸 전체 선택';
    all.title = '이 입력칸의 내용만 선택한 다음 크기·굵게·정렬을 한 번에 바꿉니다.';
    all.setAttribute('aria-label', `${editor.getAttribute('aria-label') || '본문'} 전체 선택`);
    primary.prepend(all);
    const status = document.createElement('div');
    status.className = 'rich-quick-help'; status.dataset.quickStatus = '';
    status.id = `${editor.id}-quick-help`;
    editor.setAttribute('aria-describedby', [editor.getAttribute('aria-describedby'), status.id].filter(Boolean).join(' '));
    toolbar.after(status);
    shell.classList.add('rich-quick'); shell.dataset.quickToolbar = VERSION;
    refresh(editor);
  }

  function scan(root) {
    if (!(root instanceof Element)) return;
    if (root.matches('.rich-editor-shell')) enhance(root);
    root.querySelectorAll('.rich-editor-shell').forEach(enhance);
  }

  function controlEditor(control) {
    return shellFor(control)?.querySelector('.rich-text-editor');
  }

  document.addEventListener('pointerdown', event => {
    const control = event.target.closest?.('.rich-quick-toolbar button, .rich-quick-toolbar select, [data-quick-select-all]');
    if (control) remember(controlEditor(control));
  }, true);

  function prepare(event) {
    const control = event.target.closest?.('.rich-quick-toolbar [data-rich-command], .rich-quick-toolbar [data-rich-format]');
    if (!control || control.disabled) return;
    if (event.type === 'click' && control.matches('select')) return;
    const editor = controlEditor(control);
    if (!editor) return;
    // Do not let selectionchange reset a native select's newly chosen value before app.js reads it.
    applying = true;
    restore(editor);
    // A native event can run microtasks between listeners. Wait for a later task,
    // otherwise the select can revert before app.js reads its new value.
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => { applying = false; remember(editor); refresh(editor); }, 0);
  }
  document.addEventListener('click', event => {
    const button = event.target.closest?.('[data-quick-select-all]');
    if (!button) { prepare(event); return; }
    const editor = controlEditor(button);
    if (!editor) return;
    event.preventDefault();
    editor.focus({ preventScroll: true });
    const range = document.createRange(); range.selectNodeContents(editor);
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    remember(editor);
    document.dispatchEvent(new Event('selectionchange'));
    refresh(editor);
  }, true);
  document.addEventListener('change', prepare, true);
  document.addEventListener('mousedown', event => {
    if (event.target.closest?.('[data-quick-select-all]')) event.preventDefault();
  });
  document.addEventListener('selectionchange', () => {
    const selection = window.getSelection();
    let node = selection?.anchorNode;
    if (node?.nodeType === Node.TEXT_NODE) node = node.parentElement;
    const editor = node?.closest?.('.rich-text-editor');
    if (editor) { remember(editor); refresh(editor); }
  });
  document.addEventListener('input', event => {
    const editor = event.target.closest?.('.rich-text-editor');
    if (editor && !event.isComposing) { remember(editor); refresh(editor); }
  });
  document.addEventListener('compositionend', event => {
    const editor = event.target.closest?.('.rich-text-editor');
    if (editor) { remember(editor); refresh(editor); }
  });
  const root = document.getElementById('app');
  if (root) {
    scan(root);
    new MutationObserver(records => {
      for (const record of records) for (const node of record.addedNodes) scan(node);
    }).observe(root, { childList: true, subtree: true });
  }
})();
