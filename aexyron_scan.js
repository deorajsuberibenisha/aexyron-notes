// Aexyron scan helpers for the web build: fast image preparation with the
// browser's own canvas, and text reading with Tesseract (loaded on first use).
(function () {
  const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
  let workerPromise = null;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (window.Tesseract) return resolve();
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('Could not load the text reader. Check the internet connection the first time.'));
      document.head.appendChild(s);
    });
  }

  async function worker() {
    if (!workerPromise) {
      workerPromise = (async () => {
        await loadScript(TESSERACT_URL);
        return window.Tesseract.createWorker('eng');
      })();
      workerPromise.catch(() => { workerPromise = null; });
    }
    return workerPromise;
  }

  // Resize to at most maxSide, rotate by quarter turns, optionally give it a
  // clean "document" look, and return a JPEG with its pixel size.
  // Otsu's method: the grey level that best separates ink from paper.
  function otsu(hist, total) {
    let sum = 0;
    for (let i = 0; i < 256; i++) sum += i * hist[i];
    let sumB = 0, wB = 0, best = 0, threshold = 160;
    for (let t = 0; t < 256; t++) {
      wB += hist[t];
      if (!wB) continue;
      const wF = total - wB;
      if (!wF) break;
      sumB += t * hist[t];
      const mB = sumB / wB, mF = (sum - sumB) / wF;
      const between = wB * wF * (mB - mF) * (mB - mF);
      if (between > best) { best = between; threshold = t; }
    }
    return threshold;
  }

  // Crisp black-and-white: even out lighting with a blurred copy of the page,
  // then split ink from paper.
  function blackWhite(ctx, w, h) {
    const bg = document.createElement('canvas');
    bg.width = w; bg.height = h;
    const bctx = bg.getContext('2d');
    bctx.filter = `grayscale(1) blur(${Math.max(8, Math.round(Math.max(w, h) / 60))}px)`;
    bctx.drawImage(ctx.canvas, 0, 0);
    const page = ctx.getImageData(0, 0, w, h), light = bctx.getImageData(0, 0, w, h);
    const p = page.data, l = light.data, n = w * h, norm = new Uint8ClampedArray(n), hist = new Uint32Array(256);
    for (let i = 0, j = 0; j < n; i += 4, j++) {
      const g = 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2];
      const v = Math.min(255, Math.round((g / Math.max(1, l[i])) * 235));
      norm[j] = v; hist[v]++;
    }
    const t = Math.min(225, otsu(hist, n) + 12);
    for (let i = 0, j = 0; j < n; i += 4, j++) {
      const v = norm[j] > t ? 255 : Math.max(0, norm[j] - 40);
      p[i] = p[i + 1] = p[i + 2] = v;
    }
    ctx.putImageData(page, 0, 0);
  }

  const FILTERS = {
    original: 'none',
    vivid: 'contrast(1.18) saturate(1.22) brightness(1.08)',
    grey: 'grayscale(1) contrast(1.3) brightness(1.08)',
    blackWhite: 'none',
  };

  async function prepare(bytes, maxSide, quarterTurns, look) {
    const blob = new Blob([bytes]);
    const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
    const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * k), h = Math.round(bmp.height * k);
    const turns = ((quarterTurns % 4) + 4) % 4;
    const cw = turns % 2 ? h : w, ch = turns % 2 ? w : h;
    const canvas = document.createElement('canvas');
    canvas.width = cw; canvas.height = ch;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, cw, ch);
    ctx.filter = FILTERS[look] || 'none';
    ctx.translate(cw / 2, ch / 2);
    ctx.rotate(turns * Math.PI / 2);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, -w / 2, -h / 2, w, h);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.filter = 'none';
    bmp.close && bmp.close();
    if (look === 'blackWhite') blackWhite(ctx, cw, ch);
    const out = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', look === 'blackWhite' ? 0.8 : 0.86));
    return { jpeg: new Uint8Array(await out.arrayBuffer()), width: cw, height: ch };
  }

  async function recognize(jpegBytes) {
    const w = await worker();
    const url = URL.createObjectURL(new Blob([jpegBytes], { type: 'image/jpeg' }));
    try {
      const { data } = await w.recognize(url, {}, { blocks: true });
      const words = [];
      for (const b of data.blocks || []) {
        for (const p of b.paragraphs || []) {
          for (const l of p.lines || []) {
            for (const wd of l.words || []) {
              if (!wd.text || !wd.text.trim()) continue;
              words.push({ t: wd.text, x0: wd.bbox.x0, y0: wd.bbox.y0, x1: wd.bbox.x1, y1: wd.bbox.y1 });
            }
          }
        }
      }
      return JSON.stringify(words);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  window.aexyronScan = { prepare, recognize };
})();
