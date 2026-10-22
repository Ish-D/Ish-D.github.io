const plain = (nodes) => nodes.map(n => n.value ?? (n.children ? plain(n.children) : '')).join('');

/** What a page is called: the name in its front matter, else the words of its first heading. */
export function titleOf(doc) {
    const named = doc.frontmatter?.entries?.name?.value;
    if (named) return named;
    const heading = doc.children.find(b => b.type === 'heading');
    return heading ? plain(heading.children).trim() : '';
}
