/**
 * sprite_tools.js
 * ============================================================================
 * Turn any character art into rig-ready sprite frames:
 * - decode a turnaround GIF (WebCodecs ImageDecoder) or load PNG images
 * - remove a solid / studio background (border flood fill)
 * - crop every frame to the same box and scale to a common height
 * - pack frames into a sprite sheet + atlas JSON (the format the game loads)
 *
 * Frames everywhere are { index, angleDeg, canvas, imageData, width, height }:
 * angleDeg 0 = facing the viewer, 90 = facing right, 180 = facing away.
 */

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Could not load image ${src}`));
    image.src = src;
  });
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** Draws any CanvasImageSource into a new ImageData (optionally scaled). */
export function toImageData(source, width = source.width, height = source.height) {
  const c = makeCanvas(width, height);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height);
}

/** True when the image already has a transparent background (checks the border). */
export function hasTransparentBorder(imageData) {
  const { width: w, height: h, data } = imageData;
  let transparent = 0, total = 0;
  const check = (x, y) => {
    total++;
    if (data[(y * w + x) * 4 + 3] < 250) transparent++;
  };
  for (let x = 0; x < w; x++) { check(x, 0); check(x, h - 1); }
  for (let y = 0; y < h; y++) { check(0, y); check(w - 1, y); }
  return transparent / total > 0.5;
}

/**
 * Removes a background that touches the image border: the background color is the median
 * of the border pixels, and every border-connected pixel within `tolerance` of it is cleared.
 */
export function keyBorderColor(imageData, { tolerance = 38 } = {}) {
  const { width: w, height: h } = imageData;
  const src = imageData.data;
  const dst = new Uint8ClampedArray(src);

  const border = [];
  for (let x = 0; x < w; x += 2) border.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y += 2) border.push(y * w, y * w + w - 1);
  const median = (c) => {
    const vals = border.map(i => src[i * 4 + c]).sort((a, b) => a - b);
    return vals[vals.length >> 1];
  };
  const bg = [median(0), median(1), median(2)];
  const tol2 = tolerance * tolerance;
  const isBg = (i) => {
    const p = i * 4;
    if (src[p + 3] < 20) return true;
    const dr = src[p] - bg[0], dg = src[p + 1] - bg[1], db = src[p + 2] - bg[2];
    return dr * dr + dg * dg + db * db <= tol2;
  };

  const visited = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  let head = 0, tail = 0;
  const push = (i) => {
    if (!visited[i] && isBg(i)) { visited[i] = 1; queue[tail++] = i; }
  };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (head < tail) {
    const cur = queue[head++];
    const cx = cur % w;
    if (cur >= w) push(cur - w);
    if (cur < w * (h - 1)) push(cur + w);
    if (cx > 0) push(cur - 1);
    if (cx < w - 1) push(cur + 1);
  }

  for (let i = 0; i < w * h; i++) {
    if (visited[i]) {
      dst[i * 4 + 3] = 0;
    } else {
      // soften the outline: pixels touching the background get partial alpha
      const x = i % w;
      const n = (x > 0 && visited[i - 1]) + (x < w - 1 && visited[i + 1]) +
        (i >= w && visited[i - w]) + (i < w * (h - 1) && visited[i + w]);
      if (n > 0) dst[i * 4 + 3] = Math.min(dst[i * 4 + 3], 255 - n * 50);
    }
  }
  return new ImageData(dst, w, h);
}

/**
 * Clears what background removal left behind (dither specks, floor shadows, stray marks):
 * keeps the largest blob of opaque pixels (the character) plus blobs that are at least
 * `minFraction` of its size and lie close to it (e.g. a hand or weapon not touching the body).
 */
export function removeSpecks(imageData, { minFraction = 0.003, minPixels = 30, near = 0.15, threshold = 40 } = {}) {
  const { width: w, height: h } = imageData;
  const data = new Uint8ClampedArray(imageData.data);
  const comp = new Int32Array(w * h).fill(-1);
  const blobs = [];
  const stack = new Int32Array(w * h);
  for (let start = 0; start < w * h; start++) {
    if (comp[start] >= 0 || data[start * 4 + 3] <= threshold) continue;
    const id = blobs.length;
    const blob = { size: 0, x0: w, y0: h, x1: 0, y1: 0 };
    let sp = 0;
    stack[sp++] = start;
    comp[start] = id;
    while (sp > 0) {
      const cur = stack[--sp];
      const cx = cur % w, cy = (cur / w) | 0;
      blob.size++;
      if (cx < blob.x0) blob.x0 = cx;
      if (cx > blob.x1) blob.x1 = cx;
      if (cy < blob.y0) blob.y0 = cy;
      if (cy > blob.y1) blob.y1 = cy;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = cy + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = cx + dx;
          if (nx < 0 || nx >= w) continue;
          const ni = ny * w + nx;
          if (comp[ni] < 0 && data[ni * 4 + 3] > threshold) { comp[ni] = id; stack[sp++] = ni; }
        }
      }
    }
    blobs.push(blob);
  }
  if (!blobs.length) return imageData;

  const main = blobs.reduce((a, b) => (b.size > a.size ? b : a));
  const mx = (main.x1 - main.x0) * near, my = (main.y1 - main.y0) * near;
  // a separate part (floating hand, weapon) must lie inside the character's box, grown a little
  const keep = blobs.map((b) => b === main || (
    b.size >= Math.max(minPixels, main.size * minFraction) &&
    b.x0 >= main.x0 - mx && b.x1 <= main.x1 + mx && b.y0 >= main.y0 - my && b.y1 <= main.y1 + my
  ));
  for (let i = 0; i < w * h; i++) {
    if (comp[i] >= 0 && !keep[comp[i]]) data[i * 4 + 3] = 0;
  }
  return new ImageData(data, w, h);
}

/**
 * Removes a smooth background (gradient, vignette, soft floor shadow) touching the border
 * (or, with fromTransparent, touching the already-erased area):
 * the background grows from the border into neighbouring pixels while the color changes by at
 * most `step` per pixel, and stays within `maxDist` of the median border color. Sharp
 * character outlines stop it. Decisions use a median-filtered copy so GIF dithering doesn't matter.
 */
export function keySmoothBackground(imageData, { step = 7, maxDist = 110, fromTransparent = false } = {}) {
  const { width: w, height: h } = imageData;
  const src = imageData.data;
  const n = w * h;
  // 3x3 median of each color channel: removes GIF dithering / noise but keeps outlines sharp
  // (a blur would soften the outline of a grey character against a grey background)
  const median3 = (c) => {
    const out = new Uint8Array(n);
    const v = new Uint8Array(9);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let k = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy < 0 ? 0 : y + dy >= h ? h - 1 : y + dy;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx < 0 ? 0 : x + dx >= w ? w - 1 : x + dx;
            v[k++] = src[(yy * w + xx) * 4 + c];
          }
        }
        v.sort();
        out[y * w + x] = v[4];
      }
    }
    return out;
  };
  const R = median3(0), G = median3(1), B = median3(2);
  const border = [];
  for (let x = 0; x < w; x += 2) border.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y += 2) border.push(y * w, y * w + w - 1);
  const med = (arr) => { const v = border.map((i) => arr[i]).sort((p, q) => p - q); return v[v.length >> 1]; };
  const bgR = med(R), bgG = med(G), bgB = med(B);
  const max2 = fromTransparent ? Infinity : maxDist * maxDist;
  const nearBg = (i) => {
    const dr = R[i] - bgR, dg = G[i] - bgG, db = B[i] - bgB;
    return dr * dr + dg * dg + db * db <= max2;
  };

  const visited = new Uint8Array(n);
  const queue = new Int32Array(n);
  let head = 0, tail = 0;
  const seed = (i) => { if (!visited[i] && nearBg(i)) { visited[i] = 1; queue[tail++] = i; } };
  if (fromTransparent) {
    // grow from what is already erased (e.g. outside a border the user drew); erased pixels
    // keep their color, so the growth knows what the background around the character looked like
    for (let i = 0; i < n; i++) if (src[i * 4 + 3] < 20) { visited[i] = 1; queue[tail++] = i; }
  } else {
    for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
    for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1); }
  }
  const grow = (cur, nb) => {
    if (visited[nb]) return;
    if (Math.abs(R[nb] - R[cur]) > step || Math.abs(G[nb] - G[cur]) > step || Math.abs(B[nb] - B[cur]) > step) return;
    if (!nearBg(nb)) return;
    visited[nb] = 1;
    queue[tail++] = nb;
  };
  while (head < tail) {
    const cur = queue[head++];
    const cx = cur % w;
    if (cur >= w) grow(cur, cur - w);
    if (cur < n - w) grow(cur, cur + w);
    if (cx > 0) grow(cur, cur - 1);
    if (cx < w - 1) grow(cur, cur + 1);
  }

  const dst = new Uint8ClampedArray(src);
  for (let i = 0; i < n; i++) {
    if (visited[i]) {
      dst[i * 4 + 3] = 0;
    } else {
      const x = i % w;
      const k = (x > 0 && visited[i - 1]) + (x < w - 1 && visited[i + 1]) +
        (i >= w && visited[i - w]) + (i < n - w && visited[i + w]);
      if (k > 0) dst[i * 4 + 3] = Math.min(dst[i * 4 + 3], 255 - k * 50);
    }
  }
  return new ImageData(dst, w, h);
}

function alphaBounds(imageData, threshold = 40) {
  const { width: w, height: h, data } = imageData;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > threshold) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}

/**
 * Keys, crops and scales raw frames so they share one box (the turntable axis stays put).
 * @param raws        [{ imageData, angleDeg }]
 * @param keying      'auto' (keep transparency, else remove a smooth / gradient background) |
 *                    'border' (one solid color) | 'none' | function(imageData) -> imageData
 * @param targetHeight output frame height in pixels (character + padding)
 */
export function prepareFrames(raws, { keying = 'auto', tolerance = 38, targetHeight = 335, padding = 0.04, mirror = false, despeckle = true } = {}) {
  const keyed = raws.map(({ imageData }) => {
    let k;
    if (typeof keying === 'function') k = keying(imageData);
    else if (keying === 'none' || (keying === 'auto' && hasTransparentBorder(imageData))) k = imageData;
    else if (keying === 'border') k = keyBorderColor(imageData, { tolerance });
    else k = keySmoothBackground(imageData, { step: tolerance / 7.6, maxDist: tolerance * 3 });
    return despeckle ? removeSpecks(k) : k;
  });

  let box = null;
  for (const k of keyed) {
    const b = alphaBounds(k);
    if (!b) continue;
    box = box
      ? { x0: Math.min(box.x0, b.x0), y0: Math.min(box.y0, b.y0), x1: Math.max(box.x1, b.x1), y1: Math.max(box.y1, b.y1) }
      : b;
  }
  if (!box) throw new Error('No character pixels found (is the background removed?)');

  const bw = box.x1 - box.x0 + 1;
  const bh = box.y1 - box.y0 + 1;
  const pad = Math.round(Math.max(bw, bh) * padding);
  const cropX = box.x0 - pad, cropY = box.y0 - pad;
  const cropW = bw + pad * 2, cropH = bh + pad * 2;
  const scale = targetHeight / cropH;
  const outW = Math.max(8, Math.round(cropW * scale));
  const outH = targetHeight;

  const place = (img) => {
    const tmp = makeCanvas(img.width, img.height);
    tmp.getContext('2d').putImageData(img, 0, 0);
    const c = makeCanvas(outW, outH);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingQuality = 'high';
    if (mirror) {
      ctx.translate(outW, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(tmp, cropX, cropY, cropW, cropH, 0, 0, outW, outH);
    return { canvas: c, imageData: ctx.getImageData(0, 0, outW, outH) };
  };
  return keyed.map((k, i) => {
    const { canvas, imageData } = place(k);
    return {
      index: i,
      angleDeg: raws[i].angleDeg,
      canvas,
      imageData,
      // the same crop before background removal: lets editors restore wrongly removed pixels
      raw: place(raws[i].imageData).imageData.data,
      width: outW,
      height: outH
    };
  });
}

/**
 * Decodes evenly spaced frames of a turntable GIF.
 * @param source    Blob or URL
 * @param coverage  180 when the GIF turns front -> back once, 360 for a full turn
 *                  (only the first half is used; the other side is mirrored at runtime)
 * @param backFrame optional GIF frame index where the character faces away (overrides coverage)
 */
export async function decodeGifFrames(source, { frameCount = 36, coverage = 360, backFrame = null, maxSide = 900 } = {}) {
  if (!('ImageDecoder' in window)) {
    throw new Error('GIF decoding needs the WebCodecs ImageDecoder API (Chrome / Edge). Export PNG frames instead.');
  }
  const blob = source instanceof Blob ? source : await fetch(source).then(r => r.blob());
  const decoder = new ImageDecoder({ data: blob.stream(), type: blob.type || 'image/gif' });
  await decoder.tracks.ready;
  await decoder.completed; // frameCount is only final once the whole file is parsed
  const total = decoder.tracks.selectedTrack.frameCount;
  // backFrame: GIF frame index where the character faces away (180°), if the turn isn't exact
  const lastUsed = Math.min(total - 1, backFrame ?? (coverage === 360 ? Math.floor(total / 2) : total - 1));
  const count = Math.max(1, Math.min(frameCount, lastUsed + 1));

  const raws = [];
  for (let i = 0; i < count; i++) {
    const frameIndex = count === 1 ? 0 : Math.round((i / (count - 1)) * lastUsed);
    const { image } = await decoder.decode({ frameIndex });
    const s = Math.min(1, maxSide / Math.max(image.displayWidth, image.displayHeight));
    raws.push({
      imageData: toImageData(image, Math.round(image.displayWidth * s), Math.round(image.displayHeight * s)),
      angleDeg: count === 1 ? 0 : (i / (count - 1)) * 180
    });
    image.close();
  }
  decoder.close();
  return raws;
}

/**
 * Loads image files / URLs as raw frames. With several images they are spread evenly
 * from 0° (front) to 180° (back); a single image gets `singleAngle` (0 = front, 90 = side).
 */
export async function loadImageFrames(sources, { singleAngle = 0, maxSide = 900 } = {}) {
  const raws = [];
  for (let i = 0; i < sources.length; i++) {
    const src = sources[i] instanceof Blob ? URL.createObjectURL(sources[i]) : sources[i];
    const img = await loadImage(src);
    const s = Math.min(1, maxSide / Math.max(img.width, img.height));
    raws.push({
      imageData: toImageData(img, Math.round(img.width * s), Math.round(img.height * s)),
      angleDeg: sources.length === 1 ? singleAngle : (i / (sources.length - 1)) * 180
    });
  }
  return raws;
}

/**
 * Slices a sprite sheet image with its atlas into frames. An optional labels sheet (same layout,
 * body-part id in the red channel, see buildLabelSheet) restores hand-painted body parts.
 */
export function framesFromSheet(sheetImage, atlas, labelsImage = null) {
  return atlas.frames.map((meta, i) => {
    const c = makeCanvas(meta.w, meta.h);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(sheetImage, meta.x, meta.y, meta.w, meta.h, 0, 0, meta.w, meta.h);
    const frame = {
      ...meta,
      index: meta.index ?? i,
      angleDeg: meta.angleDeg ?? (atlas.frames.length === 1 ? 0 : (i / (atlas.frames.length - 1)) * 180),
      canvas: c,
      imageData: ctx.getImageData(0, 0, meta.w, meta.h),
      width: meta.w,
      height: meta.h
    };
    if (labelsImage) {
      const lc = makeCanvas(meta.w, meta.h);
      const lctx = lc.getContext('2d', { willReadFrequently: true });
      lctx.drawImage(labelsImage, meta.x, meta.y, meta.w, meta.h, 0, 0, meta.w, meta.h);
      const d = lctx.getImageData(0, 0, meta.w, meta.h).data;
      const ov = new Uint8Array(meta.w * meta.h);
      let any = false;
      for (let k = 0; k < ov.length; k++) {
        if (d[k * 4 + 3] > 128 && d[k * 4]) { ov[k] = d[k * 4]; any = true; }
      }
      if (any) frame.labelOverride = ov;
    }
    return frame;
  });
}

/** Packs frames' hand-painted body parts (frame.labelOverride) into a PNG with the sheet layout. */
export function buildLabelSheet(frames, atlas) {
  if (!frames.some((f) => f.labelOverride)) return null;
  const sheet = makeCanvas(atlas.cellWidth * atlas.cols, atlas.cellHeight * atlas.rows);
  const ctx = sheet.getContext('2d');
  frames.forEach((f, i) => {
    if (!f.labelOverride) return;
    const img = new ImageData(f.width, f.height);
    f.labelOverride.forEach((l, k) => {
      if (!l) return;
      img.data[k * 4] = l;
      img.data[k * 4 + 3] = 255;
    });
    ctx.putImageData(img, atlas.frames[i].x, atlas.frames[i].y);
  });
  return sheet;
}

/** Packs frames into one sprite sheet canvas and an atlas (same format as knight_atlas.json). */
export function buildSpriteSheet(frames, { cols = 6, source = 'editor' } = {}) {
  const cw = frames[0].width, ch = frames[0].height;
  const columns = Math.min(cols, frames.length);
  const rows = Math.ceil(frames.length / columns);
  const sheet = makeCanvas(cw * columns, ch * rows);
  const ctx = sheet.getContext('2d');
  const atlas = { source, cellWidth: cw, cellHeight: ch, cols: columns, rows, totalFrames: frames.length, frames: [] };
  frames.forEach((f, i) => {
    const x = (i % columns) * cw, y = Math.floor(i / columns) * ch;
    ctx.drawImage(f.canvas, x, y);
    atlas.frames.push({ index: i, angleDeg: Math.round(f.angleDeg * 100) / 100, x, y, w: cw, h: ch });
  });
  return { canvas: sheet, atlas };
}
