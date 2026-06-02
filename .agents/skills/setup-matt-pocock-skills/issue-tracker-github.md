# Issue tracker — GitHub

Issues live in this repo's GitHub Issues. Use the `gh` CLI to interact with them.

## Authentication

Make sure the `gh` CLI is authenticated and has access to this repo.

## Common operations

- List issues: `gh issue list`
- Create an issue: `gh issue create --title "..." --body "..."`
- Add a label: `gh issue edit <number> --add-label "<label>"`
- Close an issue: `gh issue close <number>`
- Comment on an issue: `gh issue comment <number> --body "..."`

## Formatting

Use Markdown for issue bodies and comments.
