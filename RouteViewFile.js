/* RouteView route files. BSD-3-Clause; see LICENSE. */
(function (factory) {
    if (typeof define === 'function' && define.amd) define(['./RouteViewBatch.js'], factory);
    else if (typeof module === 'object' && module.exports) module.exports = factory(require('./RouteViewBatch.js'));
}(function (RouteViewBatch) {
    'use strict';

    var maxBytes = 1024 * 1024;

    function validText(value, maxLength) {
        return typeof value === 'string' && value.length <= maxLength && value.trim().length > 0 && !/[\r\n]/.test(value);
    }

    function inRange(value, min, max) {
        return Number.isFinite(value) && value >= min && value <= max;
    }

    function normalize(route) {
        if (!route || !validText(route.name, 120)) {
            throw new Error('Enter a route name of 1 to 120 characters.');
        }
        var locations = route.locations;
        if (!Array.isArray(locations) || locations.length < 2) {
            throw new Error('The route must include a start and destination.');
        }
        if (locations.length > RouteViewBatch.maxWaypoints + 2) {
            throw new Error('Maximum 100 intermediate waypoints plus start and destination.');
        }
        if (locations.some(function (value) { return !validText(value, 2048); })) {
            throw new Error('Each route location must contain 1 to 2,048 characters on a single line.');
        }
        if (typeof route.avoidHighways !== 'boolean' || typeof route.avoidTolls !== 'boolean') {
            throw new Error('The route must include valid highway and toll preferences.');
        }
        if (!inRange(route.stepMeters, 20, 1000) || !inRange(route.intervalMs, 350, 10000)) {
            throw new Error('Playback requires a step of 20 to 1,000 metres and an interval of 350 to 10,000 ms.');
        }

        return {
            format: 'routeview',
            version: 1,
            name: route.name.trim(),
            locations: locations.map(function (value) { return value.trim(); }),
            avoidHighways: route.avoidHighways,
            avoidTolls: route.avoidTolls,
            stepMeters: route.stepMeters,
            intervalMs: route.intervalMs
        };
    }

    function parse(text) {
        var route;
        try {
            route = JSON.parse(text.replace(/^\uFEFF/, ''));
        } catch (error) {
            throw new Error('This file does not contain valid JSON.');
        }
        if (!route || route.format !== 'routeview') {
            throw new Error('Choose a RouteView route file.');
        }
        if (route.version !== 1) {
            throw new Error('This RouteView route file version is unsupported.');
        }
        return normalize(route);
    }

    function serialize(route) {
        var text = JSON.stringify(normalize(route), null, 2) + '\n';
        if (new Blob([text]).size > maxBytes) {
            throw new Error('The route file exceeds 1 MiB.');
        }
        return text;
    }

    return {parse: parse, serialize: serialize, maxBytes: maxBytes};
}));
