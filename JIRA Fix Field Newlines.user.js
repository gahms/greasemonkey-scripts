// ==UserScript==
// @name     JIRA Fix Field Newlines
// @description Insert missing newlines between support form fields when editing a Jira ticket
// @version  1
// @grant    GM.setClipboard
// @grant    GM_registerMenuCommand
// @match  https://*.atlassian.net/jira/*
// @match  https://*.atlassian.net/browse/*
// @include  https://jira.*
// ==/UserScript==


// The fields in the order they appear in the text.
const fieldNames = [
  'store',
  'date',
  'produkt',
  'description',
  'drive-in',
  'name',
  'phone',
  'author',
  'email2',
  'accept',
  'subject',
  'category',
  'support-category',
  'attachments',
];

// Minimum number of fields a text must contain before it is considered malformed field text.
const minimumFieldCount = 3;

const menu_command_id_1 = GM.registerMenuCommand("Fix field newlines", () => fixFieldNewlines());


const snackbarId = 'fix-fields-snackbar';

const snackbarStyle = `
#${snackbarId} {
  background-color: rgb(51 51 51 / 90%);
  border-radius: 100px;
  color: #fff;
  font-size: 17px;
  left: 50%;
  margin-left: -275px;
  padding-bottom: 12px;
  padding-top: 12px;
  position: fixed;
  text-align: center;
  top: 100px;
  visibility: hidden;
  width: 550px;
  z-index: 9999;
}

#${snackbarId}.show {
  visibility: visible;
}`;

var snackbarTimeoutId = undefined;

function addGlobalStyle(id, css) {
  const head = document.getElementsByTagName('head')[0];

  if (!head || document.getElementById(id)) {
    return;
  }

  const style = document.createElement('style');
  style.id = id;
  style.type = 'text/css';
  style.innerHTML = css;

  head.appendChild(style);
}

