/**
 * MarkdownParser - Parses markdown with custom DSL for styling and layout
 *
 * ============================================
 * DSL SYNTAX REFERENCE (Unified C++ Attribute Style)
 * ============================================
 *
 * BLOCKS
 * ------
 * [[type(params)]]
 * {
 * content
 * }
 *
 * Block Types:
 *   margin(side, type: absolute|relative, orient: vertical|horizontal, size: pixels, anchor: id, pos: pixels)
 *   center
 *   style(css properties separated by semicolons)
 *   image(src, scale: percentage, fit: cover|contain|fill, align: left|center|right, caption: text)
 *   quote(author, anchor: id) - Styled blockquote with optional author attribution
 *   code(language, anchor: id) - Syntax-highlighted code block using Prism.js
 *
 * Margin Parameters:
 *   side      - left, right, top, bottom (first positional param)
 *   type      - absolute (fixed position) or relative (scroll with content)
 *   orient    - vertical or horizontal text direction
 *   size      - max height/width in pixels
 *   anchor    - id of anchor point to position relative to
 *   pos       - offset from start of margin area in pixels (absolute margins only)
 *
 * Examples:
 *   [[margin(left, type: absolute, orient: vertical)]]
 *   {
 *   Margin content here
 *   }
 *
 *   [[center]]
 *   {
 *   Centered content
 *   }
 *
 *   [[style(background: #eee; padding: 12px)]]
 *   {
 *   Styled paragraph
 *   }
 *
 *   [[image(cards/images/photo.jpg, scale: 75%, fit: cover, align: center, caption: Photo caption)]]
 *   {
 *   Optional detailed caption text that appears below the image and supports markdown
 *   }
 *
 * INTERACTIVE ELEMENTS
 * --------------------
 * [[toggle(bind: setting, on: value, off: value, label: text)]]
 * [[slider(bind: setting, min: n, max: n, step: n, label: text, suffix: text)]]
 * [[button(action: functionName, label: text)]]
 *
 * Examples:
 *   [[toggle(bind: theme, on: dark, off: light, label: Dark Mode)]]
 *   [[slider(bind: fontSize, min: 12, max: 22, step: 1, label: Font Size, suffix: px)]]
 *   [[button(action: resetSettings, label: Reset to Defaults)]]
 *
 * VISUALIZATIONS
 * --------------
 * [[viz(type: name, params...)]]
 *
 * Visualization Types:
 *   polynomial    - 2D polynomial curve with interactive sliders
 *   polynomial3d  - 3D polynomial surface with interactive sliders
 *   surface       - 3D surface plot z = f(x,y)
 *   curve3d       - 3D parametric curve
 *   nodegraph3d   - 3D force-directed node graph
 *   model         - 3D model viewer (GLTF/GLB)
 *
 * Sizing Parameters (all types):
 *   size          - tiny|small|medium|large|full (preset sizes)
 *   width         - explicit width in pixels or percentage
 *   height        - explicit height in pixels or percentage
 *   display       - inline|float-left|float-right (display mode)
 *   align         - left|center|right (block alignment)
 *
 * Model Parameters:
 *   src           - URL or path to GLTF/GLB model (required)
 *   scale         - Scale factor (default: auto-fit)
 *   autorotate    - Enable rotation (default: true for tiny/small)
 *   speed         - Rotation speed multiplier (default: 1)
 *   background    - "transparent", "theme", or hex color
 *   zoom          - Enable zoom controls (default: false for tiny/small)
 *   pan           - Enable pan controls (default: false for tiny/small)
 *
 * Examples:
 *   [[viz(type: polynomial, a2: 1, a1: 0, a0: -1)]]
 *   [[viz(type: surface, fn: "sin(x)*cos(y)", size: medium)]]
 *   [[viz(type: curve3d, x: "cos(t)", y: "sin(t)", z: "t/5", display: inline, size: small)]]
 *   [[viz(type: polynomial3d, a: 0.5, b: 0.5, width: 300, height: 350)]]
 *   [[viz(type: model, src: "model.glb", size: small, display: inline)]]
 *   [[viz(type: model, src: "https://example.com/model.glb", autorotate: true, speed: 2)]]
 *
 * INLINE ELEMENTS
 * ---------------
 * [[style(css)]]{text}           - Styled text
 * [[link(card, options)]]        - Card link with options
 * [[card]] or [[card|display]]   - Shorthand card links
 * [[anchor(id)]]{text}           - Anchor point
 * [[jump(target-id)]]            - Jump to anchor (uses target-id as display)
 * [[jump(target-id)]]{text}      - Jump to anchor with custom display text
 * [[cite(url)]]                  - Citation with auto-numbered superscript
 * [[cite(url, title)]]           - Citation with custom title
 * [[bibliography]]               - Auto-generated bibliography from citations
 *
 * Examples:
 *   [[style(color: red; font-weight: bold)]]{important text}
 *   [[link(About, display: "Read more", size: 300x400)]]
 *   [[About]] or [[About|Click here]]
 *   [[anchor(section1)]]{Section 1}
 *   [[jump(section1)]] or [[jump(section1)]]{Go to Section 1}
 *   [[cite(https://example.com)]] or [[cite(https://example.com, Example Site)]]
 *   [[bibliography]]
 *
 * STANDARD MARKDOWN
 * -----------------
 * # H1, ## H2, ### H3            - Headings
 * **bold**, *italic*             - Text formatting
 * [text](url)                    - External links
 * ![alt](url)                    - Images
 * `code`, ```code block```       - Code
 * > blockquote                   - Blockquotes
 * - item, * item                 - Unordered lists
 * 1. item                        - Ordered lists
 * ---                            - Horizontal rule
 * ->text<-                       - Centered paragraph
 *
 * CSS PROPERTIES ALLOWED
 * ----------------------
 * font-size, font-weight, font-style, font-family
 * color, background, background-color
 * text-align, text-decoration, text-transform
 * letter-spacing, line-height, word-spacing
 * margin, padding (and directional variants)
 * border, border-radius (and variants)
 * opacity, width, height (and min/max variants)
 * box-shadow, text-shadow, text-indent
 * vertical-align, white-space, overflow
 */

export class MarkdownParser {
    constructor() {
        // Front matter (non-global, only matches at start)
        this.frontMatterPattern = /^---\s*([\s\S]*?)---/;

        // Citation tracking for bibliography
        this.citations = new Map(); // URL -> { number, title, count, sourceIds: [] }

        // Unified counter for all references (citations + jumps)
        this.unifiedCounter = 0;

        // Track which numbers are assigned to each anchor (for jumps)
        // anchorId -> [{number, sourceId}, ...] (multiple jumps can point to same anchor)
        this.anchorJumps = new Map();

        // Track which jump index we're on when processing (to match discovery order)
        this.jumpIndexTracker = new Map();

        // Track which citation index we're on when processing (for multiple occurrences of same URL)
        this.citationIndexTracker = new Map();
    }

