// ==UserScript==
// @name         Google AI Studio — Always Show Delete
// @namespace    local.codex
// @version      1.1.1
// @description  Replaces response feedback buttons with a persistent Delete button and adds one to every chat turn.
// @match        https://aistudio.google.com/*
// @updateURL    https://raw.githubusercontent.com/dominikmessner/userscripts/main/google-ai-studio-always-show-delete.user.js
// @downloadURL  https://raw.githubusercontent.com/dominikmessner/userscripts/main/google-ai-studio-always-show-delete.user.js
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  const BUTTON_CLASS = 'ais-always-delete-button';
  const FOOTER_CLASS = 'ais-always-delete-footer';

  const style = document.createElement('style');
  style.textContent = `
    /* The replacement makes AI Studio's response-rating controls unnecessary. */
    ms-chat-turn:has(.${BUTTON_CLASS}) .turn-footer > .response-feedback-button {
      display: none !important;
    }

    .${FOOTER_CLASS} {
      display: flex;
      justify-content: flex-start;
      align-items: center;
      min-height: 32px;
      margin-top: 8px;
    }

    .${BUTTON_CLASS} {
      appearance: none;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-height: 30px;
      padding: 4px 10px;
      border: 0;
      border-radius: 999px;
      color: var(--mat-sys-on-surface-variant, #c4c7c5);
      background: transparent;
      font: inherit;
      font-size: 12px;
      line-height: 20px;
      cursor: pointer;
      opacity: .78;
    }

    .${BUTTON_CLASS}:hover,
    .${BUTTON_CLASS}:focus-visible {
      color: var(--mat-sys-error, #f2b8b5);
      background: color-mix(in srgb, var(--mat-sys-error, #f2b8b5) 12%, transparent);
      opacity: 1;
      outline: none;
    }

    .${BUTTON_CLASS}[aria-busy="true"] {
      pointer-events: none;
      opacity: .45;
    }

    .${BUTTON_CLASS} .material-symbols-outlined {
      font-family: 'Google Symbols', 'Material Symbols Outlined', sans-serif;
      font-size: 18px;
      line-height: 1;
    }
  `;
  document.head.append(style);

  function isVisible(element) {
    if (!(element instanceof HTMLElement)) return false;
    const css = getComputedStyle(element);
    return css.display !== 'none' && css.visibility !== 'hidden' && element.getClientRects().length > 0;
  }

  function findDeleteMenuItem() {
    const candidates = document.querySelectorAll(
      '[role="menu"] [role="menuitem"], .mat-mdc-menu-panel .mat-mdc-menu-item'
    );

    return [...candidates].find((element) => {
      if (!isVisible(element) || element.classList.contains(BUTTON_CLASS)) return false;
      const copy = element.cloneNode(true);
      copy.querySelectorAll('mat-icon, .material-symbols-outlined, .material-icons, [aria-hidden="true"]').forEach(icon => icon.remove());
      const label = (element.getAttribute('aria-label') || copy.textContent || '')
        .replace(/\s+/g, ' ')
        .trim();
      return /^(delete|delete turn|delete message)$/i.test(label) || /\bdelete (turn|message)\b/i.test(label);
    });
  }

  function waitForDeleteMenuItem(timeout = 2000) {
    return new Promise((resolve) => {
      const existing = findDeleteMenuItem();
      if (existing) return resolve(existing);

      const observer = new MutationObserver(() => {
        const item = findDeleteMenuItem();
        if (!item) return;
        observer.disconnect();
        clearTimeout(timer);
        resolve(item);
      });

      observer.observe(document.body, { childList: true, subtree: true, attributes: true });
      const timer = setTimeout(() => {
        observer.disconnect();
        resolve(null);
      }, timeout);
    });
  }

  async function deleteTurn(turn, button) {
    const optionsButton = turn.querySelector('button[aria-label="Open options"]');
    if (!optionsButton) {
      console.warn('[Always Show Delete] No options button found for turn.', turn);
      return;
    }

    button.setAttribute('aria-busy', 'true');
    optionsButton.click();

    const deleteItem = await waitForDeleteMenuItem();
    button.removeAttribute('aria-busy');

    if (!deleteItem) {
      console.warn('[Always Show Delete] AI Studio opened no recognizable Delete menu item.');
      return;
    }

    // Use AI Studio's own menu command so its normal confirmation and state updates remain intact.
    deleteItem.click();
  }

  function enhanceTurn(turn) {
    if (!(turn instanceof HTMLElement) || turn.querySelector(`.${BUTTON_CLASS}`)) return;

    const container = turn.querySelector('.chat-turn-container');
    if (!container || !turn.querySelector('button[aria-label="Open options"]')) return;

    let footer = container.querySelector('.turn-footer');
    if (!footer) {
      footer = document.createElement('div');
      footer.className = FOOTER_CLASS;
      container.append(footer);
    }

    const button = document.createElement('button');
    button.type = 'button';
    button.className = BUTTON_CLASS;
    button.setAttribute('aria-label', 'Delete this message');
    button.title = 'Delete this message';
    // Avoid innerHTML: AI Studio's Trusted Types policy can reject HTML strings.
    const icon = document.createElement('span');
    icon.className = 'material-symbols-outlined';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = 'delete';
    const label = document.createElement('span');
    label.textContent = 'Delete';
    button.append(icon, label);
    button.addEventListener('click', () => deleteTurn(turn, button));
    footer.append(button);
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = BUTTON_CLASS;
    copy.setAttribute('aria-label', 'Copy message as Markdown');
    copy.textContent = 'Copy';
    copy.addEventListener('click', async () => {
      try {
        const roots = [...turn.querySelectorAll('ms-text-chunk .cmark-node')]
          .filter(node => !node.parentElement.closest('.cmark-node'));
        const body = roots.map(node => markdown(node).trim()).filter(Boolean).join('\n\n');
        if (!body) throw new Error('No rendered message text is available to copy.');
        const date = messageDate(turn);
        await navigator.clipboard.writeText((date ? `## ${date}\n\n` : '') + body);
        copy.textContent = 'Copied!';
      } catch (error) {
        copy.textContent = 'Copy failed';
        console.warn('[Always Show Delete]', error);
      }
      setTimeout(() => { copy.textContent = 'Copy'; }, 1800);
    });
    footer.append(copy);
  }

  function messageDate(turn) {
    const stamp = turn.querySelector('.timestamp');
    if (!stamp) return null;
    const described = (stamp.getAttribute('aria-describedby') || '').split(/\s+/)
      .map(id => document.getElementById(id)?.textContent || '').join(' ');
    const value = stamp.getAttribute('datetime') || stamp.getAttribute('title') || described;
    const iso = value.match(/\b(\d{4}-\d{2}-\d{2})\b/);
    if (iso) return iso[1];
    // AI Studio's English tooltip omits the year for current-year dates.
    const match = value.match(/\b(Jan\w*|Feb\w*|Mar\w*|Apr\w*|May|Jun\w*|Jul\w*|Aug\w*|Sep\w*|Oct\w*|Nov\w*|Dec\w*)\s+(\d{1,2})(?:,?\s+(\d{4})\b)?/i);
    if (!match) return null;
    const month = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(match[1].slice(0,3).toLowerCase()) + 1;
    return `${match[3] || new Date().getFullYear()}-${String(month).padStart(2,'0')}-${match[2].padStart(2,'0')}`;
  }

  // Convert the rendered Markdown tree; Angular's custom wrapper elements are transparent.
  function markdown(node) {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent.replace(/([\\`*_\[\]])/g, '\\$1');
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const tag = node.tagName.toLowerCase();
    if (['button','svg','script','style'].includes(tag)) return '';
    const children = () => [...node.childNodes].map(markdown).join('');
    if (tag === 'pre') {
      const code = node.querySelector('code') || node;
      const text = code.textContent;
      const runs = text.match(/`+/g) || [];
      const fence = '`'.repeat(Math.max(3, ...runs.map(run => run.length + 1)));
      const language = (code.className.match(/language-([\w+-]+)/) || [])[1] || '';
      return `\n\n${fence}${language}\n${text.replace(/\n$/, '')}\n${fence}\n\n`;
    }
    if (tag === 'code') {
      const text = node.textContent;
      const fence = '`'.repeat(Math.max(1, ...(text.match(/`+/g) || []).map(run => run.length + 1)));
      return `${fence} ${text} ${fence}`;
    }
    const text = children();
    if (/^h[1-6]$/.test(tag)) return `\n\n${'#'.repeat(Number(tag[1]))} ${text.trim()}\n\n`;
    if (tag === 'p') return `\n\n${text.trim()}\n\n`;
    if (tag === 'br') return '  \n';
    if (tag === 'hr') return '\n\n---\n\n';
    if (tag === 'strong' || tag === 'b') return `**${text}**`;
    if (tag === 'em' || tag === 'i' || node.style.fontStyle === 'italic') return `*${text}*`;
    if (tag === 'del' || tag === 's') return `~~${text}~~`;
    if (tag === 'a') return `[${text}](${(node.getAttribute('href') || '').replace(/ /g,'%20').replace(/\(/g,'%28').replace(/\)/g,'%29')})`;
    if (tag === 'blockquote') return '\n\n' + text.trim().split('\n').map(line => '> ' + line).join('\n') + '\n\n';
    if (tag === 'ul' || tag === 'ol') {
      const items = [...node.querySelectorAll('li')].filter(li => li.parentElement.closest('ul,ol') === node);
      return '\n\n' + items.map((li, i) => {
        const prefix = tag === 'ol' ? `${Number(node.getAttribute('start') || 1) + i}. ` : '- ';
        return prefix + markdown(li).trim().replace(/\n/g, '\n' + ' '.repeat(prefix.length));
      }).join('\n') + '\n\n';
    }
    if (tag === 'table') {
      const rows = [...node.querySelectorAll('tr')].map(row => [...row.querySelectorAll('th,td')].map(cell => markdown(cell).trim().replace(/\n+/g,' ').replace(/\|/g,'\\|')));
      if (!rows.length) return '';
      rows.splice(1, 0, rows[0].map(() => '---'));
      return '\n\n' + rows.map(row => '| ' + row.join(' | ') + ' |').join('\n') + '\n\n';
    }
    if (tag === 'img') return `![${node.getAttribute('alt') || ''}](${node.getAttribute('src') || ''})`;
    return text;
  }

  function enhanceAll(root = document) {
    if (root instanceof Element && root.matches('ms-chat-turn')) enhanceTurn(root);
    root.querySelectorAll?.('ms-chat-turn').forEach(enhanceTurn);
  }

  enhanceAll();

  let scheduled = false;
  const pageObserver = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      enhanceAll();
    });
  });
  pageObserver.observe(document.body, { childList: true, subtree: true });
})();
