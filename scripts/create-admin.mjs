#!/usr/bin/env node
// Prints SQL that creates the first platform administrator.
// Usage: node scripts/create-admin.mjs "Name" email@example.com | npx wrangler d1 execute DB --local --file=/dev/stdin
// For staging/production, save the output to a file and pass --env <name> --remote --file=<file>.
import { randomUUID } from 'node:crypto';

const [name, email] = process.argv.slice(2);
if (!name || !email || !/^[^@\s]+@[^@\s]+$/.test(email)) {
  console.error('Usage: node scripts/create-admin.mjs "Full Name" email@example.com');
  process.exit(1);
}
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const id = randomUUID();
const now = new Date().toISOString();
console.log(
  `INSERT INTO users (id, email, display_name, created_at, updated_at) VALUES (${q(id)}, ${q(email.toLowerCase())}, ${q(name)}, ${q(now)}, ${q(now)});\n` +
    `INSERT INTO assignments (id, user_id, role_id, created_at) VALUES (${q(randomUUID())}, ${q(id)}, 'role_platform_admin', ${q(now)});\n` +
    `INSERT INTO audit_log (at, actor_type, action, target_type, target_id) VALUES (${q(now)}, 'system', 'user.bootstrap_admin', 'user', ${q(id)});`,
);
