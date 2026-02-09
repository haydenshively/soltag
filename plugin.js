// Fallback entry point for TS plugin resolution.
// tsconfig.json: "plugins": [{ "name": "soltag/plugin" }]
// If subpath exports aren't resolved, users can point to "soltag/plugin.js" instead.
module.exports = require('./dist/plugin.cjs');
