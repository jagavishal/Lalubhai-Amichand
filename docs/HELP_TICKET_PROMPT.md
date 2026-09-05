# Prompt — Help Ticket System

Paste everything below the line into Claude Code in the other ERP.

---

Add an internal **Help Ticket** system to this application — a place where staff
raise issues or requests for the admin team, and the admin team works them to
closed.

**Before you write anything, read this codebase and match it.** Do not invent a
new stack, a new folder layout, a new auth mechanism or a new UI language. Find
an existing feature of similar shape (a list page with a create modal and a
status column — approvals, leave requests, complaints, anything) and follow its
conventions exactly: same routing, same database access layer, same session and
permission helpers, same toast/confirm/modal utilities, same table markup and
spacing, same date formatting. Tell me which existing feature you used as the
model before you start.

## What it has to do

A user raises a ticket. It lands in a queue. An admin picks it up, optionally
assigns it to someone, works it, and resolves it. The person who raised it can
see where it got to. Nothing is ever hard-deleted.

## Data model

One table, `help_tickets`:

| Field | Notes |
| --- | --- |
| `id` | Primary key. **Use whatever id scheme this codebase already uses.** If it has no convention, use a UUID — do NOT key off a timestamp, two tickets raised in the same millisecond would collide. |
| `subject` | Required. The one-line issue. |
| `description` | Long text, optional. |
| `category` | Optional but include it: IT / HR / Accounts / Facilities / Other, or whatever departments this company actually has — look for an existing departments table or enum and reuse it. |
| `priority` | High / Medium / Low. Default Medium. |
| `status` | `open` → `in_progress` → `resolved`, plus `closed`. Store the machine value; render the label in the UI. |
| `raised_by_id` | FK to the users table. **The id, not the name.** |
| `assigned_to_id` | FK to users, nullable. **The id, not the name** — a name column orphans itself the day someone is renamed. |
| `due_date` | Nullable. Optional at raise time; an admin can set it. |
| `resolved_at` | Nullable timestamp, stamped when status becomes resolved. Lets you report on turnaround without parsing an audit log. |
| `created_at` / `updated_at` | Standard. |

Second table, `help_ticket_events` — every status change, reassignment and
comment, as an append-only trail: `id`, `ticket_id`, `actor_id`, `kind`
(`comment` / `status` / `assign`), `body`, `created_at`. The ticket page shows
this as a thread. Without it, nobody can tell who resolved what or why, and
"it was resolved but the problem is still there" becomes unarguable.

## API

- `GET /help-tickets` — list. Non-admin sees only their own (raised by them, or
  assigned to them). Admin sees all. Support filtering by status, priority,
  assignee and a date range, and **paginate it** — this table only grows.
- `GET /help-tickets/:id` — one ticket with its event thread.
- `POST /help-tickets` — raise one.
- `PATCH /help-tickets/:id` — change status, assignee, priority or due date.
- `POST /help-tickets/:id/comments` — add to the thread.

## Permissions — get this exactly right

This is where the equivalent feature in our other ERP is broken, so be explicit:

- **Every write route must re-check who is asking, on the server, against the
  ticket being changed.** It is not enough that the list route filters by user.
  If `PATCH` only checks that someone is logged in, any employee can resolve or
  reassign a ticket they cannot even see, just by knowing an id.
- Raising a ticket: any authenticated user.
- Changing status, assignee, priority or due date: admin only, or the person
  the ticket is currently assigned to.
- Commenting: the person who raised it, the assignee, or an admin.
- Reopening a resolved ticket: the raiser (if they are not satisfied) or an
  admin.
- Hiding a button in the UI is a courtesy, not a control. Check the server side
  regardless.

## UI

A page in the main navigation, wherever this app puts its staff-facing tools.

- **List** — Ticket no, Subject, Category, Raised by, Assigned to, Priority,
  Status, Age. Filters across the top; status and priority as coloured pills.
  Resolved rows visually recede rather than disappearing.
- **New Ticket** — modal or drawer, matching whatever this app already uses.
  Subject, Category, Priority, Description. Do not ask the user for their own
  name or the date — the server knows both, and a form that asks invites
  someone to file a ticket as somebody else.
- **Detail view** — the ticket, its thread, and the actions the current user is
  actually allowed. Status change and reassignment both go into the thread.
- **Empty and error states** — a list that fails to load must say so. Do not
  swallow the error and render "No tickets yet"; that reads as "everything is
  fine" when the API is down.

## Also do

- If this app sends email or in-app notifications anywhere, hook them up: notify
  the assignee when a ticket lands on them, and the raiser when it is resolved.
  If it has no notification layer, skip it and say so — do not build one.
- Add an unresolved-ticket count to wherever this app shows pending work
  (dashboard, sidebar badge) if such a place exists.
- Seed nothing. No fake tickets.

## When you are done

Show me:
1. Which existing feature you modelled it on.
2. The migration, and confirmation it runs cleanly on a database that already
   has data.
3. A walk through the permission checks on each write route — specifically, what
   happens when user A PATCHes user B's ticket.

Do not commit or push. Show me the diff first.
