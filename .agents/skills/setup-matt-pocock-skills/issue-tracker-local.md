# Issue tracker — Local markdown

Issues live as markdown files under `.scratch/` in this repo.

## Structure

```
.scratch/
├── <feature-1>/
│   ├── 001-issue-title.md
│   ├── 002-issue-title.md
│   └── ...
├── <feature-2>/
│   └── ...
└── ...
```

Each issue is a numbered markdown file under a feature directory.

## Issue format

```markdown
---
title: Issue title
labels: [label1, label2]
state: open | closed
created: YYYY-MM-DD
---

Issue body here...
```

## Comments

Add comments inline in the markdown file.

---

## Comment 1

Comment content...

---

## Comment 2

Comment content...
