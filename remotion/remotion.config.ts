// See all configuration options: https://remotion.dev/docs/config
// Each option also is available as a CLI flag: https://remotion.dev/docs/cli

import { Config } from "@remotion/cli/config";

Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);

// This environment's egress proxy blocks Remotion's own Chrome Headless Shell
// download (remotion.media is not allowlisted), but a Chromium is pre-installed.
// Point Remotion at it so `studio`/`render` work without downloading a browser.
// Override with REMOTION_BROWSER_EXECUTABLE if your Chromium lives elsewhere.
// Use the standalone headless shell: Remotion launches Chrome in the old
// headless mode, which the full Chrome binary has removed but the
// chrome-headless-shell / headless_shell build still implements.
const browserExecutable =
  process.env.REMOTION_BROWSER_EXECUTABLE ??
  "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell";

if (browserExecutable) {
  Config.setBrowserExecutable(browserExecutable);
}
