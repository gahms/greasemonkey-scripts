# Scripts for Greasemonkey / Tampermonkey

I am using Tampermonkey with Safari on macOS for this.

## Scripts

### JIRA Issue Clean Copy

Copy the key, summary, URL or a branch name for the current Jira issue to the clipboard.

### JIRA Fix Field Newlines

Fix support form text in a Jira ticket where the newline between each field is missing, e.g.
`store: ... date: ... produkt: ...`. Each field is put on its own line, and each item in
`attachments` gets its own line too.

Open the ticket description editor and press `Ctrl+Shift+F`, or choose "Fix field newlines" from
the Tampermonkey menu. If the editor cannot be updated, the fixed text is copied to the clipboard
instead.
