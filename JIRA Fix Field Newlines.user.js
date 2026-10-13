// ==UserScript==
// @name     JIRA Fix Field Newlines
// @description Insert missing newlines between support form fields when editing a Jira ticket
// @version  3
// @grant    GM.setClipboard
// @grant    GM_registerMenuCommand
// @match  https://*.atlassian.net/jira/*
// @match  https://*.atlassian.net/browse/*
// @include  https://jira.*
// ==/UserScript==


// The fields in the order they appear in the text. The different support forms use different
// subsets of these fields, but always in this order.
const fieldNames = [
  'telefonmodel',
  'app-version',
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

// Fields whose value is a single email address. Free text, like a message thread, may follow
// directly after the value of these.
const emailFieldNames = ['author', 'email2'];

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

// Phrases that start the sign-off of a message, longest first so the longest match wins.
const signOffPhrases = [
  'Med venlig hilsen',
  'De bedste hilsner',
  'Bedste hilsner',
  'Venlig hilsen',
  'Hilsen',
  'Mvh.',
  'Mvh',
];

const signOffPattern = new RegExp(
  `\\s(${signOffPhrases.map(escapeRegExp).join('|')})\\s+(?=\\S)`, 'g');

// Puts the sign-off of a message and the signature after it on their own lines, e.g.
// 'De bedste hilsner\nLagkagehuset A/S / ... / www.lagkagehuset.dk\nCVR-nr.: 20213094'.
// The signature is at the end, so the last sign-off phrase in the message is used.
function formatSignature(body) {
  const match = [...body.matchAll(signOffPattern)].pop();

  if (!match) {
    return body;
  }

  const message = body.slice(0, match.index);
  const signature = body
    .slice(match.index + match[0].length)
    .replace(/\s+(CVR-nr\.:)/g, '\n$1');

  return `${message}\n${match[1]}\n${signature}`;
}

// Finds the name of the sender in front of a message header. The text before the header is the end
// of the previous message, so the name is preferably one of the known names from the 'To:' parts.
// Otherwise it is assumed to be the last one or two capitalized words.
function findSenderName(textBefore, knownNames) {
  const knownName = knownNames.find(name => textBefore === name || textBefore.endsWith(` ${name}`));
  if (knownName) {
    return knownName;
  }

  const words = textBefore.split(/\s+/);
  const nameWords = [];
  while (nameWords.length < 2 && words.length > 0 && /^\p{Lu}/u.test(words[words.length - 1])) {
    nameWords.unshift(words.pop());
  }

  if (nameWords.length === 0) {
    return words[words.length - 1] || '';
  }

  return nameWords.join(' ');
}

// Splits a copied message thread into separate messages. Each message starts with a header like
// 'Kim Starck • Sep 25 10:52 To: Signeraecke Show more'. The 'Show more', 'Show less' and
// 'New messages' labels are copied buttons and markers, so they are removed.
function formatMessageThread(text) {
  const headerPattern = /\s•\s(.+?)\sTo:\s(.+?)\sShow (?:more|less)\b\s*/g;
  const headers = [...text.matchAll(headerPattern)];

  if (headers.length === 0) {
    return formatSignature(text);
  }

  const knownNames = headers
    .map(header => header[2].replace(/\s*<[^>]*>$/, ''))
    .sort((a, b) => b.length - a.length);

  const messages = [];
  let position = 0;
  let nextHeader = null;

  for (const header of headers) {
    const textBefore = text.slice(position, header.index).trimEnd();
    const senderName = findSenderName(textBefore, knownNames);
    const body = formatSignature(textBefore
      .slice(0, textBefore.length - senderName.length)
      .replace(/\s*New messages\s*$/, '')
      .trim());

    if (nextHeader !== null || body !== '') {
      messages.push(nextHeader === null ? body : `${nextHeader}\n${body}`);
    }

    nextHeader = `${senderName} • ${header[1]} To: ${header[2]}`;
    position = header.index + header[0].length;
  }

  messages.push(`${nextHeader}\n${formatSignature(text.slice(position).trim())}`);

  return messages.join('\n\n');
}

// Splits off free text that directly follows the email address of an email field. Returns null if
// the value is just the email address, possibly followed by another field.
function splitEmailValue(text, valueIndex) {
  const emailMatch = text.slice(valueIndex).match(/^\s*\S+@\S+/);
  if (!emailMatch) {
    return null;
  }

  const valueEnd = valueIndex + emailMatch[0].length;
  const rest = text.slice(valueEnd);
  const startsWithField = fieldNames.some(fieldName =>
    new RegExp(`^\\s+${escapeRegExp(fieldName)}:`).test(rest));

  if (rest.trim() === '' || startsWithField) {
    return null;
  }

  return { value: text.slice(valueIndex, valueEnd), freeText: rest.trim() };
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
    const valueIndex = fieldIndex + fieldName.length + 1;

    if (fieldName === 'attachments') {
      result += text.slice(position, valueIndex);
      result += formatAttachments(text.slice(valueIndex));
      return result;
    }

    if (emailFieldNames.includes(fieldName)) {
      const emailValue = splitEmailValue(text, valueIndex);

      if (emailValue) {
        result += text.slice(position, valueIndex) + emailValue.value;
        result += `\n${formatMessageThread(emailValue.freeText)}`;
        return result;
      }
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
