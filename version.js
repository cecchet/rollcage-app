// Single source of truth for the build number shown in the header and in
// the PDF report's cover page -- YYYY/MM/DD-N: the date and that day's
// deployment number, like PassTech's BUILD_DATE (src/lib/version.ts). Set on
// every commit by tools/bump-version.mjs (the pre-commit hook that
// tools/install-hooks.mjs installs) -- not by hand.
window.BUILD_NUMBER = "2026/10/23-1";
