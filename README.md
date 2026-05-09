# Paper Mini Generator

In-browser tool that turns uploaded artwork into print-ready PDFs of foldable D&D paper miniatures.

**Live: https://garritfra.github.io/printableminimaker/**

## What it does

- Upload artwork (PNG, JPG, or WebP), pick a D&D size category, set a count.
- Add as many entries as you like.
- Generate a multi-page A4 or Letter PDF, packed greedily by size.
- Each mini renders as a fold-over rectangle: front image, dotted fold line, back image (rotated 180°), and matching tabs that double up under the base when folded.

Everything runs client-side. No uploads leave your browser.

## D&D base sizes

| Size       | Base width |
| ---------- | ---------- |
| Tiny       | 12.5 mm    |
| Small      | 25 mm      |
| Medium     | 25 mm      |
| Large      | 50 mm      |
| Huge       | 75 mm      |
| Gargantuan | 100 mm     |

Image height follows the source aspect ratio.

## Run locally

```bash
npm install
npm run dev      # local preview at http://localhost:5173
npm run build    # static site in dist/
```

The built `dist/` is a plain static bundle — host it anywhere (GitHub Pages, Cloudflare Pages, `file://`, whatever).

## Stack

Vanilla TypeScript, Vite, [pdf-lib](https://pdf-lib.js.org/). Cut and fold lines are vector PDF paths; uploaded images are embedded once and placed by reference.

## Scope

See [SPEC.md](./SPEC.md) for the v1 spec, including what's deliberately left out (URL paste, background removal, separate front/back artwork).

## License

[MIT](./LICENSE)
