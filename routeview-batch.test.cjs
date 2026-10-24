const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const batch = require('./RouteViewBatch.js');

function point(n) { return {lat: -27, lng: 150 + n / 1000}; }
function request(count) {
    return {origin: point(0), destination: point(count + 1),
        waypoints: Array.from({length: count}, (_, n) => ({location: point(n + 1), stopover: true})),
        avoidTolls: true, avoidHighways: true, travelMode: 'DRIVING', optimizeWaypoints: false};
}
function response(req) {
    const points = [req.origin, ...req.waypoints.map(wp => wp.location), req.destination];
    return {routes: [{summary: 'Test road', warnings: [],
        legs: points.slice(1).map((p, i) => ({start_location: points[i], end_location: p,
            start_address: 'start', end_address: 'end',
            distance: {value: 100, text: '100 m'}, duration: {value: 10, text: '10 s'},
            steps: [{path: [points[i], p]}]}))}],
        geocoded_waypoints: points.map(p => ({place_id: String(p.lng)}))};
}

for (const count of [0, 1, 23, 25, 26, 50, 51, 52, 99, 100]) {
    test(`${count} intermediate waypoints preserve every leg and total`, () => {
        const req = request(count), calls = [];
        let completed = false;
        batch.calculate({route(r, cb) { calls.push(r); cb(response(r), 'OK'); }}, req, {},
            (result, status, responses) => {
                assert.equal(status, 'OK');
                assert.equal(result.routes[0].legs.length, count + 1);
                assert.equal(result.geocoded_waypoints.length, count + 2);
                assert.equal(result.routes[0].legs.reduce((n, leg) => n + leg.distance.value, 0), (count + 1) * 100);
                assert.equal(result.routes[0].legs.reduce((n, leg) => n + leg.duration.value, 0), (count + 1) * 10);
                const allPoints = [result.routes[0].legs[0].start_location,
                    ...result.routes[0].legs.map(leg => leg.end_location)];
                assert.deepEqual(allPoints, [req.origin, ...req.waypoints.map(w => w.location), req.destination]);
                assert.equal(responses.length, Math.ceil((count + 1) / 26));
                completed = true;
            });
        assert.ok(completed);
        for (const call of calls) {
            assert.ok(call.waypoints.length <= 25);
            assert.equal(call.optimizeWaypoints, false);
            assert.equal(call.avoidTolls, true);
            assert.equal(call.avoidHighways, true);
        }
        assert.equal(req.waypoints.length, count);
    });
}
test('rejects too many points, optimisation and non-stopover points', () => {
    assert.throws(() => batch.split(request(101)), /100/);
    assert.throws(() => batch.split({...request(2), optimizeWaypoints: true}), /order/);
    const req = request(1); req.waypoints[0].stopover = false;
    assert.throws(() => batch.split(req), /stopover/);
});
test('failed second request never publishes a partial route or requests later sections', () => {
    let calls = 0, completions = 0;
    batch.calculate({route(r, cb) { calls++; cb(calls === 1 ? response(r) : null,
        calls === 1 ? 'OK' : 'ZERO_RESULTS'); }}, request(100), {}, (result, status, parts, message) => {
        completions++;
        assert.equal(result, null); assert.equal(parts, null);
        assert.equal(status, 'ZERO_RESULTS'); assert.match(message, /section 2 of 4/);
    });
    assert.equal(calls, 2); assert.equal(completions, 1);
});
test('ignores stale asynchronous responses', () => {
    let callback, current = true, completed = false;
    const req = request(100);
    batch.calculate({route(r, cb) { callback = () => cb(response(r), 'OK'); }}, req,
        {isCurrent: () => current}, () => { completed = true; });
    current = false; callback(); assert.equal(completed, false);
});
test('pins joining origin and rejects disconnected sections', () => {
    let calls = 0, previousEnd;
    batch.calculate({route(r, cb) {
        calls++;
        if (calls === 2) assert.equal(r.origin, previousEnd);
        const res = response(r);
        previousEnd = res.routes[0].legs.at(-1).end_location;
        if (calls === 2) res.routes[0].legs[0].start_location = point(999);
        cb(res, 'OK');
    }}, request(26), {}, (result, status, parts, message) => {
        assert.equal(result, null); assert.equal(status, 'INVALID_REQUEST'); assert.match(message, /meet/);
    });
});
test('rejects malformed successful response', () => {
    batch.calculate({route(r, cb) { cb({routes: []}, 'OK'); }}, request(1), {},
        (result, status) => { assert.equal(result, null); assert.equal(status, 'INVALID_REQUEST'); });
});

