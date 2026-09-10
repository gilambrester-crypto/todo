// Fill these in once, redeploy, and BOTH phones pick the settings up
// automatically when they load the app. (You can also leave this file alone
// and type the same values into the in-app Settings screen on each phone.)
//
// See README.md for where to find these values.

export default {
  // Your Supabase project URL, e.g. 'https://abcdefgh.supabase.co'
  url: 'https://qoqhbntflldwgpujlyjm.supabase.co',

  // The project's *anon* (public) key. Never paste the service_role key here —
  // this file ships to the browser.
  anonKey: 'sb_publishable_fssmcA_ixAodV0NZT6XevA_VUWPAZpS',

  // A long random string that both phones share. Anyone who learns it can read
  // and edit the list, so treat it like a password.
  // Generate one with:  node -e "console.log(crypto.randomUUID())"
  listId: 'myp4sstry',
};
