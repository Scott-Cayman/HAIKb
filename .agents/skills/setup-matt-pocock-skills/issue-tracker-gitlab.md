# Issue tracker — GitLab

Issues live in this repo's GitLab Issues. Use the `glab` CLI to interact with them.

## Authentication

Make sure the `glab` CLI is authenticated and has access to this repo.

## Common operations

- List issues: `glab issue list`
- Create an issue: `glab issue create --title "..." --description "..."`
- Add a label: `glab issue update <number> --add-label "<label>"`
- Close an issue: `glab issue close <number>`
- Comment on an issue: `glab issue note <number> --message "..."`

## Formatting

Use Markdown for issue bodies and comments.
