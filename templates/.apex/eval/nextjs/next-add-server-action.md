---
id: next-add-server-action
stack: nextjs
kind: synthetic
title: Add a server action `createPost`
starting_commit: null
prompts:
  - "Add a server action createPost in app/actions/posts.ts that inserts a row and revalidates /posts."
success_predicates:
  - kind: file_exists
    ref: app/actions/posts.ts
  - kind: contains_string
    ref: app/actions/posts.ts
    value: "use server"
  - kind: contains_string
    ref: app/actions/posts.ts
    value: "revalidatePath"
tags: [server-actions]
---

Add a server action `createPost` in `app/actions/posts.ts` that begins with the
`"use server"` directive, persists the post, and calls `revalidatePath("/posts")`.
