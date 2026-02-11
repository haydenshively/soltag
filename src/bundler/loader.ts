/**
 * Standalone webpack loader for soltag. Compatible with Turbopack via
 * `turbopack.rules` in next.config.js.
 *
 * Usage (next.config.js):
 * ```js
 * module.exports = {
 *   turbopack: {
 *     rules: {
 *       '*.ts': { loaders: [{ loader: 'soltag/loader' }] },
 *       '*.tsx': { loaders: [{ loader: 'soltag/loader' }] },
 *     },
 *   },
 * };
 * ```
 */

import type { SoltagPluginOptions } from "./unplugin.js";
import { transformSolTemplates } from "./unplugin.js";

interface LoaderContext {
  resourcePath: string;
  callback: (err: Error | null, content?: string, sourceMap?: unknown) => void;
  getOptions: () => SoltagPluginOptions;
}

export default function soltagLoader(this: LoaderContext, source: string) {
  const options = this.getOptions();
  const result = transformSolTemplates(source, this.resourcePath, options);

  if (!result) {
    this.callback(null, source);
    return;
  }

  this.callback(null, result.code, result.map);
}
