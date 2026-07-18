function parseJson(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function renderDocument(document, jsonToMarkdown = true, options = {}) {
  if (!jsonToMarkdown) return document?.content || '';
  const parsed = document?.json !== undefined
    ? document.json
    : parseJson(document?.content);
  return parsed === null ? (document?.content || '') : renderJsonToMarkdown(parsed, 0, options);
}

function renderJsonToMarkdown(value, indent = 0, options = {}) {
  const prefix = ' '.repeat(indent);
  if (Array.isArray(value)) {
    return value
      .filter(item => !options.skipEmpty || !isEmpty(item))
      .map((item, index) => renderArrayItem(item, index, indent, options))
      .join('\n');
  }
  if (!isObject(value)) return `${prefix}${formatScalar(value)}`;

  const lines = [];
  for (const [key, child] of Object.entries(value)) {
    if (options.skipEmpty && isEmpty(child)) continue;
    if (Array.isArray(child)) {
      lines.push(`${prefix}- **${key}:**`);
      if (child.length === 0) lines.push(`${prefix}  - _None_`);
      else lines.push(child
        .filter(item => !options.skipEmpty || !isEmpty(item))
        .map((item, index) => renderArrayItem(item, index, indent + 2, options)).join('\n'));
    } else if (isObject(child)) {
      lines.push(`${prefix}- **${key}:**`);
      lines.push(renderJsonToMarkdown(child, indent + 2, options));
    } else if (isMultilineString(child)) {
      lines.push(`${prefix}- **${key}:**`, '', String(child).trim(), '');
    } else {
      lines.push(`${prefix}- **${key}:** ${formatScalar(child)}`);
    }
  }
  return lines.join('\n');
}

function renderArrayItem(item, index, indent, options = {}) {
  const prefix = ' '.repeat(indent);
  if (!isObject(item) && !Array.isArray(item)) return `${prefix}- ${formatScalar(item)}`;
  if (Array.isArray(item)) {
    return `${prefix}${index + 1}.\n${renderJsonToMarkdown(item, indent + 3, options)}`;
  }

  const label = item.title || item.name || item.candidateId || item.id || `Item ${index + 1}`;
  const detail = { ...item };
  if (detail.title === label) delete detail.title;
  if (detail.name === label) delete detail.name;
  const rendered = renderJsonToMarkdown(detail, indent + 3, options);
  return rendered
    ? `${prefix}${index + 1}. **${formatInline(label)}**\n${rendered}`
    : `${prefix}${index + 1}. **${formatInline(label)}**`;
}

function formatScalar(value) {
  if (value === null || value === undefined) return '_None_';
  if (value === '') return '_Empty_';
  return formatInline(String(value));
}

function formatInline(value) {
  return String(value).replace(/\r?\n/g, '<br>');
}

function isMultilineString(value) {
  return typeof value === 'string' && /\r?\n/.test(value);
}

function isEmpty(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0 || value.every(isEmpty);
  if (isObject(value)) {
    const children = Object.values(value);
    return children.length === 0 || children.every(isEmpty);
  }
  return false;
}

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

module.exports = {
  parseJson,
  renderDocument,
  renderJsonToMarkdown,
  isEmpty
};
