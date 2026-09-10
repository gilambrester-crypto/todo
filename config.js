// Supabase settings for this app.
//
// IMPORTANT — what belongs in this file and what does not:
//
// This file is committed to the repository. If the repo is public (which the
// free tier of GitHub Pages requires), everything here is public too. Two of
// the three values below are fine with that. One is not.

export default {
  // SAFE TO COMMIT. Not a secret — every request the app makes reveals it.
  url: 'https://qoqhbntflldwgpujlyjm.supabase.co',

  // SAFE TO COMMIT. This is the *publishable* key: it is designed to ship
  // inside browser apps, and on its own it grants nothing. What actually
  // guards the data is the row-level-security policy in supabase/schema.sql,
  // which additionally demands the list code below on every request.
  //
  // Never put a `sb_secret_...` or `service_role` key here. Those bypass
  // row-level security entirely.
  anonKey: 'sb_publishable_fssmcA_ixAodV0NZT6XevA_VUWPAZpS',

  // LEAVE THIS BLANK. It is the password to your shopping list — the policy
  // in schema.sql checks it, so anyone who reads it can read and edit the
  // list. Committing it to a public repo publishes it, and deleting it later
  // does not help: it stays in the repo's git history forever.
  //
  // Instead, type the code into the app's Settings screen on each phone. It
  // is kept in that phone's local storage and never reaches the repo.
  //
  // Make it long and random, not a memorable word:
  //   node -e "console.log(crypto.randomUUID())"
  listId: '',
};
