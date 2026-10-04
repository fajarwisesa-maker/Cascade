# CASCADE Remotion environment

A [Remotion](https://remotion.dev) (v4.0.532) setup for creating videos
programmatically with React. Self-contained in this `remotion/` directory,
separate from the Python engine and the `web/` test project.

## Install

```bash
cd remotion
npm install
```

## Commands

```bash
npm run studio     # open the Remotion Studio (interactive preview/editor)
npm run render     # render a composition, e.g.:
npx remotion render src/index.ts HelloWorld out/hello.mp4
npm run build      # bundle the project for programmatic rendering
npm run upgrade    # upgrade all Remotion packages together
```

## Project layout

- `src/index.ts` — entry point; calls `registerRoot`.
- `src/Root.tsx` — registers compositions with `<Composition />`.
- `src/HelloWorld.tsx` — example composition.
- `remotion.config.ts` — CLI configuration.

## Browser note (this environment)

Remotion normally downloads its own Chrome Headless Shell on first render.
In this sandbox the download host (`remotion.media`) is blocked by the egress
proxy, so `remotion.config.ts` points Remotion at the pre-installed Chromium
headless shell instead:

```
/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell
```

The full `chrome` binary will not work here because Remotion launches Chrome
in the old headless mode, which the full binary has removed; the
`headless_shell` build still implements it. Override the path for another
machine with the `REMOTION_BROWSER_EXECUTABLE` environment variable, or delete
that block in `remotion.config.ts` to let Remotion download its own browser
where network access allows it.
