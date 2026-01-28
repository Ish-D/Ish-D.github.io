/**
 * Crypto utilities for encrypting/decrypting private cards
 * Uses Web Crypto API with AES-256-GCM
 *
 * Security model:
 * - Password never stored anywhere (only in user's memory)
 * - Salt stored in file (not secret, prevents rainbow tables)
 * - IV stored in file (not secret, ensures unique ciphertext)
 * - PBKDF2 with 100,000 iterations for key derivation
 * - AES-256-GCM for authenticated encryption
 */

export class CardCrypto {
    constructor() {
        this.cachedPassword = null;
        this.sessionKey = 'paper-cards-session-auth';
    }

    /**
     * Get cached password from sessionStorage
     * Password is only cached for the browser session
     */
    getCachedPassword() {
        if (this.cachedPassword) return this.cachedPassword;
        try {
            return sessionStorage.getItem(this.sessionKey);
        } catch (e) {
            return null;
        }
    }

    /**
     * Cache password for the session
     * Cleared when browser tab/window is closed
     */
    cachePassword(password) {
        this.cachedPassword = password;
        try {
            sessionStorage.setItem(this.sessionKey, password);
        } catch (e) {
            // sessionStorage not available, only keep in memory
        }
    }

    /**
     * Clear cached password
     */
    clearPassword() {
        this.cachedPassword = null;
        try {
            sessionStorage.removeItem(this.sessionKey);
        } catch (e) {
            // Ignore
        }
    }

    /**
     * Check if user is authenticated (has cached password)
     */
    isAuthenticated() {
        return this.getCachedPassword() !== null;
    }

    /**
     * Derive encryption key from password and salt using PBKDF2
     */
    async deriveKey(password, salt) {
        const encoder = new TextEncoder();
        const keyMaterial = await crypto.subtle.importKey(
            'raw',
            encoder.encode(password),
            'PBKDF2',
            false,
            ['deriveKey']
        );

        return crypto.subtle.deriveKey(
            {
                name: 'PBKDF2',
                salt: salt,
                iterations: 100000,
                hash: 'SHA-256'
            },
            keyMaterial,
            { name: 'AES-GCM', length: 256 },
            false,
            ['encrypt', 'decrypt']
        );
    }

    /**
     * Encrypt content with password
     * Returns object with salt, iv, and ciphertext (all base64 encoded)
     */
    async encrypt(content, password) {
        const salt = crypto.getRandomValues(new Uint8Array(16));
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const key = await this.deriveKey(password, salt);

        const encoder = new TextEncoder();
        const encrypted = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv: iv },
            key,
            encoder.encode(content)
        );

        return {
            salt: this.arrayToBase64(salt),
            iv: this.arrayToBase64(iv),
            ciphertext: this.arrayToBase64(new Uint8Array(encrypted))
        };
    }

    /**
     * Decrypt content with password
     * Throws error if password is wrong or data is corrupted
     */
    async decrypt(encryptedData, password) {
        const salt = this.base64ToArray(encryptedData.salt);
        const iv = this.base64ToArray(encryptedData.iv);
        const ciphertext = this.base64ToArray(encryptedData.ciphertext);

        const key = await this.deriveKey(password, salt);

        try {
            const decrypted = await crypto.subtle.decrypt(
                { name: 'AES-GCM', iv: iv },
                key,
                ciphertext
            );

            const decoder = new TextDecoder();
            return decoder.decode(decrypted);
        } catch (e) {
            throw new Error('Decryption failed - wrong password or corrupted data');
        }
    }

    /**
     * Helper: Uint8Array to base64 string
     */
    arrayToBase64(array) {
        let binary = '';
        for (let i = 0; i < array.length; i++) {
            binary += String.fromCharCode(array[i]);
        }
        return btoa(binary);
    }

    /**
     * Helper: base64 string to Uint8Array
     */
    base64ToArray(base64) {
        const binary = atob(base64);
        const array = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            array[i] = binary.charCodeAt(i);
        }
        return array;
    }
}
