// The bridge to the website's compositions (src/website/registry.tsx). Their "./runtime" import is
// pointed at src/engine.ts, which exposes the same names on Remotion; "@/" is the website's src; and
// the two icon packages they use resolve from this package (the website's own node_modules may not be
// installed). Exact aliases only: putting this package's node_modules first for every import made
// Remotion load an older zod. Remotion already pins React.
// Used by builders/website-assets.mjs and remotion.config.ts (Studio).
const { join, resolve } = require("node:path");
const { realpathSync } = require("node:fs");

const PKG = resolve(__dirname, "..");
const SITE = resolve(PKG, "..", "..", "apps", "website-next", "src");
// The package folder itself (iconoir-react does not export ./package.json, so no require.resolve).
const own = (m) => realpathSync(join(PKG, "node_modules", m));

function websiteBridge(config) {
  return {
    ...config,
    resolve: {
      ...config.resolve,
      alias: {
        ...(config.resolve && config.resolve.alias),
        [join(SITE, "motion", "runtime")]: join(PKG, "src", "engine.ts"),
        "@": SITE,
        "iconoir-react": own("iconoir-react"),
        "simple-icons": own("simple-icons"),
      },
    },
  };
}

module.exports = { websiteBridge, SITE };
