/** A short message at the bottom of the screen. */
export function showToast(document, text, ms = 4500) {
    document.querySelector('.toast')?.remove();
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = text;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), ms);
}
