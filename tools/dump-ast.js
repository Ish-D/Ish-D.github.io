#!/usr/bin/env node
/**
 * Prints the document tree of a card, one node per line with its source range
 * and a short preview, followed by the diagnostics.
 *
 *   node tools/dump-ast.js cards/weird.md
 */

import { readFileSync } from 'node:fs';
import { parse } from '../core/doc/parse.js';

const PREVIEW = 60;

const file = process.argv[2];
if (!file) {
    console.error('usage: node tools/dump-ast.js <file.md>');
    process.exit(2);
}

let source;
try {
    source = readFileSync(file, 'utf8');
} catch (err) {
    console.error(`cannot read ${file}: ${err.message}`);
    process.exit(1);
}

const doc = parse(source);
const out = [];
dumpDoc(doc);
process.stdout.write(out.join('\n') + '\n');

function dumpDoc(doc) {
    out.push(`doc ${range(doc)}`);
    const fm = doc.frontmatter;
    if (fm) {
        out.push(`  frontmatter ${range(fm)}`);
        for (const [key, e] of Object.entries(fm.entries)) {
            out.push(`    ${key}: ${preview(e.value)} [${e.valueStart},${e.valueEnd})`);
        }
    }
    for (const block of doc.children) dumpNode(block, 1);
    out.push('');
    out.push(doc.diagnostics.length ? 'diagnostics:' : 'diagnostics: none');
    const lines = lineStarts(doc.source);
    for (const d of doc.diagnostics) {
        out.push(`  ${d.severity} ${position(lines, d.start)} [${d.start},${d.end}) ${d.message}`);
    }
}

function dumpNode(node, depth) {
    const pad = '  '.repeat(depth);
    const line = (text) => out.push(pad + text);
    switch (node.type) {
        case 'heading':
            line(`heading h${node.level} #${node.id} ${range(node)}`);
            break;
        case 'paragraph':
            line(`paragraph${node.centered ? ' centered' : ''} ${range(node)}`);
            break;
        case 'list':
            line(`list ${node.ordered ? 'ordered' : 'unordered'} ${range(node)}`);
            for (const item of node.items) dumpNode(item, depth + 1);
            return;
        case 'table':
            line(`table ${range(node)} align=${node.align.map((a) => a ?? '-').join(',')}`);
            dumpRow('header', node.header, depth + 1);
            node.rows.forEach((row, i) => dumpRow(`row ${i + 1}`, row, depth + 1));
            return;
        case 'code':
            line(`code ${node.lang ?? '-'} ${range(node)} ${preview(node.text)}`);
            return;
        case 'math':
            line(`math ${range(node)} ${preview(node.tex)}`);
            return;
        case 'raw':
            line(`raw ${range(node)} ${preview(node.text)}`);
            return;
        case 'text':
            line(`text ${range(node)} ${preview(node.value)}`);
            return;
        case 'codespan':
            line(`codespan ${range(node)} ${preview(node.value)}`);
            return;
        case 'mathinline':
            line(`mathinline ${range(node)} ${preview(node.tex)}`);
            return;
        case 'link':
            line(`link ${range(node)} href=${preview(node.href)}`);
            break;
        case 'image':
            line(`image ${range(node)} src=${preview(node.src)} alt=${preview(node.alt)}`);
            return;
        case 'directive':
            dumpDirective(node, depth);
            return;
        default:
            line(`${node.type} ${range(node)}`);
    }
    for (const child of node.children ?? []) dumpNode(child, depth + 1);
}

function dumpDirective(node, depth) {
    const pad = '  '.repeat(depth);
    out.push(`${pad}directive ${node.name} ${node.block ? 'block' : 'inline'} ${range(node)}`);
    if (node.args) {
        const items = node.args.items.map((a) => (a.key === null ? preview(a.value) : `${a.key}: ${preview(a.value)}`));
        out.push(`${pad}  args ${range(node.args)} ${items.join(', ')}`);
    }
    node.groups.forEach((g, i) => {
        const raw = g.children === null ? ` ${preview(g.text)}` : '';
        out.push(`${pad}  group ${i} ${g.kind} ${range(g)}${raw}`);
        for (const child of g.children ?? []) dumpNode(child, depth + 2);
    });
}

function dumpRow(label, cells, depth) {
    out.push(`${'  '.repeat(depth)}${label}`);
    cells.forEach((cell, i) => {
        out.push(`${'  '.repeat(depth + 1)}cell ${i}`);
        for (const child of cell) dumpNode(child, depth + 2);
    });
}

function range(node) {
    return `[${node.start},${node.end})`;
}

function preview(text) {
    const short = text.length > PREVIEW ? text.slice(0, PREVIEW) + '…' : text;
    return JSON.stringify(short);
}

function lineStarts(source) {
    const starts = [0];
    for (let i = source.indexOf('\n'); i >= 0; i = source.indexOf('\n', i + 1)) starts.push(i + 1);
    return starts;
}

function position(starts, offset) {
    let lo = 0, hi = starts.length - 1;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (starts[mid] <= offset) lo = mid;
        else hi = mid - 1;
    }
    return `${lo + 1}:${offset - starts[lo] + 1}`;
}
