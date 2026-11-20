# Secrets to rotate

**None.**

Checked on 20 Nov 2026:

- `gitleaks` 8.21.2 scanned the full git history on every branch and found
  nothing. That's 56 commits with changes, or 84 counting merges.
- The built site (`dist/client`) contains no key patterns and no secret
  names.
- No `.env` or `.dev.vars` file was ever committed.

The only secret is `AUTH_SECRET`, which lives in the Cloudflare dashboard.
CI now runs gitleaks on every push. If it ever flags something, add it here:
its name, where it was found, and how to rotate it. Rotating `AUTH_SECRET`
resets every password and makes printed lanyards stop working, so reprint
lanyards for any open camp (see `docs/operations.md`).

**One setting for you:** turn on GitHub push protection, which blocks
secrets before they reach GitHub. On GitHub, open the repository, then
Settings › Code security › Secret Protection › Push protection.
