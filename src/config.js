// Globals shared across extension contexts. Plain script (no ES modules) so it
// can be loaded by both background scripts and HTML pages.

// Toggles the experimental triangle classifier (parallel analysis + reports-page
// widget). Safe to flip off — no other code path depends on it.
var BON_TRIANGLE_ENABLED = true;
