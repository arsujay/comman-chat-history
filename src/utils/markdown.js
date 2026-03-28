/**
 * Lightweight markdown renderer
 * Converts markdown text to HTML for display in chat bubbles
 */

/**
 * Escape HTML entities
 */
function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return text.replace(/[&<>"']/g, c => map[c]);
}

/**
 * Process inline markdown (bold, italic, code, links)
 */
function processInline(text) {
  // Inline code (must be before bold/italic)
  text = text.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Bold + italic
  text = text.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');

  // Bold
  text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

  // Italic
  text = text.replace(/(?<!\*)\*([^\*]+?)\*(?!\*)/g, '<em>$1</em>');

  // Links [text](url)
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

  // Auto-link simple URLs
  text = text.replace(
    /(?<!\])\(?(https?:\/\/[^\s)<]+)\)?/g,
    (match, url) => {
      if (match.startsWith('(') && match.endsWith(')')) return match; // already inside link
      return `<a href="${url}" target="_blank" rel="noopener">${url}</a>`;
    }
  );

  return text;
}

/**
 * Render markdown text to HTML
 * Handles: code blocks, headers, lists, blockquotes, paragraphs, inline formatting
 */
export function renderMarkdown(text) {
  if (!text) return '';

  const lines = text.split('\n');
  const result = [];
  let inCodeBlock = false;
  let codeBlockLang = '';
  let codeBlockLines = [];
  let inList = false;
  let listType = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Code block fences
    if (line.trim().startsWith('```')) {
      if (inCodeBlock) {
        // End code block
        const code = escapeHtml(codeBlockLines.join('\n'));
        const lang = codeBlockLang || 'text';
        result.push(
          `<div class="code-block-wrapper">` +
          `<div class="code-block-header">` +
          `<span class="code-block-lang">${escapeHtml(lang)}</span>` +
          `<button class="code-copy-btn" onclick="copyCode(this)">` +
          `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>` +
          `Copy</button>` +
          `</div>` +
          `<pre><code class="language-${lang}">${code}</code></pre>` +
          `</div>`
        );
        inCodeBlock = false;
        codeBlockLang = '';
        codeBlockLines = [];
      } else {
        // Start code block
        inCodeBlock = true;
        codeBlockLang = line.trim().replace(/^```/, '').trim();
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockLines.push(line);
      continue;
    }

    // Close list if line is not a list item
    if (inList && !/^\s*([-*+]|\d+\.)\s/.test(line) && line.trim() !== '') {
      result.push(listType === 'ul' ? '</ul>' : '</ol>');
      inList = false;
    }

    // Empty line
    if (line.trim() === '') {
      if (inList) {
        result.push(listType === 'ul' ? '</ul>' : '</ol>');
        inList = false;
      }
      continue;
    }

    // Headers
    const headerMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (headerMatch) {
      const level = headerMatch[1].length;
      result.push(`<h${level}>${processInline(escapeHtml(headerMatch[2]))}</h${level}>`);
      continue;
    }

    // Blockquote
    if (line.startsWith('> ')) {
      result.push(`<blockquote>${processInline(escapeHtml(line.slice(2)))}</blockquote>`);
      continue;
    }

    // Unordered list item
    const ulMatch = line.match(/^\s*([-*+])\s+(.+)/);
    if (ulMatch) {
      if (!inList || listType !== 'ul') {
        if (inList) result.push('</ol>');
        result.push('<ul>');
        inList = true;
        listType = 'ul';
      }
      result.push(`<li>${processInline(escapeHtml(ulMatch[2]))}</li>`);
      continue;
    }

    // Ordered list item
    const olMatch = line.match(/^\s*(\d+)\.\s+(.+)/);
    if (olMatch) {
      if (!inList || listType !== 'ol') {
        if (inList) result.push('</ul>');
        result.push('<ol>');
        inList = true;
        listType = 'ol';
      }
      result.push(`<li>${processInline(escapeHtml(olMatch[2]))}</li>`);
      continue;
    }

    // Horizontal rule
    if (/^[-*_]{3,}$/.test(line.trim())) {
      result.push('<hr>');
      continue;
    }

    // Paragraph
    result.push(`<p>${processInline(escapeHtml(line))}</p>`);
  }

  // Close any open code block
  if (inCodeBlock) {
    const code = escapeHtml(codeBlockLines.join('\n'));
    result.push(`<pre><code>${code}</code></pre>`);
  }

  // Close any open list
  if (inList) {
    result.push(listType === 'ul' ? '</ul>' : '</ol>');
  }

  return result.join('\n');
}
