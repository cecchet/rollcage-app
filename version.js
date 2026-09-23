// Single source of truth for the build number shown in the header and in
// the PDF report's cover page -- YYYY-MM-DD-NN, NN resetting to 01 each day
// and incrementing only if a second release actually goes out the same day.
// No build step in this project (see app.js's own top-of-file comment), so
// this can't be generated automatically -- bump it by hand in the same
// commit as every push, the same convention the sibling PassTech project
// uses for its own BUILD_DATE (src/lib/version.ts).
window.BUILD_NUMBER = "2026-09-23-04";
