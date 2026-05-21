/* CLI per gestire gli utenti direttamente nel DB.
 *
 * Uso:
 *   node dist/server/src/scripts/users.js add <email>        # crea o aggiorna la password
 *   node dist/server/src/scripts/users.js remove <email>     # elimina (cascade su progress/watchlist/...)
 *   node dist/server/src/scripts/users.js list               # elenco utenti
 *
 * DATABASE_URL deve essere in env. La password viene chiesta via prompt
 * (echo disattivato) e salvata bcrypt-hashed — mai in chiaro.
 */

import readline from 'readline';
import bcrypt from 'bcryptjs';
import { kdb, pool } from '../db';

async function promptPassword(label: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  /* readline non offre un input "muto" out-of-the-box: intercettiamo il
   * _writeToOutput interno per stampare '*' al posto del carattere reale.
   * La password resta solo in memoria. */
  const orig = (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput;
  (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (str: string) => {
    if (str.includes(label)) return orig.call(rl, str);
    orig.call(rl, '*'.repeat(str.length));
  };

  return new Promise<string>((resolve) => {
    rl.question(label, (value) => {
      rl.close();
      process.stdout.write('\n');
      resolve(value);
    });
  });
}

function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

async function addUser(emailRaw: string): Promise<void> {
  const email = normalizeEmail(emailRaw);
  if (!email.includes('@')) {
    console.error('email non valida');
    process.exit(2);
  }

  const password = await promptPassword('Password: ');
  if (password.length < 6) {
    console.error('password troppo corta (min 6 caratteri)');
    process.exit(2);
  }
  const confirm = await promptPassword('Conferma:  ');
  if (password !== confirm) {
    console.error('le password non coincidono');
    process.exit(2);
  }

  const hash = await bcrypt.hash(password, 10);

  const existing = await kdb
    .selectFrom('users')
    .select('id')
    .where('email', '=', email)
    .executeTakeFirst();

  if (existing) {
    await kdb
      .updateTable('users')
      .set({ password_hash: hash })
      .where('id', '=', existing.id)
      .execute();
    console.log(`password aggiornata per ${email}`);
    return;
  }

  await kdb
    .insertInto('users')
    .values({ email, password_hash: hash })
    .execute();
  console.log(`utente ${email} creato`);
}

async function removeUser(emailRaw: string): Promise<void> {
  const email = normalizeEmail(emailRaw);
  const result = await kdb
    .deleteFrom('users')
    .where('email', '=', email)
    .executeTakeFirst();
  const removed = Number(result.numDeletedRows);
  if (removed === 0) {
    console.error(`utente ${email} non trovato`);
    process.exit(1);
  }
  console.log(`utente ${email} eliminato (progress/watchlist/history rimossi in cascade)`);
}

async function listUsers(): Promise<void> {
  const rows = await kdb
    .selectFrom('users')
    .select(['id', 'email', 'created_at'])
    .orderBy('created_at', 'desc')
    .execute();
  if (rows.length === 0) {
    console.log('(nessun utente)');
    return;
  }
  console.log('id    email                                      created_at');
  console.log('----  -----------------------------------------  -------------------');
  for (const row of rows) {
    const created = new Date(row.created_at * 1000).toISOString().slice(0, 19).replace('T', ' ');
    console.log(`${String(row.id).padEnd(4)}  ${row.email.padEnd(41)}  ${created}`);
  }
}

async function main(): Promise<void> {
  const cmd = process.argv[2];
  const arg = process.argv[3];
  switch (cmd) {
    case 'add':
      if (!arg) {
        console.error('uso: users add <email>');
        process.exit(2);
      }
      await addUser(arg);
      break;
    case 'remove':
    case 'rm':
      if (!arg) {
        console.error('uso: users remove <email>');
        process.exit(2);
      }
      await removeUser(arg);
      break;
    case 'list':
    case 'ls':
      await listUsers();
      break;
    default:
      console.error('uso: users (add <email> | remove <email> | list)');
      process.exit(2);
  }
}

main().then(() => pool.end()).catch((err) => {
  console.error('[users]', err);
  pool.end().finally(() => process.exit(1));
});
