const assert = require('node:assert/strict');
const test = require('node:test');
const {parse, serialize} = require('./RouteViewFile.js');

function route(count) {
    return {
        name: 'Kilcoy & Woodford – test',
        locations: ['Kilcoy QLD', ...Array.from({length: count}, (_, i) => '-26.94, 152.' + (560 + i)), 'Woodford QLD'],
        avoidHighways: false,
        avoidTolls: true,
        stepMeters: 175.5,
        intervalMs: 10000
    };
}

for (const count of [0, 1, 25, 26, 100]) {
    test(`route file preserves order and settings with ${count} intermediate waypoints`, () => {
        const definition = route(count);
        const text = serialize({...definition, apiKey: 'secret'});
        assert.doesNotMatch(text, /apiKey|secret/);
        assert.deepEqual(parse('\uFEFF' + text), {format: 'routeview', version: 1, ...definition});
    });
}

test('rejects invalid JSON, format, version, locations, and settings', () => {
    const valid = {format: 'routeview', version: 1, ...route(2)};
    assert.throws(() => parse('{'), /valid JSON/);
    assert.throws(() => parse('{}'), /Choose a RouteView/);
    for (const [changes, message] of [
        [{version: 2}, /unsupported/],
        [{locations: ['Kilcoy']}, /start and destination/],
        [{locations: ['Kilcoy', '', 'Woodford']}, /Each route location/],
        [{locations: ['Kilcoy\nQueensland', 'Woodford']}, /single line/],
        [route(101), /100 intermediate/],
        [{avoidHighways: 'false'}, /highway and toll/],
        [{intervalMs: 10001}, /interval/]
    ]) {
        assert.throws(() => parse(JSON.stringify({...valid, ...changes})), message);
    }
    assert.throws(() => serialize({...valid, name: ' '}), /route name/);
    assert.throws(() => serialize({...route(100), locations: Array(102).fill('\u0000'.repeat(2047) + 'a'.repeat(1))}), /1 MiB/);
});

test('application validates and confirms before replacing route rows and preferences', async () => {
    const fs = require('node:fs');
    const vm = require('node:vm');
    const fileCodec = require('./RouteViewFile.js');
    const batch = require('./RouteViewBatch.js');
    const widgets = new Map();
    const elements = new Map();
    const errors = [];
    const prompts = [];
    let accept = false;
    let app;
    const widget = id => {
        if (!widgets.has(id)) widgets.set(id, {
            value: '', get(key) { return this[key]; }, set(key, value) { this[key] = value; }
        });
        return widgets.get(id);
    };
    const element = id => {
        if (!elements.has(id)) elements.set(id, {value: '', style: {}});
        return elements.get(id);
    };
    const source = fs.readFileSync(__dirname + '/RouteView.js', 'utf8');
    const end = source.lastIndexOf('\n    return {');
    assert.ok(end > 0);
    vm.runInNewContext(source.slice(0, end) + `
        var recalculations = 0;
        cb_route_from_or_to_changed_handle = [];
        do_route = function() { recalculations++; };
        show_error = function(message) { errors.push(message); };
        return {
            load: load_route_file,
            markSaved: function() { route_file_snapshot = JSON.stringify(read_route_definition()); },
            state: function() { return {recalculations, definition: read_route_definition()}; }
        };
    });`, {
        define(deps, factory) { app = factory(batch, fileCodec); },
        require(deps, callback) {
            if (deps[0] === 'dojo/dom-style') callback({get(id) { return element(id).style.display; }});
        },
        document: {getElementById: element}, dijit: {byId: widget}, clearTimeout,
        console: {log() {}}, errors,
        window: {confirm(message) { prompts.push(message); return accept; }}
    });
    widget('id_btn_stop').disabled = true;
    widget('id_wp_0').value = 'Old start';
    widget('id_wp_1').value = 'Old destination';
    element('id_tr_2').style.display = 'none';
    app.markSaved();
    element('id_route_name').value = 'Unsaved edit';

    async function load(text, size = Buffer.byteLength(text)) {
        const input = {files: [{size, text: async () => text}], value: 'selected'};
        app.load({target: input});
        await new Promise(setImmediate);
        assert.equal(input.value, '');
    }

    await load('{');
    await load('{}', fileCodec.maxBytes + 1);
    assert.equal(errors.length, 2);
    assert.equal(prompts.length, 0);
    assert.equal(app.state().recalculations, 0);
    assert.equal(widget('id_wp_1').value, 'Old destination');

    const long = route(100);
    await load(serialize(long));
    assert.equal(prompts.length, 1);
    assert.equal(app.state().recalculations, 0);
    assert.equal(element('id_route_name').value, 'Unsaved edit');

    accept = true;
    await load(serialize(long));
    assert.equal(app.state().recalculations, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(app.state().definition)), long);
    assert.equal(element('id_drive_tr_101').style.display, '');

    await load(serialize(route(0)));
    assert.equal(app.state().recalculations, 2);
    assert.equal(prompts.length, 2);
    assert.equal(element('id_tr_101').style.display, 'none');
    assert.equal(widget('id_wp_101').value, '');
    assert.equal(widget('id_wp_1').value, 'Woodford QLD');
});
