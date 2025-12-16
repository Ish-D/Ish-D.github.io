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
 *   [[slider(bind: fontSize, min: 10, max: 18, step: 1, label: Font Size, suffix: px)]]
 *   [[button(action: resetSettings, label: Reset to Defaults)]]
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
        this.citations = new Map(); // URL -> { number, title, count }
        this.citationCounter = 0;
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

    getTagsPattern() {
        return /\[\[tags\]\]/g;
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

    parse(markdown) {
        // Reset citations for each document
        this.citations.clear();
        this.citationCounter = 0;

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

        // Extract and process blocks using fresh regex instance
        const blockPattern = this.getBlockPattern();
        let blockMatch;
        const marginBlocks = [];
        let marginCounter = 0;

        while ((blockMatch = blockPattern.exec(processedMarkdown)) !== null) {
            const fullMatch = blockMatch[0];
            const type = blockMatch[1];
            const params = blockMatch[2] || '';
            const content = blockMatch[3].trim();

            if (type === 'margin') {
                const marginData = this.parseMarginBlock(params, content);

                // For relative margins without explicit anchors, auto-generate one
                let autoAnchorId = null;
                if (marginData.type === 'relative' && !marginData.anchor) {
                    autoAnchorId = `__auto_margin_${marginCounter++}`;
                    marginData.anchor = autoAnchorId;
                }

                marginBlocks.push({
                    match: fullMatch,
                    autoAnchor: autoAnchorId,
                    isRelative: marginData.type === 'relative'
                });

                result.margins[marginData.side].push(marginData);
            }
        }

        // Replace margin blocks in content
        // Relative margins get anchor placeholders, absolute margins are just removed
        for (const block of marginBlocks) {
            if (block.isRelative && block.autoAnchor) {
                // Replace with placeholder that survives markdown parsing
                processedMarkdown = processedMarkdown.replace(
                    block.match,
                    `__MARGIN_ANCHOR_${block.autoAnchor}__`
                );
            } else {
                processedMarkdown = processedMarkdown.replace(block.match, '');
            }
        }

        // Process remaining blocks (center, style) in main content
        processedMarkdown = this.processBlocks(processedMarkdown);

        // Process anchors in main content
        processedMarkdown = processedMarkdown.replace(
            this.getAnchorPattern(),
            '<span data-anchor-id="$1">$2</span>'
        );

        // Process [[tags]] directive with placeholder for card tags
        processedMarkdown = processedMarkdown.replace(
            this.getTagsPattern(),
            '<div class="card-tags-placeholder" data-tags-placeholder="true"></div>'
        );

        // Parse remaining markdown to HTML
        result.content = this.parseMarkdown(processedMarkdown.trim());

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
     * Process center, style, and image blocks, converting them to HTML
     */
    processBlocks(markdown) {
        return markdown.replace(this.getBlockPattern(), (match, type, params, content) => {
            if (type === 'center') {
                return `<div class="center-block">${content.trim()}</div>`;
            } else if (type === 'style') {
                const sanitizedStyles = this.sanitizeStyles(params || '');
                if (!sanitizedStyles) {
                    return content.trim();
                }
                return `<div class="styled-block" style="${sanitizedStyles}">${content.trim()}</div>`;
            } else if (type === 'image') {
                return this.renderImageBlock(params || '', content.trim());
            }
            // Return unchanged for unknown types
            return match;
        });
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

        // Process any nested blocks (center, style)
        processedContent = this.processBlocks(processedContent);

        // Parse as full markdown
        const html = this.parseMarkdown(processedContent);

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
            if (colonIndex === -1) {
                // Positional param
                result.positional.push(trimmed);
            } else {
                // Named param
                const key = trimmed.slice(0, colonIndex).trim();
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
        const style = params.named.style || '';

        const styleAttr = style === 'full-width'
            ? 'style="width: 100%; padding: 8px; cursor: pointer; background: var(--color-border); border: none; color: var(--color-text-primary); font-family: inherit;"'
            : 'style="padding: 8px 16px; cursor: pointer; background: var(--color-border); border: none; color: var(--color-text-primary); font-family: inherit;"';

        return `<button class="settings-btn-action" data-action="${action}" ${styleAttr}>${label}</button>`;
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

        // Anchors: [[anchor(id)]]{text}
        html = html.replace(this.getAnchorPattern(), '<span data-anchor-id="$1">$2</span>');

        // Jump links: [[jump(target-id)]] or [[jump(target-id)]]{display text}
        html = html.replace(this.getJumpPattern(), (match, targetId, displayText) => {
            if (displayText) {
                // Custom display text with underline and superscript upward arrow
                return `<span class="jump-link" data-jump-target="${targetId}" style="cursor: pointer; color: var(--color-link); text-decoration: underline;">${displayText}<sup style="margin-left: 1px;">↑</sup></span>`;
            } else {
                // No custom text, show arrow with target id
                return `<span class="jump-link" data-jump-target="${targetId}" style="cursor: pointer; color: var(--color-link);">→ ${targetId}</span>`;
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
                para.startsWith('__MARGIN_ANCHOR_')) {
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
            if (displayText) {
                // Custom display text with underline and superscript upward arrow
                return `<span class="jump-link" data-jump-target="${targetId}" style="cursor: pointer; color: var(--color-link); text-decoration: underline;">${displayText}<sup style="margin-left: 1px;">↑</sup></span>`;
            } else {
                // No custom text, show arrow with target id
                return `<span class="jump-link" data-jump-target="${targetId}" style="cursor: pointer; color: var(--color-link);">→ ${targetId}</span>`;
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
     */
    processCitation(url, title, text) {
        let citationNumber;

        // Check if we've seen this URL before
        if (this.citations.has(url)) {
            const citation = this.citations.get(url);
            citation.count++;
            citationNumber = citation.number;
        } else {
            // New citation - assign next number
            this.citationCounter++;
            const citationData = {
                number: this.citationCounter,
                url: url,
                title: title || this.extractTitleFromUrl(url),
                count: 1
            };
            this.citations.set(url, citationData);
            citationNumber = this.citationCounter;
        }

        if (text) {
            // Citation with text: text opens URL, superscript jumps to bibliography
            return `<a href="${url}" target="_blank" rel="noopener noreferrer" style="color: var(--color-link); text-decoration: underline;">${text}</a><span class="jump-link" data-jump-target="ref-${citationNumber}" style="cursor: pointer; color: var(--color-link);"><sup style="font-size: 0.7em;">${citationNumber}</sup></span>`;
        } else {
            // Citation without text: just the superscript that jumps to bibliography
            return `<span class="jump-link" data-jump-target="ref-${citationNumber}" style="cursor: pointer; color: var(--color-link);"><sup style="font-size: 0.7em;">${citationNumber}</sup></span>`;
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

        // Traditional academic format showing URLs
        for (const citation of sortedCitations) {
            html += `<p id="ref-${citation.number}" data-anchor-id="ref-${citation.number}" style="margin-bottom: 8px; text-indent: -20px; padding-left: 20px;">`;
            html += `${citation.number}. <a href="${citation.url}" target="_blank" rel="noopener noreferrer" style="color: var(--color-link); text-decoration: none;">${citation.url}</a>`;
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
