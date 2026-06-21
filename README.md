# Tearable Art

An elegant, single-page layered artwork. Visitors drag across the surface to tear away the current layer and reveal the artwork underneath.

## Files

- `index.html` contains the page structure and small overlay UI.
- `styles.css` controls typography, layout, and the minimal interface.
- `script.js` builds the WebGL paper scene and handles mouse/touch tearing.
- `assets/layers/` is where your final art images should go.

## Replacing the Placeholder Art

1. Add your five image files to `assets/layers/`.

   Recommended formats: `.jpg`, `.png`, or `.webp`.

2. Name them:

   - `layer-01.jpeg`
   - `layer-02.jpeg`
   - `layer-03.jpeg`
   - `layer-04.jpeg`
   - `layer-05.jpeg`

The site is already wired to use those filenames. If a file is missing, that layer falls back to its CSS/canvas placeholder.

3. If you want different filenames, open `script.js`.

4. Find the `layerSources` list near the top of the file.

5. Replace the image paths:

   ```js
   const layerSources = [
     { image: "assets/layers/layer-01.jpg", name: "Layer 1" },
     { image: "assets/layers/layer-02.jpg", name: "Layer 2" },
     { image: "assets/layers/layer-03.jpg", name: "Layer 3" },
     { image: "assets/layers/layer-04.jpg", name: "Layer 4" },
     { image: "assets/layers/layer-05.jpg", name: "Layer 5" },
   ];
   ```

The first item in the list is the top layer. The fifth item is the deepest layer.

Images are automatically scaled to fit fully inside the screen without cropping. Square or portrait images will show a quiet matte around the artwork. For crisp results, use images at least `1600px` wide.

## Running Locally

Serve the folder with any simple local server. The page imports Three.js as an ES module, so a local server is more reliable than opening the file directly.

For example:

```bash
python3 -m http.server 8000
```

Then visit `http://localhost:8000`.

## Notes

The tear effect uses Three.js planes, canvas-generated layer textures, alpha masks, mesh deformation, and a small spring simulation. The pointer pulls a softened tear head through the current layer while a lifted texture-mapped flap, WebGL lighting, shadows, torn masks, and paper grain create depth.
