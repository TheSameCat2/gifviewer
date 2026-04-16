/**
 * Client-safe blurhash utilities for decoding and rendering placeholders.
 */

/**
 * Decodes a blurhash back to pixel data for rendering.
 */
export function decodeBlurhash(
  hash: string,
  width: number,
  height: number
): Uint8ClampedArray {
  const parts = hash.split(",");
  const componentsX = parseInt(parts[0], 10);
  const componentsY = parseInt(parts[1], 10);
  const values: number[] = [];

  for (let i = 0; i < parts[2].length; i += 6) {
    values.push(parseInt(parts[2].slice(i, i + 2), 16));
    values.push(parseInt(parts[2].slice(i + 2, i + 4), 16));
    values.push(parseInt(parts[2].slice(i + 4, i + 6), 16));
  }

  const pixels = new Uint8ClampedArray(width * height * 4);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0;

      let idx = 0;
      for (let cy = 0; cy < componentsY; cy++) {
        for (let cx = 0; cx < componentsX; cx++) {
          const basis = Math.cos((Math.PI * cx * x) / width) * Math.cos((Math.PI * cy * y) / height);
          r += values[idx++] * basis;
          g += values[idx++] * basis;
          b += values[idx++] * basis;
        }
      }

      const pixelIdx = (y * width + x) * 4;
      pixels[pixelIdx] = Math.min(255, Math.max(0, Math.round(r)));
      pixels[pixelIdx + 1] = Math.min(255, Math.max(0, Math.round(g)));
      pixels[pixelIdx + 2] = Math.min(255, Math.max(0, Math.round(b)));
      pixels[pixelIdx + 3] = 255;
    }
  }

  return pixels;
}

/**
 * Generates a placeholder data URL from a blurhash.
 */
export function blurhashToDataUrl(hash: string, width = 32, height = 32): string {
  const pixels = decodeBlurhash(hash, width, height);

  // Create a small version for the data URL
  const scale = Math.min(1, 32 / Math.max(width, height));
  const svgWidth = Math.round(width * scale);
  const svgHeight = Math.round(height * scale);

  const rects: string[] = [];
  const px = Math.max(1, Math.floor(1 / scale));
  const py = Math.max(1, Math.floor(1 / scale));

  for (let y = 0; y < svgHeight; y++) {
    for (let x = 0; x < svgWidth; x++) {
      const srcX = Math.min(x * px, width - 1);
      const srcY = Math.min(y * py, height - 1);
      const idx = (srcY * width + srcX) * 4;
      const r = pixels[idx];
      const g = pixels[idx + 1];
      const b = pixels[idx + 2];
      rects.push(`<rect x="${x}" y="${y}" width="1" height="1" fill="rgb(${r},${g},${b})"/>`);
    }
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgWidth} ${svgHeight}" width="${width}" height="${height}">${rects.join("")}</svg>`;
  
  // Convert to data URL
  return `data:image/svg+xml;base64,${typeof btoa !== 'undefined' ? btoa(svg) : Buffer.from(svg).toString('base64')}`;
}
