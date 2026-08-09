import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

import { hashPassword } from '@/admin/auth/password';

/**
 * Generate a scrypt password hash for an admin roster entry.
 *
 * Usage:
 *   npm run admin:hash               (prompts for the password, no echo arg)
 *   npm run admin:hash -- 'secret'   (password as an argument)
 *
 * Copy the printed hash into an ADMIN_USERS entry. The plaintext password is
 * never stored — only the hash goes into your environment. Do NOT commit real
 * hashes or passwords.
 */

async function readPassword(): Promise<string> {
  const fromArg = process.argv[2];
  if (fromArg) return fromArg;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await new Promise<string>((resolve) => {
      rl.question('Password: ', (answer) => resolve(answer));
    });
  } finally {
    rl.close();
  }
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === process.argv[1];

if (invokedDirectly) {
  readPassword()
    .then((password) => {
      if (!password) {
        console.error('No password provided.');
        process.exit(1);
        return;
      }
      console.log(hashPassword(password));
    })
    .catch((error: unknown) => {
      console.error((error as Error).message);
      process.exit(1);
    });
}
