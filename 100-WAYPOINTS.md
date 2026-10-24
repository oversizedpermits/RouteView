# RouteView: 100 intermediate waypoints — first test build

Based on the supplied production copy, corresponding to baseline commit 50a1316
in oversizedpermits/RouteView. This is a candidate for local testing, not a
validated production release. The existing satellite default and Pause label
are retained.

## Changes

- 100 intermediate waypoints plus start and destination (102 numbered rows).
- Sequential Google Directions requests, each with at most 25 intermediate
  waypoints. 100 intermediate waypoints require four requests per calculation.
  Google usage charges/quotas apply to each request; editing can recalculate.
- Fixed waypoint order; no automatic reordering or truck-clearance routing.
- All returned legs feed the existing playback path, distance and duration.
- Section joins are pinned to the previous resolved endpoint and checked within
  one metre. A failed or disconnected section prevents playback of that route.
- Outdated responses are ignored after a newer calculation starts.
- Numeric map markers match the numbered input rows, including skipped blank rows.
- Routes requiring multiple requests must be edited through the waypoint list;
  line dragging is disabled for them, including after stopping playback.
- The add button cannot exceed the cap; overlong imported RouteView links are
  rejected. Google Maps link export is blocked for lists exceeding nine
  intermediate locations; use RouteView's Long URL instead.
- Existing console logging of the Google API key has been removed.

## Install in the development repository

Extract this ZIP to a new folder such as C:\RouteViewUpdate. Do not extract it
over production. In PowerShell:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\RouteViewUpdate\Install-TestVersion.ps1
```

The installer requires a clean feature/100-waypoints branch and verifies the
expected baseline content. It saves the replaced RouteView.js outside the
repository in its parent's Backups folder. It copies two application files,
the automated test and this note into the repository. It does not commit or push.

## Separate local IIS test site

After installation, open Windows PowerShell as Administrator and run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\RouteViewUpdate\Prepare-TestSite.ps1
```

This creates C:\RouteViewTest, copies application files from the development
repository and the vendor library/icons from production, grants IIS read access,
and adds a separate IIS site named RouteViewTest bound to localhost on port 8081.
It does not copy or expose the Git directory. It does not modify the existing
production site or files. It refuses to overwrite an existing test folder/site
or use a listening port. View http://localhost:8081/RouteView.html and Ctrl+F5.

This script has been reviewed but cannot be run against your Windows IIS here.
Share any errors before changing IIS settings manually. The application's About
page/media are not copied into the test site. They are not needed for routing.

Browser local storage is separate by port, so the test site may ask you to enter
your existing Google Maps key in Configuration. Do not put the key in Git. If
the key's referrer restrictions reject this test address, share the error text
with the key removed so we can configure the permitted local address precisely.

## Manual acceptance checks — still required

1. A normal two-location route calculates, uses satellite view and plays.
2. A short route with intermediate locations retains the entered order; adding,
   removing and moving locations recalculates correctly.
3. A route with 25 intermediate waypoints works in one request.
4. A route with 26 intermediate waypoints works in two requests. Inspect the
   join near location 27 and play/seek across that join in both directions.
5. Check 50 and then 100 intermediate waypoints. At 100, confirm 102 rows,
   101 legs, four sections and no missing/duplicated markers at the joins.
6. Check total distance/duration, whole-route playback, individual legs, pause,
   resume, stop and slider seeking near the start, joins and destination.
7. Try a failing/unrouteable section. A clear error should appear and playback
   must remain blocked. Fix it and ensure a fresh complete route works.
8. Change a waypoint while a calculation is outstanding. The older result must
   not replace the newer route.
9. Save/reopen a RouteView Long URL with more than 25 waypoints. Confirm row
   order and playback. Existing GPX export requires resolved place geometry;
   it has not been redesigned or validated in this change.
10. Confirm line dragging stays disabled on multi-section routes after Stop,
    and the add controls stop at the maximum. Check optional blank rows.

Google driving directions still do not certify a route for oversized vehicles.
This update changes waypoint capacity; it does not assess clearances/hazards.

## Automated checks

With Node.js available, run `node --test routeview-batch.test.cjs` from the
repository. The 16 tests cover boundaries from zero to 100 intermediate
waypoints, ordering, totals, API limits/options, rejected unsupported input,
section failure, stale callbacks, join validation, malformed responses, and
the actual application result handler's 101 playback polylines, 102 numbered
markers, four renderers and display cleanup using Maps/Dojo substitutes.
JavaScript syntax checks also pass. These checks do not call Google Maps or
perform a browser fly-through. No live API key was used for development.

## Roll back this uncommitted test build

Production has not been changed. Keep the test site separate. Restore the saved
RouteView.js from the installer backup into the development repository and
remove the newly installed RouteViewBatch.js, routeview-batch.test.cjs and this
note if you want to abandon this candidate. No Git history needs rewriting.
