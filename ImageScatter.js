/**
 * ImageScatter.js — Scatter an image across n cards
 *
 * Takes a single image and distributes it across n rectangular cards.
 * Cards are placed at random positions with random rotations and shuffled
 * z-indices. Each card shows only the portion of the image visible "through"
 * it, accounting for occlusion by higher-z cards. Together, all cards
 * reconstruct the complete image with no gaps or overlaps.
 */

// Cache loaded images to avoid re-fetching on repeated calls
const imageCache = new Map();

function loadImage(src) {
    if (imageCache.has(src)) return Promise.resolve(imageCache.get(src));
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => { imageCache.set(src, img); resolve(img); };
        img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
        img.src = src;
    });
}

function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

/**
 * Check whether a rotated card overlaps [0,imgW] x [0,imgH] using SAT.
 */
function cardOverlapsImage(cx, cy, cw, ch, rotDeg, imgW, imgH) {
    const rad = rotDeg * Math.PI / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const hw = cw / 2, hh = ch / 2;

    const cardCorners = [
        { x: cx - hw * cos + hh * sin, y: cy - hw * sin - hh * cos },
        { x: cx + hw * cos + hh * sin, y: cy + hw * sin - hh * cos },
        { x: cx + hw * cos - hh * sin, y: cy + hw * sin + hh * cos },
        { x: cx - hw * cos - hh * sin, y: cy - hw * sin + hh * cos },
    ];

    const axes = [
        { x: 1, y: 0 }, { x: 0, y: 1 },
        { x: cos, y: sin }, { x: -sin, y: cos },
    ];

    for (const axis of axes) {
        let minA = Infinity, maxA = -Infinity;
        let minB = Infinity, maxB = -Infinity;
        for (const c of cardCorners) {
            const p = c.x * axis.x + c.y * axis.y;
            if (p < minA) minA = p;
            if (p > maxA) maxA = p;
        }
        // Image corners projected: just need min/max of {0,imgW}*ax + {0,imgH}*ay
        const p0 = 0;
        const p1 = imgW * axis.x;
        const p2 = imgH * axis.y;
        const p3 = p1 + p2;
        minB = Math.min(p0, p1, p2, p3);
        maxB = Math.max(p0, p1, p2, p3);
        if (maxA < minB || maxB < minA) return false;
    }
    return true;
}

/**
 * Generate stratified random placements with coverage guarantee.
 * Uses a single reusable coverage canvas for all attempts.
 */
