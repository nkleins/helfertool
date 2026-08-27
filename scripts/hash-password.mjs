import { hashPassword } from '../src/auth.js';

const plain = process.argv[2];
if (!plain) {
  console.error('Usage: node scripts/hash-password.mjs "<passwort>"');
  process.exit(1);
}
console.log(hashPassword(plain));
