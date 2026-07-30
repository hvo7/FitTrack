/* FitTrack — cloud configuration.
 *
 * These two values are SAFE TO COMMIT to a public repo. The anon key is a
 * public client key by design; it grants nothing on its own. All access is
 * gated by Supabase Row Level Security (see supabase/schema.sql), which
 * restricts every row to the signed-in user who owns it.
 *
 * Never put the `service_role` key here — that one bypasses RLS.
 *
 * Fill these in after creating your Supabase project:
 *   Supabase dashboard -> Project Settings -> Data API
 *
 * Leave them blank and FitTrack still works — it just runs local-only,
 * exactly as it did before, with no sign-in and no sync.
 */
window.FT_CONFIG = {
  SUPABASE_URL: 'https://ijhuqfszjjfbxfhvjisy.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_GgFjGqVb2-CZWpFlsU9fjw_kascBL9I',

  /* Where the app is deployed, with no trailing slash — e.g.
   * 'https://hvo7.github.io/FitTrack'.
   *
   * Setting this makes the Electron desktop app load the deployed build
   * instead of its bundled copy, so pushing to GitHub updates your desktop
   * app too, with no reinstall. Leave blank to always run the bundled copy.
   */
  APP_URL: 'https://hvo7.github.io/FitTrack',
};