function showSnackbar(text) {
  const body = document.getElementsByTagName('body')[0];

  if (!body) {
    return;
  }

  addGlobalStyle(`${snackbarId}-style`, snackbarStyle);

  let snackbar = document.getElementById(snackbarId);
  if (!snackbar) {
    snackbar = document.createElement('div');
    snackbar.id = snackbarId;
    body.appendChild(snackbar);
  }

  if (snackbarTimeoutId) {
    clearTimeout(snackbarTimeoutId);
  }

  snackbar.innerText = text;
  snackbar.className = 'show';
  snackbarTimeoutId = setTimeout(() => snackbar.className = '', 2500);
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Matches a field name at the start of the text or after whitespace, so 'category:' does not
// match inside 'support-category:'.
function fieldPattern(fieldName) {
  return new RegExp(`(^|\\s)${escapeRegExp(fieldName)}:`, 'g');
}

function countFields(text) {
  return fieldNames.filter(fieldName => fieldPattern(fieldName).test(text)).length;
}

function isFieldText(text) {
  return countFields(text) >= minimumFieldCount;
}

// Puts each attachment item ('- name: url') on its own line.
function formatAttachments(value) {
  const itemPattern = /-\s+(.+?):\s*(https?:\/\/\S+)/g;
  const items = [];
  let lastIndex = 0;
  let match;

  while ((match = itemPattern.exec(value)) !== null) {
    items.push(`- ${match[1]}: ${match[2]}`);
    lastIndex = itemPattern.lastIndex;
  }

  if (items.length === 0) {
    return value;
  }

  return ` \n${items.join(' \n')}${value.slice(lastIndex)}`;
}

// Inserts a newline before each known field. The fields are searched for in their expected order,
// so text in a field value that happens to look like an earlier field is left alone.
function formatFields(text) {
  let result = '';
  let position = 0;

  for (const fieldName of fieldNames) {
    const pattern = fieldPattern(fieldName);
    pattern.lastIndex = position;
    const match = pattern.exec(text);

    if (!match) {
      continue;
    }

    const fieldIndex = match.index + match[1].length;
    result += text.slice(position, fieldIndex);
    if (fieldIndex > 0 && !result.endsWith('\n')) {
      result += '\n';
    }
    position = fieldIndex;

    if (fieldName === 'attachments') {
      const valueIndex = fieldIndex + fieldName.length + 1;
      result += text.slice(position, valueIndex);
      result += formatAttachments(text.slice(valueIndex));
      return result;
    }
  }

  return result + text.slice(position);
}

function escapeHtml(text) {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

// Rich text editors (ProseMirror in Jira Cloud) keep their own document model, so changing the
// DOM directly would be ignored or reverted. Instead the block is selected and the fixed text is
// pasted over it, which goes through the editor's own paste handling.
async function replaceBlockText(editor, block, text) {
  editor.focus();

  const range = document.createRange();
  range.selectNodeContents(block);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);

  // Let the editor pick up the new selection before pasting
  await delay(50);

  const lines = text.split('\n');
  const html = lines.map(line => `<p>${escapeHtml(line)}</p>`).join('');

  const dataTransfer = new DataTransfer();
  dataTransfer.setData('text/plain', text);
  dataTransfer.setData('text/html', html);

  const pasteEvent = new ClipboardEvent('paste', {
    bubbles: true,
    cancelable: true,
    clipboardData: dataTransfer,
  });

  editor.dispatchEvent(pasteEvent);

  await delay(50);
}

function findRichTextEditors() {
  const activeElement = document.activeElement;
  const activeEditor = activeElement && activeElement.closest('[contenteditable="true"]');

  if (activeEditor) {
    return [activeEditor];
  }

  return [...document.querySelectorAll('[contenteditable="true"]')]
    .filter(editor => !editor.parentElement.closest('[contenteditable="true"]'));
}

function findMalformedBlocks(editor) {
  return [...editor.querySelectorAll('p')]
    .filter(block => isFieldText(block.textContent))
    .filter(block => formatFields(block.textContent) !== block.textContent);
}

async function fixRichTextEditors() {
  let fixedCount = 0;
  let failedText = null;

  for (const editor of findRichTextEditors()) {
    for (const block of findMalformedBlocks(editor)) {
      const originalText = block.textContent;
      const formattedText = formatFields(originalText);

      await replaceBlockText(editor, block, formattedText);

      if (editor.textContent.includes(originalText)) {
        failedText = formattedText;
      } else {
        fixedCount++;
      }
    }
  }

  return { fixedCount, failedText };
}

function fixTextAreas() {
  let fixedCount = 0;
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;

  for (const textArea of document.querySelectorAll('textarea')) {
    const lines = textArea.value.split('\n');
    const fixedLines = lines.map(line => isFieldText(line) ? formatFields(line) : line);
    const fixedValue = fixedLines.join('\n');

    if (fixedValue === textArea.value) {
      continue;
    }

    valueSetter.call(textArea, fixedValue);
    textArea.dispatchEvent(new Event('input', { bubbles: true }));
    textArea.dispatchEvent(new Event('change', { bubbles: true }));
    fixedCount++;
  }

  return fixedCount;
}

async function fixFieldNewlines() {
  const textAreaCount = fixTextAreas();
  const { fixedCount, failedText } = await fixRichTextEditors();

  if (failedText) {
    GM.setClipboard(failedText);
    showSnackbar('Could not update editor. Fixed text copied to clipboard');
    return;
  }

  const totalCount = textAreaCount + fixedCount;
  if (totalCount === 0) {
    showSnackbar('No malformed fields found. Is the editor open?');
    return;
  }

  showSnackbar('Fixed field newlines');
}

document.addEventListener('keydown', e => {
  if (e.repeat) {
    return;
  }

  if (e.ctrlKey && e.shiftKey && !e.metaKey && !e.altKey && e.code === 'KeyF') {
    e.preventDefault();
    fixFieldNewlines();
  }
});
