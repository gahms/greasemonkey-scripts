// ==UserScript==
// @name     JIRA Issue Clean Copy
// @description Copy Jira issue key and summary
// @version  1
// @grant    GM.setClipboard
// @grant    GM.notification
// @grant    GM_registerMenuCommand
// @match  https://*.atlassian.net/jira/*
// @match  https://*.atlassian.net/browse/*
// @include  https://jira.*
// ==/UserScript==


const menu_command_id_1 = GM.registerMenuCommand("Copy Jira (Markdown)", () => copyMarkdown());
const menu_command_id_2 = GM.registerMenuCommand("Copy Jira (Summary)", () => copyJiraSummary());


const snackbarId = 'snackbar';

const snackbarStyle = `
#snackbar {
  background-color: rgb(51 51 51 / 90%);
  border-radius: 100px;
  color: #fff;
  font-size: 17px;
  left: 50%;
  margin-left: -275px;
  padding-bottom: 12px;
  padding-top: 12px;
  position: absolute;
  text-align: center;
  top: 100px;
  visibility: hidden;
  width: 550px;
  z-index: 9999;
}

#snackbar.show {
  animation: fadein 0.5s, fadeout 0.8s 1.5s;
  visibility: visible;
}

@keyframes fadein {
  from {top: 0px; opacity: 0;}
  to {top: 100px; opacity: 1;}
}

@keyframes fadeout {
  from {top: 100px; opacity: 1;}
  to {top: 0px; opacity: 0;}
}`;

var snackbarTimeoutId = undefined;

function addGlobalStyle(id, css) {
  const head = document.getElementsByTagName('head')[0];

  if (!head) {
    return;
  }

  const existingStyle = document.getElementById(id);
  if (existingStyle) {
    return;
  }

  const style = document.createElement('style');
  style.id = id;
  style.type = 'text/css';
  style.innerHTML = css;

  head.appendChild(style);
}

function copyIssue(key, summary, isBranchNameCopy, isMarkdown) {
  const unwantedCharactersPattern = /\W/ig;
  const repeatedDashesPattern = /-+/g;
  const unwantedEndPattern = /-$/g;

  let cleanedName;

  if (isBranchNameCopy) {
    const summaryCleaned = summary
      .replaceAll(unwantedCharactersPattern, '-')
      .replaceAll(repeatedDashesPattern, '-')
      .replaceAll(unwantedEndPattern, '');

    cleanedName = `${key}-${summaryCleaned}`;
  } else {
    const summaryCleaned = summary
      .replaceAll(/\W$/g, '')
    cleanedName = `${key}: ${summaryCleaned}`;
    if (isMarkdown) {
        const url = `${window.location.origin}/browse/${key}`;
        cleanedName = `[${cleanedName}](${url})`
    }
  }

  GM.setClipboard(cleanedName);
  showSnackbar(`Issue '${key}' copied to clipboard${isBranchNameCopy ? ' as branch name' : ''}`);
}

function copyUrl(key) {
  const url = `${window.location.origin}/browse/${key}`;

  GM.setClipboard(url);
  showSnackbar(`Issue '${key}' URL copied to clipboard`);
}

function dismissSnackbar() {
  const snackbar = document.getElementById(snackbarId);

  if (!snackbar) {
    return;
  }

  snackbar.className = '';
}

function showSnackbar(text) {
  const body = document.getElementsByTagName('body')[0];

  if (!body) {
    return;
  }

  function show(snackbar) {
    if (snackbarTimeoutId) {
      clearTimeout(snackbarTimeoutId);
    }

    snackbar.className = '';

    // Trigger DOM reflow
    void snackbar.offsetWidth;

    snackbar.innerText = text;
    snackbar.className = 'show';
    snackbarTimeoutId = setTimeout(dismissSnackbar, dismissDelay);
  }

  const dismissDelay = 2000;
  const existingElement = document.getElementById(snackbarId);

  if (existingElement) {
    show(existingElement);
    return;
  }

  addGlobalStyle('snackbarStyle', snackbarStyle);

  const element = document.createElement('div');
  element.id = snackbarId;
  body.appendChild(element);

  show(element);
}

function findSelectedIssueKey() {
  const url = new URL(window.location.href);
  const selectedIssueQueryParam = url.searchParams.get("selectedIssue");

  if (selectedIssueQueryParam) {
    return selectedIssueQueryParam;
  }

  const issuePathMatches = url.pathname.match(/\/browse\/(.*-.*)/);
  if (issuePathMatches.length > 1) {
    return issuePathMatches[1];
  }

  return null;
}

async function copyMarkdown () {
    const selectedIssueKey = findSelectedIssueKey();
    if (!selectedIssueKey) {
      return;
    }
    const issueDetailsEndpoint = `${window.location.origin}/rest/api/latest/issue/${selectedIssueKey}`;
    const issueDetailsResponse = await fetch(issueDetailsEndpoint);
    const { fields: { summary } } = await issueDetailsResponse.json();

    copyIssue(selectedIssueKey, summary, false, true);
}

async function copyJiraSummary () {
    const selectedIssueKey = findSelectedIssueKey();
    if (!selectedIssueKey) {
      return;
    }
    const issueDetailsEndpoint = `${window.location.origin}/rest/api/latest/issue/${selectedIssueKey}`;
    const issueDetailsResponse = await fetch(issueDetailsEndpoint);
    const { fields: { summary } } = await issueDetailsResponse.json();

    copyIssue(selectedIssueKey, summary, false, false);
}

document.addEventListener('keydown', async e => {
  if (e.repeat) {
    return;
  }

  if (!e.metaKey) {
    return;
  }


  if (e.code === 'KeyC' || e.code === 'KeyX' || e.code === 'KeyZ' || e.code === 'KeyM') {
    const selectedText = window.getSelection().toString();

    if (selectedText) {
      return;
    }

    const isBranchNameCopy = e.code === 'KeyC';
    const isUrlCopy = e.code === 'KeyZ';
    const isMarkdown = e.code === 'KeyM';

    const selectedIssueKey = findSelectedIssueKey();
    if (!selectedIssueKey) {
      return;
    }

    console.log(`Selected issue: ${selectedIssueKey}`);
    const issueDetailsEndpoint = `${window.location.origin}/rest/api/latest/issue/${selectedIssueKey}`;
    const issueDetailsResponse = await fetch(issueDetailsEndpoint);
    const { fields: { summary } } = await issueDetailsResponse.json();

    if (isUrlCopy) {
      copyUrl(selectedIssueKey);
    } else {
      copyIssue(selectedIssueKey, summary, isBranchNameCopy, isMarkdown);
    }
  }
});