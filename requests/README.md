# Requests

A request board. One HTML file, no build step, no server, no npm.

## Opening it

Double-click `requests/index.html`, or open it from a file manager. That is all.
It runs from `file://` with nothing else installed, and it makes no network
requests: no CDN, no web font, no image, no fetch.

## How you add a request

1. Open the file in a browser.
2. In **Add a request**, pick a **Status** (`Bug`, `Feature` or `Done`), type a
   short **Title**, and optionally type **Detail**.
3. Press **Add to the board**.

The card appears at the top of the board immediately and is saved in that
browser's `localStorage`, so it survives a refresh, a restart and a browser
close. It does not travel with the file, so keep the browser you added it in.

Below the board, **Copy the board as JSON** shows the whole board as text.
Select it and copy it if you want to hand a new request to me: paste it into the
`SEED` array in `requests/index.html` and it becomes part of the file.

Every card also has a **Status** dropdown and, if it is not part of the seed, a
**Remove** button.

## Two homes, one truth

This is the part worth reading twice, because it is the only thing here that can
surprise you.

| | where it lives | who edits it |
|---|---|---|
| **Seeded cards** | the `SEED` array in `requests/index.html`, in git | me, on disk |
| **Cards you add** | `localStorage`, in the browser you typed them in | you, in the page |

**The file is the source of truth.** `requests/index.html` is the real board and
it is edited on disk, in git, like any other file in this repository. What you
type into the page is a scratch pad that happens to be convenient.

That has three consequences worth stating plainly:

- Clearing this site's browser data deletes everything you added. The seeded
  cards come back, because they are in the file. Yours do not.
- A card you add is not visible to me until you copy it out as JSON and I merge
  it into `SEED`. I cannot read your `localStorage`.
- The same request can exist twice, once in the file and once in your browser.
  That is fine. Merging is my job, not yours.

## How I read and update it

When you tell me a request, or when I am in this repository:

1. I read `requests/index.html`. The `SEED` array is the board.
2. To add a request, I append an entry to `SEED` with an `id`, a `status`, a
   `title`, optional `detail`, a `date` in `YYYY-MM-DD`, and `seed: true`.
3. To close one out, I set its `status` to `done` and add a line to its `detail`
   saying what actually changed. I do not delete cards; the history is the
   point.
4. If you gave me a JSON dump from **Copy the board as JSON**, I merge the
   entries I do not already have into `SEED` and give each one a stable `id`
   derived from the title, so the same request does not come back next time.
5. I verify after editing: the markup parses, every tag is closed, and hostile
   text in a title or detail renders escaped rather than as markup.

I edit the file on disk. I never write to your `localStorage` and I cannot.

## The rules the page follows

- **Order** is bugs first, then features, then done. Inside each of those,
  newest first. Bugs outrank features because bugs are what you asked me to
  prioritise.
- **Filter** is `All`, `Bug`, `Feature` or `Done`, with the count on each button.
- **Dates** are `YYYY-MM-DD`. Plain, sortable, and no locale guessing.
- **Every piece of text you type is escaped** before it is put on the page. An
  apostrophe, a `<`, a quote or an ampersand in a title shows up as itself and
  cannot break the markup.
- **No dependencies.** Plain HTML, one `<style>` block, one `<script>` block. It
  will still open in ten years.

## Known limits

- Storage is per browser profile. A second browser is a second board.
- Some private or restricted browser modes refuse `localStorage`. The page keeps
  working and says so under the form rather than quietly losing your typing.
- There is no sync and no account. Two people editing this board do not see each
  other, which is why the file is the thing that counts.
- Removing a seeded card in the browser only hides it until storage is cleared.
  To remove one for real, delete it from `SEED`.