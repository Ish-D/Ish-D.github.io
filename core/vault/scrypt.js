/**
 * scrypt (RFC 7914) in plain JS. WebCrypto has PBKDF2 but no memory-hard KDF,
 * and a memory-hard one is what keeps an offline attack on the vault slow.
 * The two PBKDF2 steps use WebCrypto; the mixing is done here.
 */

const subtle = globalThis.crypto.subtle;

async function pbkdf2Sha256(password, salt, bytes) {
    const key = await subtle.importKey('raw', password, 'PBKDF2', false, ['deriveBits']);
    const bits = await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 1 }, key, bytes * 8);
    return new Uint8Array(bits);
}

const rotl = (a, b) => (a << b) | (a >>> (32 - b));

/** Salsa20/8 core on 16 words, in place. */
function salsa8(b, x) {
    for (let i = 0; i < 16; i++) x[i] = b[i];
    for (let i = 0; i < 4; i++) {
        x[4] ^= rotl(x[0] + x[12] | 0, 7);  x[8] ^= rotl(x[4] + x[0] | 0, 9);
        x[12] ^= rotl(x[8] + x[4] | 0, 13); x[0] ^= rotl(x[12] + x[8] | 0, 18);
        x[9] ^= rotl(x[5] + x[1] | 0, 7);   x[13] ^= rotl(x[9] + x[5] | 0, 9);
        x[1] ^= rotl(x[13] + x[9] | 0, 13); x[5] ^= rotl(x[1] + x[13] | 0, 18);
        x[14] ^= rotl(x[10] + x[6] | 0, 7); x[2] ^= rotl(x[14] + x[10] | 0, 9);
        x[6] ^= rotl(x[2] + x[14] | 0, 13); x[10] ^= rotl(x[6] + x[2] | 0, 18);
        x[3] ^= rotl(x[15] + x[11] | 0, 7); x[7] ^= rotl(x[3] + x[15] | 0, 9);
        x[11] ^= rotl(x[7] + x[3] | 0, 13); x[15] ^= rotl(x[11] + x[7] | 0, 18);
        x[1] ^= rotl(x[0] + x[3] | 0, 7);   x[2] ^= rotl(x[1] + x[0] | 0, 9);
        x[3] ^= rotl(x[2] + x[1] | 0, 13);  x[0] ^= rotl(x[3] + x[2] | 0, 18);
        x[6] ^= rotl(x[5] + x[4] | 0, 7);   x[7] ^= rotl(x[6] + x[5] | 0, 9);
        x[4] ^= rotl(x[7] + x[6] | 0, 13);  x[5] ^= rotl(x[4] + x[7] | 0, 18);
        x[11] ^= rotl(x[10] + x[9] | 0, 7); x[8] ^= rotl(x[11] + x[10] | 0, 9);
        x[9] ^= rotl(x[8] + x[11] | 0, 13); x[10] ^= rotl(x[9] + x[8] | 0, 18);
        x[12] ^= rotl(x[15] + x[14] | 0, 7); x[13] ^= rotl(x[12] + x[15] | 0, 9);
        x[14] ^= rotl(x[13] + x[12] | 0, 13); x[15] ^= rotl(x[14] + x[13] | 0, 18);
    }
    for (let i = 0; i < 16; i++) b[i] = (b[i] + x[i]) | 0;
}

/** BlockMix over 2r 64-byte blocks (32r words); `y` and `x` are scratch. */
function blockMix(B, Bi, Y, r, x, tmp) {
    const words = 32 * r;
    for (let i = 0; i < 16; i++) tmp[i] = B[Bi + words - 16 + i];
    for (let i = 0; i < 2 * r; i++) {
        for (let j = 0; j < 16; j++) tmp[j] ^= B[Bi + i * 16 + j];
        salsa8(tmp, x);
        const dest = (i & 1) === 0 ? (i >> 1) * 16 : (r + (i >> 1)) * 16;
        for (let j = 0; j < 16; j++) Y[dest + j] = tmp[j];
    }
    for (let i = 0; i < words; i++) B[Bi + i] = Y[i];
}

const tick = () => new Promise(resolve => setTimeout(resolve, 0));

async function roMix(B, Bi, N, r, onProgress) {
    const words = 32 * r;
    const V = new Uint32Array(words * N);
    const Y = new Uint32Array(words);
    const x = new Uint32Array(16);
    const tmp = new Uint32Array(16);
    const slice = Math.max(1, N >> 5);
    for (let i = 0; i < N; i++) {
        for (let k = 0; k < words; k++) V[i * words + k] = B[Bi + k];
        blockMix(B, Bi, Y, r, x, tmp);
        if (i % slice === slice - 1) { onProgress?.(i / (2 * N)); await tick(); }
    }
    for (let i = 0; i < N; i++) {
        const j = B[Bi + words - 16] & (N - 1);
        for (let k = 0; k < words; k++) B[Bi + k] ^= V[j * words + k];
        blockMix(B, Bi, Y, r, x, tmp);
        if (i % slice === slice - 1) { onProgress?.(0.5 + i / (2 * N)); await tick(); }
    }
}

/**
 * @param {Uint8Array} password
 * @param {Uint8Array} salt
 * @param {{ N: number, r: number, p: number, dkLen: number, onProgress?: (fraction: number) => void }} params
 */
export async function scrypt(password, salt, { N, r, p, dkLen, onProgress }) {
    if (N < 2 || (N & (N - 1)) !== 0) throw new Error('scrypt: N must be a power of two');
    const blockBytes = 128 * r;
    const B = await pbkdf2Sha256(password, salt, p * blockBytes);
    const words = new Uint32Array(B.buffer, B.byteOffset, B.byteLength / 4);
    for (let i = 0; i < p; i++) {
        await roMix(words, i * 32 * r, N, r, onProgress ? (f) => onProgress((i + f) / p) : undefined);
    }
    return pbkdf2Sha256(password, B, dkLen);
}
