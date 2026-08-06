# The newsroom: access, roles and bootstrap

`/admin` is the private half of the portal. It ships **not one line of
JavaScript**: forms that post and redirect. Besides being less to maintain, it
guarantees that the newsroom bundle can never show up on a public page, because
it does not exist.

## How you get in

By invitation only. An `owner` invites from `/admin/invitar`; the link is
single-use, expires in 72 hours, and whoever receives it picks their own
password and the name they sign with. Accepting the invitation creates the user
and their public author record at the same time: whoever joins a newsroom comes
to sign their work.

## Roles

| | journalist | editor | owner |
|---|---|---|---|
| Edit their public profile | ✅ | ✅ | ✅ |
| Write and edit their own drafts (F6) | ✅ | ✅ | ✅ |
| Edit other people's work (F6) | — | ✅ | ✅ |
| Publish (F6) | — | ✅ | ✅ |
| Invite | — | — | ✅ |

Permissions are checked **on the server and per route**. A link missing from the
dashboard is cosmetics: whoever types the URL by hand meets a 403.

## The first owner (bootstrap)

There is **no** — and there will be no — "if there are no users, the first one
to arrive becomes owner" path. That shortcut is a classic vulnerability: all it
takes is arriving first. The first owner is created by inserting their
invitation directly in the database, which is an action that already requires
server access:

```bash
# 1. Generate the token and its hash (the CLEAR-TEXT token is stored nowhere)
TOKEN=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))")
HASH=$(node -e "console.log(require('crypto').createHash('sha256').update('$TOKEN').digest('hex'))")

# 2. Insert the invitation (72 h)
psql "$DATABASE_URL" -c "INSERT INTO invites (email, role, token_hash, expires_at)
  VALUES ('quien.manda@ejemplo.com', 'owner', '$HASH', now() + interval '72 hours')"

# 3. Hand this link to that person, over a private channel:
echo "https://rafael-news.brotea.dev/admin/aceptar?t=$TOKEN"
```

From then on, that person invites everybody else from the interface.

## What protects what

- **Opaque sessions in the database**, not JWTs: instant revocation is a
  requirement. Suspending someone has to **throw them out if they are already
  inside**, not just stop them coming back — which is why the session checks the
  user's status on every request. There is no suspension screen yet: it is
  `UPDATE users SET status='suspended' WHERE email=…`, and the next request that
  person makes lands on the sign-in page.
- **`scrypt` from `node:crypto`**, with a per-user salt and the parameters
  stored next to the hash, so the cost can be raised tomorrow without
  invalidating anybody's password. Careful when raising it: scrypt needs about
  128·N·r bytes and node's default ceiling is 32 MB, so `maxmem` is computed
  from N·r (with N=2¹⁵ and r=8 it needs 33.5 MB, and without raising it **every
  sign-in attempt throws**).
- **Double-submit CSRF** on every POST, compared in constant time.
- **Generic error messages**: if "no such address" and "wrong password" could be
  told apart, the form would say who writes for this outlet. For the same
  reason, a non-existent address also pays the cost of a scrypt verification —
  otherwise the response time would give it away anyway.
- **Changing the password revokes every open session**: if it was stolen,
  changing it has to be worth something. (The reset flow that triggers this has
  no page yet — `/admin/restablecer` does not exist. Today a lost password is
  fixed by sending a new invitation to the same address.)
- **Audit log** of sign-in, sign-out, invitation and profile change. When
  something gets published wrong, the question will be who and when.