function generatePlacements(n, imgW, imgH, cardW, cardH) {
    const maxAttempts = 60;
    // Reuse one canvas for all coverage checks
    const coverageCanvas = document.createElement('canvas');
    coverageCanvas.width = imgW;
    coverageCanvas.height = imgH;
    const coverageCtx = coverageCanvas.getContext('2d');

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const scaleFactor = 1 + attempt * 0.03;
        const cw = cardW * scaleFactor;
        const ch = cardH * scaleFactor;

        const cols = Math.ceil(Math.sqrt(n * imgW / imgH));
        const rows = Math.ceil(n / cols);
        const cellW = imgW / cols;
        const cellH = imgH / rows;

        const cards = [];
        const zIndices = shuffle(Array.from({ length: n }, (_, i) => i + 1));
        const cellIndices = Array.from({ length: cols * rows }, (_, i) => i);
        shuffle(cellIndices);

        let valid = true;
        for (let i = 0; i < n; i++) {
            const cellIdx = cellIndices[i % cellIndices.length];
            const col = cellIdx % cols;
            const row = Math.floor(cellIdx / cols);
            // Spread wider horizontally than vertically: pieces fan into the side
            // space without making the collage taller.
            const jitterX = (Math.random() - 0.5) * cellW * 1.2;
            const jitterY = (Math.random() - 0.5) * cellH * 0.6;
            const cx = (col + 0.5) * cellW + jitterX;
            const cy = (row + 0.5) * cellH + jitterY;
            const rotation = Math.random() * 360;

            if (!cardOverlapsImage(cx, cy, cw, ch, rotation, imgW, imgH)) {
                valid = false;
                break;
            }
            cards.push({ cx, cy, rotation, zIndex: zIndices[i], width: cw, height: ch });
        }
        if (!valid) continue;

        // Verify full coverage — reuse canvas, just clear it
        coverageCtx.clearRect(0, 0, imgW, imgH);
        for (const card of cards) {
            coverageCtx.save();
            coverageCtx.translate(card.cx, card.cy);
            coverageCtx.rotate(card.rotation * Math.PI / 180);
            coverageCtx.fillStyle = 'white';
            coverageCtx.fillRect(-card.width / 2, -card.height / 2, card.width, card.height);
            coverageCtx.restore();
        }

        const data = coverageCtx.getImageData(0, 0, imgW, imgH).data;
        let covered = true;
        for (let i = 3; i < data.length; i += 4) {
            if (data[i] === 0) { covered = false; break; }
        }
        if (covered) return cards;
    }

    // Fallback
    const cols = Math.ceil(Math.sqrt(n * imgW / imgH));
    const rows = Math.ceil(n / cols);
    const cellW = imgW / cols;
    const cellH = imgH / rows;
    const diagonal = Math.sqrt(cellW * cellW + cellH * cellH);
    const cw = Math.max(cardW, diagonal * 1.3);
    const ch = Math.max(cardH, diagonal * 1.3);
    const zIndices = shuffle(Array.from({ length: n }, (_, i) => i + 1));
    return Array.from({ length: n }, (_, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        return {
            cx: (col + 0.5) * cellW + (Math.random() - 0.5) * cellW * 0.3,
            cy: (row + 0.5) * cellH + (Math.random() - 0.5) * cellH * 0.3,
            rotation: Math.random() * 360,
            zIndex: zIndices[i], width: cw, height: ch,
        };
    });
}

/**
 * Render per-card images with occlusion awareness.
 * Optimized: reuses canvases, single getImageData pass for seam fix.
 */
