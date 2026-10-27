# Maps: a navigation view that reads like Google Maps' — plan

Owner request (2026-10-27): the navigation view went 3D and followed the user, but it was hard to
read. In Google Maps the route behind you disappears, and the map and the arrow turn the way your
last metres went. Approved the same day with three decisions: the travelled part goes away like
Google's; standing on foot, the map holds and only the compass beam turns; a "Norte arriba" toggle
ships now.

## What was wrong (code as of 613f687)

1. **The route was never consumed**: `route-line` drew the whole shape in one colour.
2. **The arrow followed the raw GPS fix** (`FollowCamera.tsx`, `center: [p.lon, p.lat]`), so
   jitter pulled it off the street.
3. **The bearing came from the route 30 m ahead** (`RouteProgress.aheadBearing`): about 15 m
   before a right-angle corner the map had already turned ~45°, and the arrow (always up) pointed
   at the buildings. Walking back along the route, map and arrow still faced "forward".
4. **On foot the GPS course was never used**: it was kept only above 2 m/s (7.2 km/h; walking is
   ~1.4 m/s), so off the route the map turned with the compass (the phone), not the walk.
5. **The camera trailed one fix behind**: each fix eased to that fix over the last gap, 1–2 s
   late (15–30 m at 50 km/h), slowing and speeding up as the fix rhythm changed.
6. Fixed 45° tilt and zoom by mode/speed only; nothing near a turn.

## How others do it

- **Google Maps / Waze**: heading up (north up as an option), the arrow snapped to the road, the
  route behind the arrow gone, the arrow grey without GPS, zoom by speed and in before maneuvers.
- **Mapbox Navigation SDK** (documented): a *vanishing route line* (the part behind the puck
  transparent or another colour, driven by the puck's position); a following camera with 45° pitch,
  the puck low on the screen, bearing smoothing that blends the course with the way to the next
  maneuver, and a flatter view near maneuvers.
- **MapLibre** has no `line-trim-offset` (Mapbox only). `line-gradient` + `lineMetrics` exist, but
  the progress is measured in projected units and sampled into a texture, too coarse to cut a long
  route exactly at the arrow; we slice the line instead.

## What we build (done 2026-10-27, `follow-core.ts`, `routing-core.ts`, `FollowCamera.tsx`)

1. **Direction of travel**: a 30 s track of fixes (`pushFix`); `travelBearing` measures the last
   8 m on foot, 12 m by bike, 15 m by car (or the fix's error if larger; fixes worse than 40 m are
   skipped). `movingBearing`: a car's GPS course first, the track first on foot/bike.
2. **The road where you are**: `RouteProgress.roadBearing` is the chord from a few metres behind to
   a few ahead of the snapped point (car 10/20 m, bike 6/12, foot 4/8), so the map turns while going
   round the corner, not before. Also `alongM` and `snapped`.
3. **Bearing** (`followBearing`): on the route, the road's, unless moving > 90° against it; off
   it, the way the user moves; standing off the route, held (no compass; the very first bearing on
   foot may come from it). `smoothTurn`: 2° dead band, at most 90°/s (car, bike) or 60°/s (foot).
4. **Wrong way** (`isWrongWay`, > 120° against the road) counts like a fix off the route: two in a
   row reroute (same 10 s limit), starting the way the user moves.
5. **Camera glides ahead**: the centre is the snapped point moved along the route by speed × the
   expected gap to the next fix (`followCenter`, at most 60 m; off the route, straight on), and the
   ease lasts that gap (smoothed). Zoom adds 0.75 about ten seconds (≥ 150 m) before a car's
   maneuver, 0.5 on foot (< 30 m) and bike (< 60 m). Pitch: car 45°, bike 40°, foot 30°.
6. **Route consumed**: while navigating the line starts at the snapped point (the rest is sliced
   off); the preview still shows the whole route.
7. **Arrow**: grey when the fix is worse than 50 m, or none came for 10 s while the user was moving
   (`isWeakFix`; standing brings no fixes either, the 3 m distance filter). On foot
   and by bike the compass beam sits under the arrow (a view, so its apex stays on the arrow).
8. **Norte arriba** (`map-north-up`, persisted `navNorthUp`): the FAB shows where north is; pressed,
   the map stays north up and the arrow turns with the direction of travel.

## Still to check

- A walk and a drive on a real phone (simulators give perfect fixes): the corner turn, the 60°/s
  limit on foot, the glide at 1 Hz in a car, the line cut under the arrow, the grey arrow indoors.
- Android emulator with a route playback.
- Later (not now): maneuver arrows drawn on the map at the turn, a flatter camera at complex
  junctions, the travelled part kept in grey as an option.

Sources: [Mapbox route line](https://docs.mapbox.com/android/navigation/guides/ui-components/route-line.md),
[MapboxRouteLineApi](https://docs.mapbox.com/android/navigation/api/coreframework/3.31.0/ui-maps/com.mapbox.navigation.ui.maps.route.line.api/-mapbox-route-line-api/),
[FollowingFrameOptions](https://docs.mapbox.com/android/navigation/api/coreframework/3.0.3/libnavui-maps/com.mapbox.navigation.ui.maps.camera.data/-following-frame-options/),
[line-trim-offset](https://docs.mapbox.com/android/maps/api/11.5.1/mapbox-maps-android/com.mapbox.maps.extension.style.layers.generated/-line-layer/line-trim-offset.html).
