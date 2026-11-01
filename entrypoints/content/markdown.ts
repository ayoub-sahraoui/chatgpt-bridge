/**
 * Converts a ChatGPT assistant message DOM node back into markdown.
 * The rendered tree keeps enough structure (headings, lists, code blocks with
 * language labels, tables) to reconstruct faithful markdown.
 */

const BLOCK_TAGS = new Set([
  'P', 'DIV', 'UL', 'OL', 'LI', 'PRE', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'TABLE', 'THEAD', 'TBODY', 'TR', 'HR', 'SECTION', 'ARTICLE',
]);

export function extractMarkdown(root: Element): string {
  const isDirectContent =
    root.classList.contains('markdown') ||
    root.classList.contains('prose') ||
    (typeof root.className === 'string' && root.className.includes('DilResponseRoot'));

  const container = isDirectContent
    ? root
    : (root.querySelector('.markdown, .prose, [class*="DilResponseRoot"], [class*="DilRenderer"]') ?? root);

  const parsed = collapseBlocks(blockChildren(container)).trim();
  if (!parsed && root.textContent?.trim()) {
    return root.textContent.trim();
  }
  return parsed;
}

function blockChildren(el: Element | Node): string[] {
  const out: string[] = [];
  el.childNodes.forEach((node) => {
    const piece = node.nodeName === '#text' ? inlineText(node) : blockNode(node as Element);
    if (piece) out.push(piece);
  });
  return out;
}

function blockNode(el: Element): string {
  if (el.tagName === 'BUTTON' || el.tagName === 'SVG') return '';
  switch (el.tagName) {
    case 'P':
      return inlineChildren(el).trim();
    case 'H1':
    case 'H2':
    case 'H3':
    case 'H4':
    case 'H5':
    case 'H6': {
      const level = Number(el.tagName[1]);
      return `${'#'.repeat(level)} ${inlineChildren(el).trim()}`;
    }
    case 'UL':
      return listMarkdown(el, false);
    case 'OL':
      return listMarkdown(el, true);
    case 'PRE':
      return codeBlockMarkdown(el);
    case 'BLOCKQUOTE': {
      const inner = collapseBlocks(blockChildren(el)).trim();
      return inner
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n');
    }
    case 'TABLE':
      return tableMarkdown(el);
    case 'HR':
      return '---';
    case 'BR':
      return '';
    default: {
      // Generic container: recurse; keep block grouping sane.
      if (hasBlockDescendant(el)) {
        return collapseBlocks(blockChildren(el));
      }
      const text = inlineChildren(el).trim();
      return text;
    }
  }
}

function hasBlockDescendant(el: Element): boolean {
  return el.querySelector(Array.from(BLOCK_TAGS).join(',')) != null;
}

function collapseBlocks(parts: string[]): string {
  const seen: string[] = [];
  for (const raw of parts) {
    const piece = raw.trim();
    if (!piece) continue;
    seen.push(piece);
  }
  return seen.join('\n\n');
}

function listMarkdown(list: Element, ordered: boolean): string {
  const items = Array.from(list.children).filter((c) => c.tagName === 'LI');
  return items
    .map((li, idx) => {
      const nested: string[] = [];
      const inline: string[] = [];
      li.childNodes.forEach((node) => {
        const isElement = node.nodeType === 1;
        const tag = isElement ? (node as Element).tagName : '';
        if (tag === 'UL' || tag === 'OL') {
          const nestedMd = blockNode(node as Element)
            .split('\n')
            .map((l) => `  ${l}`)
            .join('\n');
          nested.push(nestedMd);
        } else if (isElement && BLOCK_TAGS.has(tag)) {
          nested.push(blockNode(node as Element));
        } else {
          inline.push(node.nodeName === '#text' ? inlineText(node) : inlineNode(node as Element));
        }
      });
      const marker = ordered ? `${idx + 1}.` : '-';
      const own = inline.join('').trim();
      const nestedStr = nested.join('\n\n');
      return nestedStr ? `${marker} ${own}\n${nestedStr}` : `${marker} ${own}`;
    })
    .join('\n');
}

function codeBlockMarkdown(pre: Element): string {
  const code = pre.querySelector('code');
  const source = (code ?? pre).textContent ?? '';
  const lang =
    code?.getAttribute('data-language') ??
    code?.className.match(/language-([\w+-]+)/)?.[1] ??
    pre.getAttribute('data-language') ??
    '';
  const fence = '```';
  return `${fence}${lang}\n${source.replace(/\n$/, '')}\n${fence}`;
}

function tableMarkdown(table: Element): string {
  const rows = Array.from(table.querySelectorAll('tr'));
  const first = rows[0];
  if (!first) return '';
  const cellText = (row: Element) =>
    Array.from(row.querySelectorAll('th,td')).map((c) => (c.textContent ?? '').trim().replace(/\|/g, '\\|'));
  const header = cellText(first);
  const lines = [
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...rows.slice(1).map((r) => `| ${cellText(r).join(' | ')} |`),
  ];
  return lines.join('\n');
}

function inlineChildren(el: Element): string {
  let out = '';
  el.childNodes.forEach((node) => {
    out += node.nodeName === '#text' ? inlineText(node) : inlineNode(node as Element);
  });
  return out;
}

function inlineNode(el: Element): string {
  if (el.tagName === 'BUTTON' || el.tagName === 'SVG') return '';
  switch (el.tagName) {
    case 'STRONG':
    case 'B': {
      const inner = inlineChildren(el).trim();
      return inner ? `**${inner}**` : '';
    }
    case 'EM':
    case 'I': {
      const inner = inlineChildren(el).trim();
      return inner ? `*${inner}*` : '';
    }
    case 'DEL':
    case 'S': {
      const inner = inlineChildren(el).trim();
      return inner ? `~~${inner}~~` : '';
    }
    case 'CODE':
      return `\`${(el.textContent ?? '').trim()}\``;
    case 'A': {
      const href = el.getAttribute('href') ?? '';
      const text = inlineChildren(el).trim();
      return href ? `[${text || href}](${href})` : text;
    }
    case 'BR':
      return '\n';
    case 'PRE':
      return codeBlockMarkdown(el);
    default:
      return inlineChildren(el);
  }
}

function inlineText(node: Node): string {
  return (node.textContent ?? '').replace(/\s+/g, ' ');
}
