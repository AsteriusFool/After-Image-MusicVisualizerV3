'use strict';

/**
 * Extracts a small usable color palette from an album-art image URL by
 * sampling its pixels on an offscreen canvas — the standard canvas
 * pixel-reading technique, no dependency, no server round trip. Spotify's
 * album art CDN serves images with `Access-Control-Allow-Origin: *`
 * (verified against a real cover URL), so `crossOrigin = 'anonymous'`
 * loads cleanly and getImageData() never throws a tainted-canvas error.
 */

const SAMPLE_SIZE = 48; // downscale target — plenty for a palette, cheap to read

/** Fallback palette used before any album art has loaded, or if extraction fails. */
export const DEFAULT_PALETTE = {
  colorA: [0.45, 0.0, 1.0],
  colorB: [0.0, 0.75, 1.0],
  colorC: [1.0, 0.35, 0.6],
};

function rgbToHsl(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  return [0, s, l]; // hue isn't used by the caller — skip computing it
}

/**
 * Loads `url` and resolves to { colorA, colorB, colorC, image } — the first
 * three as 0-1 RGB triples (colorA the image's overall average tone, colorB
 * its most saturated pixel, colorC its brightest colorful pixel), `image`
 * the loaded <img> element itself so a caller that also wants to display the
 * artwork (e.g. as a texture) doesn't need a second network fetch for it.
 * Resolves to `{ ...DEFAULT_PALETTE, image: null }` if the image fails to
 * load, or if the art turns out nearly grayscale (a flat monochrome cover
 * would otherwise produce a lifeless, colorless gradient). Never rejects.
 */
export function extractPaletteFromImage(url) {
  return new Promise(resolve => {
    if (!url) { resolve({ ...DEFAULT_PALETTE, image: null }); return; }

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onerror = () => resolve({ ...DEFAULT_PALETTE, image: null });
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = SAMPLE_SIZE;
        canvas.height = SAMPLE_SIZE;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
        const { data } = ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE);

        let sumR = 0, sumG = 0, sumB = 0, count = 0;
        let bestSat = -1, satR = 0, satG = 0, satB = 0;
        let bestLight = -1, lightR = 0, lightG = 0, lightB = 0;
        let totalSat = 0;

        for (let i = 0; i < data.length; i += 4) {
          const r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255;
          sumR += r; sumG += g; sumB += b; count++;

          const [, s, l] = rgbToHsl(r, g, b);
          totalSat += s;
          if (s > bestSat && l > 0.12 && l < 0.92) { bestSat = s; satR = r; satG = g; satB = b; }
          if (l > bestLight && s > 0.08) { bestLight = l; lightR = r; lightG = g; lightB = b; }
        }

        if (count === 0 || totalSat / count < 0.06 || bestSat < 0) {
          // Near-grayscale cover — fall back on color, but the image itself
          // still loaded fine, so still hand it back for the visual.
          resolve({ ...DEFAULT_PALETTE, image: img });
          return;
        }

        resolve({
          colorA: [sumR / count, sumG / count, sumB / count],
          colorB: [satR, satG, satB],
          colorC: bestLight > 0 ? [lightR, lightG, lightB] : [satR, satG, satB],
          image: img,
        });
      } catch (err) {
        console.error('[album-color] palette extraction failed:', err.message);
        resolve({ ...DEFAULT_PALETTE, image: null });
      }
    };
    img.src = url;
  });
}
