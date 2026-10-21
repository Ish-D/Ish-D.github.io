import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assetUrl, displayUrl, routeFromLocation, hasDrawingSource, imageSrc, HOME_PAGE } from '../../core/app/urls.js';
import { parse } from '../../core/doc/parse.js';

const route = (search = '', hash = '', pathname = '/') => routeFromLocation({ search, hash, pathname });

test('assets resolve from the site root, external urls stay', () => {
    assert.equal(assetUrl('images/a.png'), '/images/a.png');
    assert.equal(assetUrl('/x.png'), '/x.png');
    assert.equal(assetUrl('https://a.b/c.png'), 'https://a.b/c.png');
});

test('photographs show their web-sized copy', () => {
    assert.equal(displayUrl('images/photography/koi.png'), '/images/photography/web/koi.jpg');
    assert.equal(displayUrl('images/photography/web/koi.jpg'), '/images/photography/web/koi.jpg');
    assert.equal(displayUrl('images/other/koi.png'), '/images/other/koi.png');
});

test('every old and new address form finds its page', () => {
    assert.deepEqual(route('?page=lab', '#intro'), { page: 'lab', hash: '#intro' });
    assert.deepEqual(route('', '#/lab/intro'), { page: 'lab', hash: '#intro' });
    assert.deepEqual(route('', '#/c/lab/intro'), { page: 'lab', hash: '#intro' });
    assert.deepEqual(route('', '#/lab'), { page: 'lab', hash: '' });
    assert.deepEqual(route('', '', '/lab'), { page: 'lab', hash: '' });
    assert.deepEqual(route('', '', '/'), { page: HOME_PAGE, hash: '' });
    assert.deepEqual(route('', '', '/index.html'), { page: HOME_PAGE, hash: '' });
});

test('drawing nodes know whether they name a file', () => {
    const [file, inline] = parse('[[drawing(a.svg)]]\n\n[[drawing(view: 600x300)]]{\n}\n').children;
    assert.equal(hasDrawingSource(file), true);
    assert.equal(hasDrawingSource(inline), false);
    assert.equal(imageSrc(file), 'a.svg');
});