    // Factory methods for regex patterns - creates fresh instances to avoid global state issues
    getBlockPattern() {
        // Block pattern: [[type(params)]] { content } where } is on its own line
        return /\[\[(\w+)(?:\(([^)]*)\))?\]\]\s*\{[ \t]*\n([\s\S]*?)\n[ \t]*\}/g;
    }

    getInlineStylePattern() {
        // Inline style: [[style(css)]]{text}
        return /\[\[style\(([^)]+)\)\]\]\{([^}]*)\}/g;
    }

    getFullLinkPattern() {
        // Full link: [[link(card, params)]]
        return /\[\[link\(([^,)]+)(?:,\s*([^)]*))?\)\]\]/g;
    }

    getShortLinkPattern() {
        // Shorthand link: [[Card]] or [[Card|display]]
        // Must not match [[type(...)]] patterns
        return /\[\[([^\]|()\n]+)(?:\|([^\]]+))?\]\]/g;
    }

    getAnchorPattern() {
        // Anchor: [[anchor(id)]]{text}
        return /\[\[anchor\(([^)]+)\)\]\]\{([^}]*)\}/g;
    }

    getJumpPattern() {
        // Jump link: [[jump(target-id)]] or [[jump(target-id)]]{display text}
        return /\[\[jump\(([^)]+)\)\]\](?:\{([^}]*)\})?/g;
    }

    // Interactive element patterns
    getTogglePattern() {
        return /\[\[toggle\(([^)]+)\)\]\]/g;
    }

    getSliderPattern() {
        return /\[\[slider\(([^)]+)\)\]\]/g;
    }

    getButtonPattern() {
        return /\[\[button\(([^)]+)\)\]\]/g;
    }

    getInputPattern() {
        return /\[\[input\(([^)]+)\)\]\]/g;
    }

    getTextareaPattern() {
        return /\[\[textarea\(([^)]+)\)\]\]/g;
    }

    getVizPattern() {
        // Visualization: [[viz(type: name, param1: value, ...)]]
        // Use .+? (non-greedy) to handle nested parentheses in function expressions like sqrt(x*x + y*y)
        return /\[\[viz\((.+?)\)\]\]/g;
    }

    getTagsPattern() {
        return /\[\[tags\]\]/g;
    }

    getEmbedPattern() {
        // Embeddable content blocks: {{name}}
        return /\{\{(\w+)\}\}/g;
    }

    getCitePattern() {
        // Citation: [[cite(url)]] or [[cite(url, title)]] or [[cite(url)]]{text}
        return /\[\[cite\(([^,)]+)(?:,\s*([^)]*))?\)\]\](?:\{([^}]*)\})?/g;
    }

    getBibliographyPattern() {
        // Bibliography placeholder: [[bibliography]]
        return /\[\[bibliography\]\]/g;
    }

    /**
     * Find the matching closing brace for an opening brace, accounting for nested braces.
     * This solves the problem where code blocks contain braces like `function() { }`
     * which would otherwise confuse the simple regex-based extraction.
     * @param {string} text - The text to search in
     * @param {number} openBraceIndex - Index of the opening brace
     * @returns {number} Index of the matching closing brace, or -1 if not found
     */
    findMatchingBrace(text, openBraceIndex) {
        let braceCount = 1;
        let i = openBraceIndex + 1;

        while (i < text.length && braceCount > 0) {
            if (text[i] === '{') {
                braceCount++;
            } else if (text[i] === '}') {
                braceCount--;
            }
            i++;
        }

        return braceCount === 0 ? i - 1 : -1;
    }

    /**
     * Find the matching closing parenthesis for an opening parenthesis, accounting for nested parens.
     * @param {string} text - The text to search in
     * @param {number} openParenIndex - Index of the opening parenthesis
     * @returns {number} Index of the matching closing parenthesis, or -1 if not found
     */
    findMatchingParen(text, openParenIndex) {
        let parenCount = 1;
        let i = openParenIndex + 1;

        while (i < text.length && parenCount > 0) {
            if (text[i] === '(') {
                parenCount++;
            } else if (text[i] === ')') {
                parenCount--;
            }
            i++;
        }

        return parenCount === 0 ? i - 1 : -1;
    }

    /**
     * Extract all blocks from markdown using brace counting for correct nesting.
     * Returns blocks in document order with their positions for index-based replacement.
     * @param {string} markdown - The markdown text to extract blocks from
     * @returns {Array} Array of {type, params, content, fullMatch, startIndex, endIndex}
     */
    extractAllBlocks(markdown) {
        const blocks = [];
        // Pattern to find block type starts: [[type
        const blockTypePattern = /\[\[(\w+)/g;

        let match;
        while ((match = blockTypePattern.exec(markdown)) !== null) {
            const type = match[1];
            const typeEndIndex = match.index + match[0].length;

            let params = '';
            let headerEndIndex = typeEndIndex;

            // Check if there are parameters (next char is '(')
            if (markdown[typeEndIndex] === '(') {
                // Find matching closing paren using counting
                const closeParenIndex = this.findMatchingParen(markdown, typeEndIndex);
                if (closeParenIndex === -1) {
                    continue; // Malformed, skip
                }
                params = markdown.slice(typeEndIndex + 1, closeParenIndex);
                headerEndIndex = closeParenIndex + 1;
            }

            // Now expect ]] followed by optional whitespace and { with newline (block syntax)
            // This distinguishes from inline syntax like [[style(css)]]{text}
            const afterParams = markdown.slice(headerEndIndex);
            const closeBracketMatch = afterParams.match(/^\]\]\s*\{[ \t]*\n/);
            if (!closeBracketMatch) {
                continue; // Not a block syntax (might be inline), skip
            }

            const openBraceIndex = headerEndIndex + closeBracketMatch[0].indexOf('{');

            // Find the matching closing brace using brace counting
            const closeBraceIndex = this.findMatchingBrace(markdown, openBraceIndex);

            if (closeBraceIndex === -1) {
                // No matching brace found, skip this block
                continue;
            }

            // Extract content between braces (excluding the braces themselves)
            // The content starts after { and any trailing whitespace/newline
            let contentStart = openBraceIndex + 1;
            // Skip optional whitespace and newline after opening brace
            if (markdown[contentStart] === ' ' || markdown[contentStart] === '\t') {
                while (contentStart < closeBraceIndex && (markdown[contentStart] === ' ' || markdown[contentStart] === '\t')) {
                    contentStart++;
                }
            }
            if (markdown[contentStart] === '\n') {
                contentStart++;
            }

            // Content ends before } and any preceding whitespace/newline
            let contentEnd = closeBraceIndex;
            // Skip back over optional whitespace and newline before closing brace
            if (contentEnd > contentStart && markdown[contentEnd - 1] === '\n') {
                contentEnd--;
            }
            while (contentEnd > contentStart && (markdown[contentEnd - 1] === ' ' || markdown[contentEnd - 1] === '\t')) {
                contentEnd--;
            }

            const content = markdown.slice(contentStart, contentEnd);
            const fullMatch = markdown.slice(match.index, closeBraceIndex + 1);

            blocks.push({
                type: type,
                params: params,
                content: content,
                fullMatch: fullMatch,
                startIndex: match.index,
                endIndex: closeBraceIndex + 1
            });

            // Move past this block to avoid re-matching nested blocks at the outer level
            // We don't update lastIndex because we want to find ALL blocks including nested ones
        }

        return blocks;
    }

    /**
     * Get LaTeX patterns for inline and display math
     */
    getInlineMathPattern() {
        // Inline math: $...$ (simpler pattern without lookbehind)
        // This will match single $ pairs, we'll filter out double $ in processing
        return /\$([^$\n]+?)\$/g;
    }

    getDisplayMathPattern() {
        // Display math: $$...$$ (multiline allowed)
        return /\$\$([^]*?)\$\$/g;
    }

    /**
     * Get the next jump index for a given target ID.
     * Used during rendering to match jumps to their pre-assigned numbers.
     */
    getNextJumpIndex(targetId) {
        const current = this.jumpIndexTracker.get(targetId) || 0;
        this.jumpIndexTracker.set(targetId, current + 1);
        return current;
    }

    /**
     * Get the next citation source ID for a given URL.
     * Used during rendering to match citation occurrences to their pre-assigned source IDs.
     */
    getNextCitationSourceId(url) {
        const citation = this.citations.get(url);
        if (!citation || !citation.sourceIds) return null;

        const current = this.citationIndexTracker.get(url) || 0;
        this.citationIndexTracker.set(url, current + 1);
        return citation.sourceIds[current] || null;
    }

    /**
     * Discovery pass: Scan markdown for all jumps and citations to pre-assign unified numbers.
     * Must be called before processing anchors, jumps, and citations.
     * Each jump and citation gets a unique source ID for bidirectional navigation.
     */
    discoverReferences(markdown) {
        const jumpPattern = /\[\[jump\(([^)]+)\)\]\](?:\{([^}]*)\})?/g;
        const citePattern = /\[\[cite\(([^,)]+)(?:,\s*([^)]*))?\)\]\](?:\{([^}]*)\})?/g;

        // Collect all matches with their positions
        const matches = [];
        let m;

        while ((m = jumpPattern.exec(markdown)) !== null) {
            matches.push({ type: 'jump', targetId: m[1].trim(), index: m.index });
        }

        while ((m = citePattern.exec(markdown)) !== null) {
            matches.push({ type: 'cite', url: m[1].trim(), title: m[2]?.trim(), index: m.index });
        }

        // Sort by document position for linear numbering
        matches.sort((a, b) => a.index - b.index);

        // Assign numbers in order
        for (const item of matches) {
            if (item.type === 'jump') {
                // Each jump gets a unique number and source ID for back-navigation
                this.unifiedCounter++;
                const sourceId = `jump-ref-${this.unifiedCounter}`;
                const jumpInfo = this.anchorJumps.get(item.targetId) || [];
                jumpInfo.push({ number: this.unifiedCounter, sourceId: sourceId });
                this.anchorJumps.set(item.targetId, jumpInfo);
            } else if (item.type === 'cite') {
                // Citations reuse numbers for the same URL, but each occurrence gets a unique sourceId
                if (!this.citations.has(item.url)) {
                    this.unifiedCounter++;
                    const sourceId = `cite-ref-${this.unifiedCounter}-1`;
                    this.citations.set(item.url, {
                        number: this.unifiedCounter,
                        url: item.url,
                        title: item.title || this.extractTitleFromUrl(item.url),
                        count: 1,
                        sourceIds: [sourceId]
                    });
                } else {
                    const citation = this.citations.get(item.url);
                    citation.count++;
                    const sourceId = `cite-ref-${citation.number}-${citation.count}`;
                    citation.sourceIds.push(sourceId);
                }
            }
        }
    }

    parse(markdown) {
        // Reset all reference tracking for each document
        this.citations.clear();
        this.unifiedCounter = 0;
        this.anchorJumps.clear();
        this.jumpIndexTracker.clear();
        this.citationIndexTracker.clear();

        const result = {
            content: '',
            margins: {
                left: [],
                right: [],
                top: [],
                bottom: []
            },
            pageNumber: null,
            metadata: {}
        };

        let processedMarkdown = markdown;

        // Extract front matter
        const frontMatterMatch = processedMarkdown.match(this.frontMatterPattern);
        if (frontMatterMatch) {
            result.metadata = this.parseFrontMatter(frontMatterMatch[1]);
            processedMarkdown = processedMarkdown.replace(this.frontMatterPattern, '');
        }

        // Discovery pass: pre-assign unified numbers to all jumps and citations
        this.discoverReferences(processedMarkdown);

        // Extract margin blocks using brace counting for correct nested block handling
        const allBlocks = this.extractAllBlocks(processedMarkdown);
        const marginBlocks = [];
        let marginCounter = 0;

        // Process margin blocks only
        for (const block of allBlocks) {
            if (block.type === 'margin') {
                const marginData = this.parseMarginBlock(block.params, block.content);

                // For relative margins without explicit anchors, auto-generate one
                let autoAnchorId = null;
                if (marginData.type === 'relative' && !marginData.anchor) {
                    autoAnchorId = `__auto_margin_${marginCounter++}`;
                    marginData.anchor = autoAnchorId;
                }

                marginBlocks.push({
                    startIndex: block.startIndex,
                    endIndex: block.endIndex,
                    autoAnchor: autoAnchorId,
                    isRelative: marginData.type === 'relative'
                });

                result.margins[marginData.side].push(marginData);
            }
        }

        // Replace margin blocks in content using index-based replacement
        // Process in reverse order to maintain correct indices
        marginBlocks.sort((a, b) => b.startIndex - a.startIndex);

        for (const block of marginBlocks) {
            let replacement;
            if (block.isRelative && block.autoAnchor) {
                // Replace with placeholder that survives markdown parsing
                replacement = `__MARGIN_ANCHOR_${block.autoAnchor}__`;
            } else {
                replacement = '';
            }
            processedMarkdown = processedMarkdown.slice(0, block.startIndex) + replacement + processedMarkdown.slice(block.endIndex);
        }

        // Process remaining blocks (center, style, code, quote) in main content
        // Use placeholders to protect multi-line block HTML from parseMarkdown's paragraph splitting
        const mainBlockPlaceholders = [];
        processedMarkdown = this.processBlocks(processedMarkdown, mainBlockPlaceholders);

        // Process anchors in main content (with clickable number badges for bidirectional navigation)
        processedMarkdown = processedMarkdown.replace(
            this.getAnchorPattern(),
            (match, anchorId, text) => {
                const jumpInfos = this.anchorJumps.get(anchorId);
                if (jumpInfos && jumpInfos.length > 0) {
                    // Create clickable numbers that link back to their sources
                    const numLinks = jumpInfos.map(info =>
                        `<span class="jump-link anchor-back-link" data-jump-target="${info.sourceId}">${info.number}</span>`
                    ).join(', ');
                    return `<span data-anchor-id="${anchorId}" class="jump-anchor"><sup class="anchor-number">${numLinks}</sup>${text}</span>`;
                }
                return `<span data-anchor-id="${anchorId}">${text}</span>`;
            }
        );

        // Process [[tags]] directive with placeholder for card tags
        processedMarkdown = processedMarkdown.replace(
            this.getTagsPattern(),
            '<div class="card-tags-placeholder" data-tags-placeholder="true"></div>'
        );

        // Process {{embed}} directives with placeholders for dynamic content
        processedMarkdown = processedMarkdown.replace(
            this.getEmbedPattern(),
            '<div class="dynamic-embed" data-embed="$1"></div>'
        );

        // Parse remaining markdown to HTML
        result.content = this.parseMarkdown(processedMarkdown.trim());

        // Restore block HTML from placeholders
        result.content = this.restoreBlockPlaceholders(result.content, mainBlockPlaceholders);

        // Auto-generate bibliography at the end of main content if there are citations
        if (this.citations.size > 0) {
            const bibliography = this.generateBibliography();
            result.content += bibliography;
        }

        // Replace margin anchor placeholders with actual anchor spans
        result.content = result.content.replace(
            /__MARGIN_ANCHOR_(__auto_margin_\d+)__/g,
            '<span data-anchor-id="$1" class="margin-anchor"></span>'
        );

        return result;
    }

    /**
     * Process center, style, image, quote, and code blocks, converting them to HTML.
     * Uses brace counting for correct handling of nested braces in code blocks.
     * @param {string} markdown - The markdown to process
     * @param {Array|null} placeholders - Optional array to store HTML with placeholders.
     *   When provided, block HTML is stored here and placeholders are returned instead.
     *   This protects multi-line HTML from being mangled by parseMarkdown().
     */
    processBlocks(markdown, placeholders = null) {
        let result = markdown;
        let changed = true;

        // Process one block at a time to handle nested blocks correctly
        while (changed) {
            changed = false;

            // Extract blocks from current state
            const blocks = this.extractAllBlocks(result);

            // Find first processable block
            const block = blocks.find(b =>
                ['center', 'style', 'image', 'quote', 'code'].includes(b.type)
            );

            if (block) {
                let replacement;
                const content = block.content;
                const params = block.params;

                if (block.type === 'center') {
                    // Recursively process nested blocks in content
                    const processedContent = this.processBlocks(content, placeholders);
                    // Parse as inline markdown to handle links, bold, etc. (newlines preserved by CSS)
                    const htmlContent = this.parseInlineMarkdown(processedContent.trim());
                    replacement = `<div class="center-block">${htmlContent}</div>`;
                } else if (block.type === 'style') {
                    const sanitizedStyles = this.sanitizeStyles(params || '');
                    const processedContent = this.processBlocks(content, placeholders);
                    // Parse as inline markdown to handle links, bold, etc.
                    const htmlContent = this.parseInlineMarkdown(processedContent.trim());
                    if (!sanitizedStyles) {
                        replacement = htmlContent;
                    } else {
                        replacement = `<div class="styled-block" style="${sanitizedStyles}">${htmlContent}</div>`;
                    }
                } else if (block.type === 'image') {
                    replacement = this.renderImageBlock(params || '', content.trim());
                } else if (block.type === 'quote') {
                    // Recursively process nested blocks in quote content
                    const processedContent = this.processBlocks(content, placeholders);
                    replacement = this.renderQuoteBlock(params || '', processedContent.trim());
                } else if (block.type === 'code') {
                    // Do NOT recursively process code blocks - preserve content exactly
                    replacement = this.renderCodeBlock(params || '', content);
                } else {
                    replacement = block.fullMatch;
                }

                // If using placeholders, store HTML and use placeholder instead
                if (placeholders !== null) {
                    const placeholder = `__BLOCK_PLACEHOLDER_${placeholders.length}__`;
                    placeholders.push({ placeholder, html: replacement });
                    replacement = placeholder;
                }

                // Replace this block in result
                result = result.slice(0, block.startIndex) + replacement + result.slice(block.endIndex);
                changed = true;
            }
        }

        return result;
    }

    /**
     * Restore block placeholders with their actual HTML.
     * Handles nested placeholders by iterating until all are resolved.
     */
    restoreBlockPlaceholders(html, placeholders) {
        if (!placeholders || placeholders.length === 0) return html;

        let result = html;
        let changed = true;

        // Keep replacing until no more placeholders are found
        // This handles nested blocks where outer HTML contains inner placeholders
        while (changed) {
            changed = false;
            for (const { placeholder, html: blockHtml } of placeholders) {
                if (result.includes(placeholder)) {
                    result = result.split(placeholder).join(blockHtml);
                    changed = true;
                }
            }
        }

        return result;
    }

    /**
     * Render a quote block with optional author attribution
     * Syntax: [[quote(author: "Name", anchor: id)]] { quote text }
     */
    renderQuoteBlock(paramsStr, content) {
        const params = this.parseParams(paramsStr);

        // First positional param can be the author (for convenience)
        const author = params.named.author || params.positional[0] || '';
        const anchorId = params.named.anchor || null;

        // Process the content through markdown
        const processedContent = this.parseMarkdown(content);

        // Build the HTML
        let html = '<blockquote class="quote-block"';
        if (anchorId) {
            html += ` data-anchor-id="${anchorId}"`;
        }
        html += '>';
        html += `<div class="quote-content">${processedContent}</div>`;
        if (author) {
            // Process author through inline markdown to support links
            const processedAuthor = this.parseInlineMarkdown(author);
            html += `<footer class="quote-author">— ${processedAuthor}</footer>`;
        }
        html += '</blockquote>';

        return html;
    }

    /**
     * Render a code block with syntax highlighting
     * Syntax: [[code(language)]] { code } or [[code(lang: javascript, anchor: id)]] { code }
     */
    renderCodeBlock(paramsStr, content) {
        const params = this.parseParams(paramsStr);

        // First positional param is the language (for convenience)
        const language = params.named.lang || params.named.language || params.positional[0] || 'plaintext';
        const anchorId = params.named.anchor || null;

        // Escape HTML entities in the code
        const escapedCode = this.escapeHtml(content);

        // Build the HTML with Prism.js classes
        let html = '<div class="code-block"';
        if (anchorId) {
            html += ` data-anchor-id="${anchorId}"`;
        }
        html += '>';
        html += `<pre class="language-${language}"><code class="language-${language}">${escapedCode}</code></pre>`;
        html += '</div>';

        return html;
    }

    /**
     * Escape HTML entities for safe code display
     */
    escapeHtml(text) {
        const htmlEntities = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        };
        return text.replace(/[&<>"']/g, char => htmlEntities[char]);
    }

    /**
     * Parse margin block parameters and content
     */
    parseMarginBlock(paramsStr, content) {
        const params = this.parseParams(paramsStr);

        // First positional param is the side
        const side = params.positional[0] || 'left';
        const type = params.named.type || 'absolute';
        const orientation = params.named.orient || 'auto';
        const size = params.named.size ? parseInt(params.named.size) : null;
        const anchor = params.named.anchor || null;
        const pos = params.named.pos ? parseInt(params.named.pos) : null;

        // Resolve 'auto' orientation based on side
        let resolvedOrientation = orientation;
        if (orientation === 'auto') {
            resolvedOrientation = (side === 'left' || side === 'right') ? 'vertical' : 'horizontal';
        }

        // Process the content through the full markdown pipeline
        let processedContent = content;

        // Use placeholders to protect block HTML from parseMarkdown's paragraph splitting
        const blockPlaceholders = [];

        // Process any nested blocks (center, style, code, quote)
        processedContent = this.processBlocks(processedContent, blockPlaceholders);

        // Parse as full markdown (placeholders survive paragraph splitting)
        let html = this.parseMarkdown(processedContent);

        // Restore block HTML from placeholders
        html = this.restoreBlockPlaceholders(html, blockPlaceholders);

        return {
            side: side,
            type: type,
            orientation: resolvedOrientation,
            anchor: anchor,
            size: size,
            pos: pos,
            html: html
        };
    }

    /**
     * Parse comma-separated params with positional and named values
     * e.g., "left, type: absolute, orient: vertical" =>
     * { positional: ['left'], named: { type: 'absolute', orient: 'vertical' } }
     */
    parseParams(paramsStr) {
        const result = { positional: [], named: {} };
        if (!paramsStr || !paramsStr.trim()) return result;

        // Split by comma, respecting quoted strings
        const parts = this.splitParams(paramsStr);

        for (const part of parts) {
            const trimmed = part.trim();
            if (!trimmed) continue;

            const colonIndex = trimmed.indexOf(':');

            // Only treat as named param if:
            // 1. There's a colon
            // 2. The key part looks like a valid identifier (word chars, hyphens)
            // 3. It's not a URL pattern (colon followed by //)
            const isUrl = colonIndex !== -1 && trimmed.slice(colonIndex, colonIndex + 3) === '://';
            const potentialKey = colonIndex !== -1 ? trimmed.slice(0, colonIndex).trim() : '';
            const isValidKey = /^[\w-]+$/.test(potentialKey);

            if (colonIndex === -1 || isUrl || !isValidKey) {
                // Positional param
                result.positional.push(trimmed);
            } else {
                // Named param
                const key = potentialKey;
                let value = trimmed.slice(colonIndex + 1).trim();
                // Remove quotes if present
                if ((value.startsWith('"') && value.endsWith('"')) ||
                    (value.startsWith("'") && value.endsWith("'"))) {
                    value = value.slice(1, -1);
                }
                result.named[key] = value;
            }
        }

        return result;
    }

    /**
     * Split params by comma, respecting quoted strings
     */
    splitParams(str) {
        const parts = [];
        let current = '';
        let inQuote = false;
        let quoteChar = '';

        for (let i = 0; i < str.length; i++) {
            const char = str[i];

            if ((char === '"' || char === "'") && !inQuote) {
                inQuote = true;
                quoteChar = char;
                current += char;
            } else if (char === quoteChar && inQuote) {
                inQuote = false;
                quoteChar = '';
                current += char;
            } else if (char === ',' && !inQuote) {
                parts.push(current);
                current = '';
            } else {
                current += char;
            }
        }

        if (current) {
            parts.push(current);
        }

        return parts;
    }

    /**
     * Parse link options from params string
     */
    parseLinkOptions(paramsStr) {
        const options = {
            display: null,
            width: null,
            height: null,
            relX: null,
            relY: null,
            absX: null,
            absY: null,
            jitter: 0,
            rotation: null,
            embed: false,
            marginTB: null,  // Top/bottom margin as % of card height
            marginLR: null   // Left/right margin as % of card width
        };

        if (!paramsStr) return options;

        const params = this.parseParams(paramsStr);

        for (const [key, value] of Object.entries(params.named)) {
            if (key === 'display') {
                options.display = value;
            } else if (key === 'size') {
                const sizeMatch = value.match(/^(\d+)x(\d+)$/i);
                if (sizeMatch) {
                    options.width = parseInt(sizeMatch[1]);
                    options.height = parseInt(sizeMatch[2]);
                }
            } else if (key === 'rel') {
                const relMatch = value.match(/^(-?\d+):(-?\d+)$/);
                if (relMatch) {
                    options.relX = parseInt(relMatch[1]);
                    options.relY = parseInt(relMatch[2]);
                }
            } else if (key === 'abs') {
                const absMatch = value.match(/^(-?\d+):(-?\d+)$/);
                if (absMatch) {
                    options.absX = parseInt(absMatch[1]);
                    options.absY = parseInt(absMatch[2]);
                }
            } else if (key === 'jitter') {
                options.jitter = parseInt(value) || 0;
            } else if (key === 'rot') {
                options.rotation = parseFloat(value);
            } else if (key === 'embed') {
                options.embed = value === 'true' || value === true;
            } else if (key === 'marginTB') {
                options.marginTB = parseFloat(value);
            } else if (key === 'marginLR') {
                options.marginLR = parseFloat(value);
            }
        }

        return options;
    }

    /**
     * Convert link options to data attributes
     */
    optionsToDataAttrs(options) {
        const attrs = [];
        if (options.width) attrs.push(`data-width="${options.width}"`);
        if (options.height) attrs.push(`data-height="${options.height}"`);
        if (options.relX !== null) attrs.push(`data-rel-x="${options.relX}"`);
        if (options.relY !== null) attrs.push(`data-rel-y="${options.relY}"`);
        if (options.absX !== null) attrs.push(`data-abs-x="${options.absX}"`);
        if (options.absY !== null) attrs.push(`data-abs-y="${options.absY}"`);
        if (options.jitter) attrs.push(`data-jitter="${options.jitter}"`);
        if (options.rotation !== null) attrs.push(`data-rotation="${options.rotation}"`);
        if (options.embed) attrs.push(`data-embed="true"`);
        if (options.marginTB !== null) attrs.push(`data-margin-tb="${options.marginTB}"`);
        if (options.marginLR !== null) attrs.push(`data-margin-lr="${options.marginLR}"`);
        return attrs.join(' ');
    }

    /**
     * Check if a string is a URL
     */
    isURL(str) {
        return str.startsWith('http://') || str.startsWith('https://');
    }

    /**
     * Sanitize and validate CSS properties to prevent XSS
     */
    sanitizeStyles(styleStr) {
        const allowedProperties = new Set([
            'font-size', 'font-weight', 'font-style', 'font-family',
            'color', 'background', 'background-color',
            'text-align', 'text-decoration', 'text-transform',
            'letter-spacing', 'line-height', 'word-spacing',
            'margin', 'margin-top', 'margin-bottom', 'margin-left', 'margin-right',
            'padding', 'padding-top', 'padding-bottom', 'padding-left', 'padding-right',
            'border', 'border-radius', 'border-color', 'border-width', 'border-style',
            'border-top', 'border-bottom', 'border-left', 'border-right',
            'opacity', 'display', 'width', 'max-width', 'min-width',
            'height', 'max-height', 'min-height',
            'vertical-align', 'white-space', 'overflow', 'text-overflow',
            'box-shadow', 'text-shadow', 'text-indent', 'writing-mode'
        ]);

        const sanitized = [];
        // Split by semicolon for CSS-style params
        const declarations = styleStr.split(';');

        for (const decl of declarations) {
            const colonIndex = decl.indexOf(':');
            if (colonIndex === -1) continue;

            const property = decl.slice(0, colonIndex).trim().toLowerCase();
            const value = decl.slice(colonIndex + 1).trim();

            if (!property || !value) continue;
            if (!allowedProperties.has(property)) continue;

            // Basic XSS prevention
            const valueLower = value.toLowerCase();
            if (valueLower.includes('javascript:') ||
                valueLower.includes('expression(') ||
                valueLower.includes('behavior:') ||
                (valueLower.includes('url(') && !valueLower.match(/url\(['""]?[^)]*\.(png|jpg|jpeg|gif|svg|webp)/i))) {
                continue;
            }

            sanitized.push(`${property}: ${value}`);
        }

        return sanitized.join('; ');
    }

    /**
     * Render a toggle switch element
     */
    renderToggle(paramsStr) {
        const params = this.parseParams(paramsStr);
        const bind = params.named.bind || '';
        const onValue = params.named.on || 'true';
        const offValue = params.named.off || 'false';
        const label = params.named.label || '';

        return `<div class="settings-row">
            <span class="settings-label">${label}</span>
            <div class="settings-toggle" data-bind="${bind}" data-on="${onValue}" data-off="${offValue}"></div>
        </div>`;
    }

    /**
     * Render a slider element
     */
    renderSlider(paramsStr) {
        const params = this.parseParams(paramsStr);
        const bind = params.named.bind || '';
        const min = params.named.min || '0';
        const max = params.named.max || '100';
        const step = params.named.step || '1';
        const label = params.named.label || '';
        const suffix = params.named.suffix || '';

        return `<div class="settings-row">
            <span class="settings-label">${label}</span>
            <input type="range" class="settings-slider" data-bind="${bind}"
                   min="${min}" max="${max}" step="${step}" data-suffix="${suffix}">
            <span class="settings-value" data-value-for="${bind}"></span>
        </div>`;
    }

    /**
     * Render a button element
     */
    renderButton(paramsStr) {
        const params = this.parseParams(paramsStr);
        const action = params.named.action || '';
        const label = params.named.label || 'Button';
        const style = params.named.style || 'bordered';

        let classes = 'btn settings-btn-action';

        if (style === 'dotted') {
            classes += ' btn-dotted';
        } else {
            // Default to bordered
            classes += ' btn-bordered';
        }

        return `<button class="${classes}" data-action="${action}">${label}</button>`;
    }

    /**
     * Render an input field element
     */
    renderInput(paramsStr) {
        const params = this.parseParams(paramsStr);
        const name = params.named.name || 'field';
        const placeholder = params.named.placeholder || '';
        const type = params.named.type || 'text';
        return `<input type="${type}" name="${name}" class="form-input" placeholder="${placeholder}">`;
    }

    /**
     * Render a textarea element
     */
    renderTextarea(paramsStr) {
        const params = this.parseParams(paramsStr);
        const name = params.named.name || 'message';
        const placeholder = params.named.placeholder || '';
        const rows = params.named.rows || '6';
        return `<textarea name="${name}" class="form-textarea" placeholder="${placeholder}" rows="${rows}"></textarea>`;
    }

    /**
     * Render a visualization element
     * Creates a container with data attributes that will be populated by Visualizations.js
     *
     * Sizing options:
     *   size: tiny|small|medium|large|full (presets)
     *   width: pixels or percentage (explicit width)
     *   height: pixels or percentage (explicit height)
     *   display: inline|float-left|float-right (display mode)
     *   align: left|center|right (block alignment)
     */
    renderViz(paramsStr) {
        const params = this.parseParams(paramsStr);
        const type = params.named.type || params.positional[0] || 'unknown';
        const id = params.named.id || `viz-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const display = params.named.display || 'block';

        // Collect all params as data attributes
        const dataAttrs = [];
        dataAttrs.push(`data-viz-type="${type}"`);
        dataAttrs.push(`data-viz-id="${id}"`);

        // Inline styles for explicit sizing
        const styles = [];

        // Pass through all named params
        Object.entries(params.named).forEach(([key, value]) => {
            if (key !== 'type' && key !== 'id') {
                // Handle width/height as inline styles for explicit sizing
                if (key === 'width') {
                    const hasUnit = /[a-z%]/i.test(value);
                    styles.push(`width: ${value}${hasUnit ? '' : 'px'}`);
                } else if (key === 'height') {
                    const hasUnit = /[a-z%]/i.test(value);
                    styles.push(`height: ${value}${hasUnit ? '' : 'px'}`);
                }
                dataAttrs.push(`data-viz-${key}="${value}"`);
            }
        });

        const styleAttr = styles.length > 0 ? ` style="${styles.join('; ')}"` : '';

        // Use <span> for inline display to avoid invalid HTML (div inside p)
        // Use <div> for block-level display modes
        const tag = display === 'inline' ? 'span' : 'div';

        return `<${tag} class="viz-container" ${dataAttrs.join(' ')}${styleAttr}></${tag}>`;
    }

    /**
     * Render an image block element
     */
    renderImageBlock(paramsStr, content) {
        const params = this.parseParams(paramsStr);

        // First positional parameter is the src
        const src = params.positional[0] || '';

        // Extract named parameters with defaults
        const scale = params.named.scale || '100%';
        const fit = params.named.fit || 'cover'; // cover, contain, fill
        const align = params.named.align || 'center'; // left, center, right
        const captionParam = params.named.caption || ''; // optional caption from params

        // Parse scale percentage
        let scaleValue = 1;
        if (scale.endsWith('%')) {
            scaleValue = parseFloat(scale) / 100;
        } else if (!isNaN(parseFloat(scale))) {
            scaleValue = parseFloat(scale) / 100;
        }

        // Build style attributes
        const styles = [];
        if (scaleValue !== 1) {
            styles.push(`transform: scale(${scaleValue})`);
            styles.push(`transform-origin: top ${align === 'left' ? 'left' : align === 'right' ? 'right' : 'center'}`);
        }

        // Object-fit for how image scales within container
        const validFits = ['cover', 'contain', 'fill', 'scale-down', 'none'];
        if (validFits.includes(fit)) {
            styles.push(`object-fit: ${fit}`);
        }

        const styleAttr = styles.length > 0 ? ` style="${styles.join('; ')}"` : '';

        // Container alignment class
        const alignClass = align === 'left' ? 'image-align-left' :
                          align === 'right' ? 'image-align-right' :
                          'image-align-center';

        // Determine caption text (param takes precedence over content)
        const captionText = captionParam || content.trim();

        // Build the image HTML
        let html = `<div class="image-block ${alignClass}">`;
        html += `<img src="${src}" alt="${captionText}" class="image-block-img"${styleAttr}>`;

        if (captionText) {
            html += `<div class="image-block-caption">${captionText}</div>`;
        }

        html += '</div>';

        return html;
    }

    parseFrontMatter(frontMatter) {
        const metadata = {};
        const lines = frontMatter.split('\n');

        lines.forEach(line => {
            const colonIndex = line.indexOf(':');
            if (colonIndex > -1) {
                const key = line.slice(0, colonIndex).trim();
                const value = line.slice(colonIndex + 1).trim();
                metadata[key] = value;
            }
        });

        return metadata;
    }

    parseMarkdown(markdown) {
        let html = markdown;

        // Protect code blocks and inline code first
        const codePlaceholders = [];

        html = html.replace(/```([^`]+)```/g, (match, code) => {
            const placeholder = `__CODE_BLOCK_${codePlaceholders.length}__`;
            codePlaceholders.push({ placeholder, html: `<pre><code>${code}</code></pre>` });
            return placeholder;
        });

        html = html.replace(/`([^`]+)`/g, (match, code) => {
            const placeholder = `__CODE_INLINE_${codePlaceholders.length}__`;
            codePlaceholders.push({ placeholder, html: `<code>${code}</code>` });
            return placeholder;
        });

        // Process LaTeX expressions after protecting code
        const latexResult = this.processLaTeX(html);
        html = latexResult.processed;
        const mathPlaceholders = latexResult.mathPlaceholders;

        // Interactive elements (process before other patterns)
        html = html.replace(this.getTogglePattern(), (match, params) => {
            return this.renderToggle(params);
        });

        html = html.replace(this.getSliderPattern(), (match, params) => {
            return this.renderSlider(params);
        });

        html = html.replace(this.getButtonPattern(), (match, params) => {
            return this.renderButton(params);
        });

        html = html.replace(this.getInputPattern(), (match, params) => {
            return this.renderInput(params);
        });

        html = html.replace(this.getTextareaPattern(), (match, params) => {
            return this.renderTextarea(params);
        });

        html = html.replace(this.getVizPattern(), (match, params) => {
            return this.renderViz(params);
        });

        // Process citations (before other links to avoid conflicts)
        html = html.replace(this.getCitePattern(), (match, url, title, text) => {
            return this.processCitation(url.trim(), title ? title.trim() : null, text ? text.trim() : null);
        });

        // Process bibliography placeholder
        html = html.replace(this.getBibliographyPattern(), () => {
            return this.generateBibliography();
        });

        // Full link syntax: [[link(card, params)]] or [[link(url, params)]]
        html = html.replace(this.getFullLinkPattern(), (match, target, paramsStr) => {
            const options = this.parseLinkOptions(paramsStr);
            const display = options.display || target.trim();
            const dataAttrs = this.optionsToDataAttrs(options);
            const trimmedTarget = target.trim();

            // Check if target is a URL
            if (this.isURL(trimmedTarget)) {
                if (options.embed) {
                    // Embed URL in a card - use card-link with data-url
                    return `<strong class="card-link" data-url="${trimmedTarget}" ${dataAttrs}>${display}</strong>`;
                } else {
                    // Regular external link - open in new tab
                    return `<a href="${trimmedTarget}" target="_blank" rel="noopener noreferrer">${display}</a>`;
                }
            } else {
                // Card link
                return `<strong class="card-link" data-card="${trimmedTarget}" ${dataAttrs}>${display}</strong>`;
            }
        });

        // Shorthand link syntax: [[Card]] or [[Card|display]] or [[url]] or [[url|display]]
        html = html.replace(this.getShortLinkPattern(), (match, target, display) => {
            const displayText = display ? display.trim() : target.trim();
            const trimmedTarget = target.trim();

            // Check if target is a URL
            if (this.isURL(trimmedTarget)) {
                // URL without embed option - open in new tab
                return `<a href="${trimmedTarget}" target="_blank" rel="noopener noreferrer">${displayText}</a>`;
            } else {
                // Card link
                return `<strong class="card-link" data-card="${trimmedTarget}">${displayText}</strong>`;
            }
        });

        // Headers
        html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
        html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
        html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');

        // Horizontal rules
        html = html.replace(/^---+$/gim, '<hr>');

        // Bold
        html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

        // Italic
        html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');

        // Inline styled spans: [[style(css)]]{text}
        html = html.replace(this.getInlineStylePattern(), (match, styles, text) => {
            const sanitizedStyles = this.sanitizeStyles(styles);
            if (!sanitizedStyles) {
                return text;
            }
            return `<span class="styled-inline" style="${sanitizedStyles}">${text}</span>`;
        });

        // Anchors: [[anchor(id)]]{text} - with clickable number badges for bidirectional navigation
        html = html.replace(this.getAnchorPattern(), (match, anchorId, text) => {
            const jumpInfos = this.anchorJumps.get(anchorId);
            if (jumpInfos && jumpInfos.length > 0) {
                // Create clickable numbers that link back to their sources
                const numLinks = jumpInfos.map(info =>
                    `<span class="jump-link anchor-back-link" data-jump-target="${info.sourceId}">${info.number}</span>`
                ).join(', ');
                return `<span data-anchor-id="${anchorId}" class="jump-anchor"><sup class="anchor-number">${numLinks}</sup>${text}</span>`;
            }
            return `<span data-anchor-id="${anchorId}">${text}</span>`;
        });

        // Jump links: [[jump(target-id)]] or [[jump(target-id)]]{display text}
        html = html.replace(this.getJumpPattern(), (match, targetId, displayText) => {
            const jumpInfos = this.anchorJumps.get(targetId);
            const jumpIndex = this.getNextJumpIndex(targetId);
            const jumpInfo = jumpInfos ? jumpInfos[jumpIndex] : null;
            const number = jumpInfo ? jumpInfo.number : null;
            const sourceId = jumpInfo ? jumpInfo.sourceId : null;
            const numHtml = number ? `<sup class="ref-number">${number}</sup>` : '';
            const anchorAttr = sourceId ? ` data-anchor-id="${sourceId}"` : '';

            if (displayText) {
                return `<span class="jump-link" data-jump-target="${targetId}"${anchorAttr} style="cursor: pointer; color: var(--color-link); text-decoration: underline dotted; text-underline-offset: 2px;">${displayText}${numHtml}</span>`;
            } else {
                return `<span class="jump-link" data-jump-target="${targetId}"${anchorAttr} style="cursor: pointer; color: var(--color-link);">${targetId}${numHtml}</span>`;
            }
        });

        // External links (after inline styles to avoid conflicts)
        html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

        // Images
        html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1">');

        // Blockquotes
        html = html.replace(/^>\s*(.*$)/gim, '<blockquote>$1</blockquote>');

        // Unordered lists
        html = html.replace(/^\s*[-*]\s+(.*$)/gim, '<li>$1</li>');
        html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');

        // Ordered lists
        html = html.replace(/^\s*\d+\.\s+(.*$)/gim, '<li>$1</li>');

        // Paragraphs
        html = html.split('\n\n').map(para => {
            para = para.trim();
            if (!para) return '';
            if (para.startsWith('<h') ||
                para.startsWith('<ul') ||
                para.startsWith('<ol') ||
                para.startsWith('<blockquote') ||
                para.startsWith('<pre') ||
                para.startsWith('<li') ||
                para.startsWith('<div') ||
                para.startsWith('<hr') ||
                para.startsWith('__CODE_') ||
                para.startsWith('__MARGIN_ANCHOR_') ||
                para.startsWith('__BLOCK_PLACEHOLDER_')) {
                return para;
            }
            if (para.startsWith('->') && para.endsWith('<-')) {
                return `<p class="centered">${para.slice(2, -2).trim()}</p>`;
            }
            return `<p>${para}</p>`;
        }).join('\n');

        html = html.replace(/<\/li>\n<li>/g, '</li><li>');
        html = html.replace(/<\/blockquote>\n<blockquote>/g, '<br>');

        // Restore code placeholders
        for (const { placeholder, html: codeHtml } of codePlaceholders) {
            html = html.replace(placeholder, codeHtml);
        }

        // Restore LaTeX placeholders
        html = this.restoreLaTeX(html, mathPlaceholders);

        return html;
    }

    /**
     * Parse inline markdown only (for simpler contexts)
     */
    parseInlineMarkdown(text) {
        let html = text;

        // Protect inline code first
        const codePlaceholders = [];
        html = html.replace(/`([^`]+)`/g, (match, code) => {
            const placeholder = `__CODE_INLINE_${codePlaceholders.length}__`;
            codePlaceholders.push({ placeholder, html: `<code>${code}</code>` });
            return placeholder;
        });

        // Process LaTeX expressions after protecting code
        const latexResult = this.processLaTeX(html);
        html = latexResult.processed;
        const mathPlaceholders = latexResult.mathPlaceholders;

        // Process citations (before other links to avoid conflicts)
        html = html.replace(this.getCitePattern(), (match, url, title, text) => {
            return this.processCitation(url.trim(), title ? title.trim() : null, text ? text.trim() : null);
        });

        // Interactive elements
        html = html.replace(this.getTogglePattern(), (match, params) => {
            return this.renderToggle(params);
        });

        html = html.replace(this.getSliderPattern(), (match, params) => {
            return this.renderSlider(params);
        });

        html = html.replace(this.getButtonPattern(), (match, params) => {
            return this.renderButton(params);
        });

        html = html.replace(this.getInputPattern(), (match, params) => {
            return this.renderInput(params);
        });

        html = html.replace(this.getTextareaPattern(), (match, params) => {
            return this.renderTextarea(params);
        });

        // Full link syntax
        html = html.replace(this.getFullLinkPattern(), (match, target, paramsStr) => {
            const options = this.parseLinkOptions(paramsStr);
            const display = options.display || target.trim();
            const dataAttrs = this.optionsToDataAttrs(options);
            const trimmedTarget = target.trim();

            if (this.isURL(trimmedTarget)) {
                if (options.embed) {
                    return `<strong class="card-link" data-url="${trimmedTarget}" ${dataAttrs}>${display}</strong>`;
                } else {
                    return `<a href="${trimmedTarget}" target="_blank" rel="noopener noreferrer">${display}</a>`;
                }
            } else {
                return `<strong class="card-link" data-card="${trimmedTarget}" ${dataAttrs}>${display}</strong>`;
            }
        });

        // Shorthand link syntax
        html = html.replace(this.getShortLinkPattern(), (match, target, display) => {
            const displayText = display ? display.trim() : target.trim();
            const trimmedTarget = target.trim();

            if (this.isURL(trimmedTarget)) {
                return `<a href="${trimmedTarget}" target="_blank" rel="noopener noreferrer">${displayText}</a>`;
            } else {
                return `<strong class="card-link" data-card="${trimmedTarget}">${displayText}</strong>`;
            }
        });

        // Inline styled spans
        html = html.replace(this.getInlineStylePattern(), (match, styles, spanText) => {
            const sanitizedStyles = this.sanitizeStyles(styles);
            if (!sanitizedStyles) {
                return spanText;
            }
            return `<span class="styled-inline" style="${sanitizedStyles}">${spanText}</span>`;
        });

        // Jump links: [[jump(target-id)]] or [[jump(target-id)]]{display text}
        html = html.replace(this.getJumpPattern(), (match, targetId, displayText) => {
            const jumpInfos = this.anchorJumps.get(targetId);
            const jumpIndex = this.getNextJumpIndex(targetId);
            const jumpInfo = jumpInfos ? jumpInfos[jumpIndex] : null;
            const number = jumpInfo ? jumpInfo.number : null;
            const sourceId = jumpInfo ? jumpInfo.sourceId : null;
            const numHtml = number ? `<sup class="ref-number">${number}</sup>` : '';
            const anchorAttr = sourceId ? ` data-anchor-id="${sourceId}"` : '';

            if (displayText) {
                return `<span class="jump-link" data-jump-target="${targetId}"${anchorAttr} style="cursor: pointer; color: var(--color-link); text-decoration: underline dotted; text-underline-offset: 2px;">${displayText}${numHtml}</span>`;
            } else {
                return `<span class="jump-link" data-jump-target="${targetId}"${anchorAttr} style="cursor: pointer; color: var(--color-link);">${targetId}${numHtml}</span>`;
            }
        });

        // Bold
        html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

        // Italic
        html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');

        // External links
        html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

        // Restore code placeholders
        for (const { placeholder, html: codeHtml } of codePlaceholders) {
            html = html.replace(placeholder, codeHtml);
        }

        // Restore LaTeX placeholders
        html = this.restoreLaTeX(html, mathPlaceholders);

        return html;
    }

    /**
     * Process a citation and return the formatted citation with superscript number
     * Numbers are pre-assigned during the discovery pass
     */
    processCitation(url, title, text) {
        // Get the pre-assigned citation number from discovery pass
        const citation = this.citations.get(url);
        if (!citation) {
            // Fallback: citation not found in discovery (shouldn't happen)
            console.warn(`Citation for ${url} not found in discovery pass`);
            return text || '';
        }
        const citationNumber = citation.number;
        const sourceId = this.getNextCitationSourceId(url);
        const anchorAttr = sourceId ? ` data-anchor-id="${sourceId}"` : '';

        if (text) {
            // Citation with text: text opens URL, superscript jumps to bibliography
            return `<a href="${url}" target="_blank" rel="noopener noreferrer" style="color: var(--color-link); text-decoration: underline dotted; text-underline-offset: 2px;">${text}</a><span class="jump-link" data-jump-target="ref-${citationNumber}"${anchorAttr} style="cursor: pointer; color: var(--color-link);"><sup class="ref-number">${citationNumber}</sup></span>`;
        } else {
            // Citation without text: just the superscript that jumps to bibliography
            return `<span class="jump-link" data-jump-target="ref-${citationNumber}"${anchorAttr} style="cursor: pointer; color: var(--color-link);"><sup class="ref-number">${citationNumber}</sup></span>`;
        }
    }

    /**
     * Generate the bibliography section from collected citations
     */
    generateBibliography() {
        if (this.citations.size === 0) {
            return '';
        }

        // Create proper bibliography for main content area
        let html = '<div id="bibliography-section" style="margin-top: 32px; padding-top: 16px; border-top: 1px solid var(--color-border); font-size: var(--font-size-base); line-height: var(--line-height-base);">';
        html += '<h3 style="margin-bottom: 12px; font-size: var(--font-size-h3); font-weight: var(--font-weight-h3);">References</h3>';

        // Sort citations by number
        const sortedCitations = Array.from(this.citations.values()).sort((a, b) => a.number - b.number);

        // Traditional academic format showing URLs with clickable back-links
        for (const citation of sortedCitations) {
            html += `<p id="ref-${citation.number}" data-anchor-id="ref-${citation.number}" style="margin-bottom: 8px;">`;

            // Create clickable number(s) that link back to citation occurrences
            if (citation.sourceIds && citation.sourceIds.length > 0) {
                const numLinks = citation.sourceIds.map((sourceId, index) => {
                    const displayNum = citation.sourceIds.length > 1
                        ? `${citation.number}.${index + 1}`
                        : `${citation.number}`;
                    return `<span class="jump-link anchor-back-link" data-jump-target="${sourceId}">${displayNum}</span>`;
                }).join(', ');
                html += `<sup class="anchor-number" style="margin-right: 4px;">${numLinks}</sup>`;
            } else {
                html += `${citation.number}. `;
            }

            html += `<a href="${citation.url}" target="_blank" rel="noopener noreferrer" style="color: var(--color-link); text-decoration: none;">${citation.url}</a>`;
            html += '</p>';
        }

        html += '</div>';
        return html;
    }

    /**
     * Extract a basic title from URL for display
     */
    extractTitleFromUrl(url) {
        try {
            const urlObj = new URL(url);
            const domain = urlObj.hostname.replace(/^www\./, '');
            const path = urlObj.pathname;

            if (path && path !== '/') {
                // Use the last part of the path as title
                const pathParts = path.split('/').filter(part => part.length > 0);
                if (pathParts.length > 0) {
                    const lastPart = pathParts[pathParts.length - 1];
                    // Remove common file extensions and clean up
                    const cleaned = lastPart.replace(/\.[^.]*$/, '').replace(/[-_]/g, ' ');
                    return `${cleaned} - ${domain}`;
                }
            }

            return domain;
        } catch (e) {
            // Fallback for invalid URLs
            return url;
        }
    }

    /**
     * Process LaTeX expressions in text content
     * For KaTeX auto-render, we keep the original $ delimiters in the final HTML
     */
    processLaTeX(text) {
        // Return the original text unchanged - let KaTeX auto-render handle it
        return { processed: text, mathPlaceholders: [] };
    }

    /**
     * Escape LaTeX content for safe HTML embedding
     */
    escapeLatex(latex) {
        return latex
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#x27;');
    }

    /**
     * Restore LaTeX placeholders with their rendered HTML
     * Since we're now using auto-render, this just returns the text unchanged
     */
    restoreLaTeX(text, mathPlaceholders) {
        // No placeholders to restore - return text as-is for auto-render
        return text;
    }
}

export const markdownParser = new MarkdownParser();
