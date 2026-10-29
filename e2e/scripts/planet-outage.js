// Turns the stand-in planet build (scripts/dev-planet-server.ts) off for MS milliseconds (0: back on).
// PLANET_PORT comes from scripts/e2e.sh, MS from the flow.
var res = http.get('http://localhost:' + PLANET_PORT + '/__outage?ms=' + MS);
if (res.status !== 204) throw new Error('planet outage: HTTP ' + res.status);