// Exercise the real application's result handler with lightweight Maps/Dojo
// substitutes, including renderers, markers, per-leg paths, bounds and totals.
test('application builds all 101 playback legs and clears all displays on recalculation', () => {
    let source = fs.readFileSync(__dirname + '/RouteView.js', 'utf8');
    const lastReturn = source.lastIndexOf('\n    return {');
    assert.ok(lastReturn > 0);
    source = source.slice(0, lastReturn) + `
        return {
            setup: function(results, rows) {
                map = {}; route_responses = results; route_location_rows = rows;
                directions_renderer = new google.maps.DirectionsRenderer();
                streetViewLayer = {getMap: function() { return undefined; }};
            },
            complete: cb_make_route, clear: clear_batch_display,
            state: function() { return {ready: route_ready, paths: polylines,
                markers: route_markers, extra: extra_renderers}; }
        };
    });`;
    const widgets = {}, elements = {}, renderers = [];
    const widget = id => widgets[id] ||= {set(key, value) { this[key] = value; },
        get(key) { return this[key]; }, hide() { this.hidden = true; }};
    function Renderer(opts) { Object.assign(this, opts); renderers.push(this); }
    Renderer.prototype.setMap = function(map) { this.map = map; };
    Renderer.prototype.setOptions = function(options) { Object.assign(this, options); };
    Renderer.prototype.setDirections = function(result) { this.result = result; };
    function Marker(opts) { Object.assign(this, opts); }
    Marker.prototype.setMap = function(map) { this.map = map; };
    function Polyline() { this.path = []; }
    Polyline.prototype.getPath = function() { return this.path; };
    Polyline.prototype.setMap = function(map) { this.map = map; };
    function Bounds() { this.points = []; }
    Bounds.prototype.extend = function(p) { this.points.push(p); };
    let app;
    vm.runInNewContext(source, {define(deps, factory) { app = factory(batch); },
        require() {}, console: {log() {}}, dijit: {byId: widget},
        document: {getElementById: id => elements[id] ||= {innerHTML: ''}},
        google: {maps: {DirectionsStatus: {OK: 'OK'}, DirectionsRenderer: Renderer,
            Marker, Polyline, LatLngBounds: Bounds}}});
    const req = request(100);
    batch.calculate({route(r, cb) { cb(response(r), 'OK'); }}, req, {}, (result, status, responses) => {
        app.setup(responses, Array.from({length: 102}, (_, i) => i));
        widget('id_btn_drive_1').disabled = true; // avoid viewport work in this mock
        app.complete(result, status);
        const state = app.state();
        assert.equal(state.ready, true); assert.equal(state.paths.length, 101);
        assert.equal(state.extra.length, 3); assert.equal(state.markers.length, 102);
        assert.equal(state.markers[101].label, '102');
        assert.equal(state.paths[100].path.length, 2);
        assert.match(elements.id_route_info.innerHTML, /10<\/b>&nbsp;kms/);
        assert.match(elements.id_route_info.innerHTML, /4 sections/);
        assert.ok(renderers.every(r => r.draggable === false));
        const displays = [...state.extra, ...state.markers];
        app.clear(); assert.ok(displays.every(d => d.map === null));
    });
});
