/* RouteView multi-request routing. BSD-3-Clause; see LICENSE. */
(function (factory) {
    if (typeof define === 'function' && define.amd) define([], factory);
    else if (typeof module === 'object' && module.exports) module.exports = factory();
}(function () {
    'use strict';
    var MAX_WAYPOINTS = 100;
    var REQUEST_WAYPOINTS = 25;

    function split(request) {
        var waypoints = request.waypoints || [];
        if (waypoints.length > MAX_WAYPOINTS) throw new Error('Maximum 100 intermediate waypoints.');
        if (request.optimizeWaypoints) throw new Error('Waypoint order must remain fixed.');
        waypoints.forEach(function (wp) {
            if (wp.stopover === false) throw new Error('Batch routing requires stopover waypoints.');
        });
        var locations = [request.origin].concat(waypoints.map(function (wp) {
            return wp.location;
        }), [request.destination]);
        var batches = [];
        for (var start = 0; start < locations.length - 1; start += REQUEST_WAYPOINTS + 1) {
            var end = Math.min(start + REQUEST_WAYPOINTS + 1, locations.length - 1);
            var batch = Object.assign({}, request, {
                origin: locations[start], destination: locations[end],
                waypoints: locations.slice(start + 1, end).map(function (location) {
                    return {location: location, stopover: true};
                }),
                optimizeWaypoints: false, provideRouteAlternatives: false
            });
            batches.push(batch);
        }
        return batches;
    }

    function separation(a, b) {
        function coordinate(p, name) {
            return typeof p[name] === 'function' ? p[name]() : p[name];
        }
        var rad = Math.PI / 180;
        var latA = coordinate(a, 'lat') * rad;
        var latB = coordinate(b, 'lat') * rad;
        var dlat = latB - latA;
        var dlng = (coordinate(b, 'lng') - coordinate(a, 'lng')) * rad;
        var h = Math.sin(dlat / 2) * Math.sin(dlat / 2) +
            Math.cos(latA) * Math.cos(latB) * Math.sin(dlng / 2) * Math.sin(dlng / 2);
        return 12742000 * Math.asin(Math.sqrt(Math.min(1, h)));
    }

    // The aggregate is for playback/totals only. Render each unmodified Google
    // result separately, preserving its attribution and warnings.
    function merge(responses, request) {
        var legs = [], summaries = [], warnings = [], geocoded = [];
        responses.forEach(function (response, index) {
            var route = response.routes[0];
            if (index && !(separation(legs[legs.length - 1].end_location,
                    route.legs[0].start_location) <= 1)) {
                throw new Error('Routing sections do not meet within 1 metre. Review the joining waypoint.');
            }
            legs = legs.concat(route.legs);
            if (route.summary && summaries.indexOf(route.summary) === -1) summaries.push(route.summary);
            warnings = warnings.concat(route.warnings || []);
            geocoded = geocoded.concat((response.geocoded_waypoints || []).slice(index ? 1 : 0));
        });
        return {
            request: request,
            geocoded_waypoints: geocoded,
            routes: [{legs: legs, summary: summaries.join(' / '), warnings: warnings}]
        };
    }

    function calculate(service, request, options, done) {
        options = options || {};
        var batches;
        try { batches = split(request); }
        catch (error) { done(null, 'INVALID_REQUEST', null, error.message); return; }
        var responses = [];
        function current() { return !options.isCurrent || options.isCurrent(); }
        function next(index) {
            if (!current()) return;
            if (index === batches.length) {
                var merged;
                try { merged = merge(responses, request); }
                catch (error) { done(null, 'INVALID_REQUEST', null, error.message); return; }
                done(merged, 'OK', responses);
                return;
            }
            var batch = Object.assign({}, batches[index]);
            // Pin the next section to the previous section's resolved endpoint.
            if (index) {
                var previous = responses[index - 1].routes[0].legs;
                batch.origin = previous[previous.length - 1].end_location;
            }
            if (options.onRequest) options.onRequest(index, batches.length);
            service.route(batch, function (response, status) {
                if (!current()) return;
                if (status !== 'OK') {
                    done(null, status, null, 'Route section ' + (index + 1) + ' of ' + batches.length +
                        ' failed (' + status + '). No partial route is available for playback.');
                    return;
                }
                var route = response && response.routes && response.routes[0];
                if (!route || !route.legs || route.legs.length !== batch.waypoints.length + 1) {
                    done(null, 'INVALID_REQUEST', null, 'Unexpected number of route legs in section ' + (index + 1) + '.');
                    return;
                }
                responses.push(response);
                next(index + 1);
            });
        }
        next(0);
    }
    return {split: split, merge: merge, calculate: calculate, maxWaypoints: MAX_WAYPOINTS};
}));