async function renderCards(imageCanvas, cards, imgW, imgH) {
    const sorted = cards
        .map((c, i) => ({ ...c, originalIndex: i }))
        .sort((a, b) => b.zIndex - a.zIndex);

    // Padded source image: 1px transparent border prevents outer edge artifact
    const pad = 1;
    const paddedW = imgW + pad * 2;
    const paddedH = imgH + pad * 2;
    const paddedCanvas = document.createElement('canvas');
    paddedCanvas.width = paddedW;
    paddedCanvas.height = paddedH;
    paddedCanvas.getContext('2d').drawImage(imageCanvas, pad, pad);

    // Claimed mask
    const claimedCanvas = document.createElement('canvas');
    claimedCanvas.width = paddedW;
    claimedCanvas.height = paddedH;
    const claimedCtx = claimedCanvas.getContext('2d');

    // Reuse a single card canvas (resize as needed)
    const cardCanvas = document.createElement('canvas');
    const results = new Array(cards.length);

    for (const card of sorted) {
        const { cx, cy, width: cw, height: ch, rotation, originalIndex } = card;
        const rad = rotation * Math.PI / 180;
        const canvasW = Math.ceil(cw);
        const canvasH = Math.ceil(ch);

        // Resize reusable canvas
        cardCanvas.width = canvasW;
        cardCanvas.height = canvasH;
        const cardCtx = cardCanvas.getContext('2d');

        // Draw padded image
        cardCtx.save();
        cardCtx.translate(canvasW / 2, canvasH / 2);
        cardCtx.rotate(-rad);
        cardCtx.translate(-cx - pad, -cy - pad);
        cardCtx.drawImage(paddedCanvas, 0, 0);
        cardCtx.restore();

        // Snapshot solid mask from alpha channel
        const preData = cardCtx.getImageData(0, 0, canvasW, canvasH);
        const preAlpha = preData.data;

        // Build solid mask as a typed array (1 = was fully opaque image pixel)
        const pixelCount = canvasW * canvasH;
        const solidMask = new Uint8Array(pixelCount);
        for (let i = 0; i < pixelCount; i++) {
            solidMask[i] = preAlpha[i * 4 + 3] === 255 ? 1 : 0;
        }

        // Subtract claimed regions
        cardCtx.save();
        cardCtx.globalCompositeOperation = 'destination-out';
        cardCtx.translate(canvasW / 2, canvasH / 2);
        cardCtx.rotate(-rad);
        cardCtx.translate(-cx - pad, -cy - pad);
        cardCtx.drawImage(claimedCanvas, 0, 0);
        cardCtx.restore();

        // Fix seams: snap semi-transparent pixels that were solid back to opaque
        const postData = cardCtx.getImageData(0, 0, canvasW, canvasH);
        const pd = postData.data;
        for (let i = 0; i < pixelCount; i++) {
            const ai = i * 4 + 3;
            if (solidMask[i] && pd[ai] > 0 && pd[ai] < 255) {
                pd[ai] = 255;
            }
        }
        cardCtx.putImageData(postData, 0, 0);

        // Mark footprint as claimed
        claimedCtx.save();
        claimedCtx.translate(cx + pad, cy + pad);
        claimedCtx.rotate(rad);
        claimedCtx.fillStyle = 'white';
        claimedCtx.fillRect(-cw / 2, -ch / 2, cw, ch);
        claimedCtx.restore();

        // Use blob URL instead of data URL — much faster than PNG base64 encoding
        results[originalIndex] = { canvas: document.createElement('canvas') };
        results[originalIndex].canvas.width = canvasW;
        results[originalIndex].canvas.height = canvasH;
        results[originalIndex].canvas.getContext('2d').putImageData(postData, 0, 0);
    }

    // Convert all canvases to blob URLs in parallel
    await Promise.all(sorted.map(card => {
        const idx = card.originalIndex;
        return new Promise(resolve => {
            results[idx].canvas.toBlob(blob => {
                results[idx].dataUrl = URL.createObjectURL(blob);
                results[idx].canvas = null; // free memory
                resolve();
            }, 'image/png');
        });
    }));

    return results;
}

/**
 * Main entry point: scatter an image across n cards.
 */
export async function scatterImage(imageSrc, n, finalWidth, finalHeight = 0, centerX, centerY) {
    const img = await loadImage(imageSrc);

    const aspect = img.naturalWidth / img.naturalHeight;
    if (!finalHeight) finalHeight = Math.round(finalWidth / aspect);

    // Draw image to source canvas at final size
    const imageCanvas = document.createElement('canvas');
    imageCanvas.width = finalWidth;
    imageCanvas.height = finalHeight;
    imageCanvas.getContext('2d').drawImage(img, 0, 0, finalWidth, finalHeight);

    const maxDim = Math.max(finalWidth, finalHeight);
    const cardSize = Math.round(maxDim / Math.sqrt(n) * 1.6);

    const placements = generatePlacements(n, finalWidth, finalHeight, cardSize, cardSize);
    const rendered = await renderCards(imageCanvas, placements, finalWidth, finalHeight);

    if (centerX === undefined) centerX = finalWidth / 2 + 100;
    if (centerY === undefined) centerY = finalHeight / 2 + 100;
    const imgOriginX = centerX - finalWidth / 2;
    const imgOriginY = centerY - finalHeight / 2;

    return placements.map((card, i) => ({
        x: imgOriginX + card.cx - card.width / 2,
        y: imgOriginY + card.cy - card.height / 2,
        width: card.width,
        height: card.height,
        rotation: card.rotation,
        zIndex: card.zIndex,
        dataUrl: rendered[i].dataUrl,
    }));
}
