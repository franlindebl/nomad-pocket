"""Ways no route may use, by car, on foot or by bike (owner, 2026-10-31): private roads,
driveways, parking aisles and underground service roads. They stay on the map (the map is built
apart); only the routing graph leaves them out. Valhalla lets pedestrians and cyclists through
all of them and snaps a destination to the nearest one, so a walk to "Avenida del Mediterráneo,
28" (Madrid) went in through a garage ramp, along its underground aisles and out of another.
By car a search filter kept the ends on streets (routing-core.ts); now the graph itself doesn't
hold them.

Input: OPL (osmium cat -f opl) of the candidate ways, which build-country.sh picks with
osmium tags-filter; output: the ids to drop ("w123" per line) for osmium removeid.

Usage: python3 -I no-routing.py candidates.opl > drop.ids
       python3 -I no-routing.py --test
"""

import re
import sys

# Tag values that open a way to someone despite the rest: a private road with a public footpath
# (access=private + foot=yes) still carries walks.
OPEN = {"yes", "designated", "permissive", "destination"}
OPEN_KEYS = ("foot", "bicycle", "vehicle", "motor_vehicle", "motorcar")


def blocks_routing(tags):
    if "highway" not in tags:
        return False
    if any(tags.get(k) in OPEN for k in OPEN_KEYS):
        return False
    if tags.get("access") in ("private", "no"):
        return True
    if tags["highway"] != "service":
        return False
    if tags.get("service") in ("driveway", "parking_aisle"):
        return True
    # A service road underground is a garage's: its ramps and aisles are often tagged no more.
    return tags.get("tunnel") == "yes" and layer(tags) < 0


def layer(tags):
    try:
        return int(tags.get("layer", "0"))
    except ValueError:
        return 0


def opl_tags(field):
    """OPL's tag field: k=v pairs joined by ",", with %xx% escapes."""
    unescape = lambda s: re.sub(r"%([0-9a-fA-F]+)%", lambda m: chr(int(m.group(1), 16)), s)
    out = {}
    for pair in field.split(","):
        if "=" in pair:
            k, v = pair.split("=", 1)
            out[unescape(k)] = unescape(v)
    return out


def main(path):
    with open(path, encoding="utf-8") as f:
        for line in f:
            fields = line.split(" ")
            if not fields[0].startswith("w"):
                continue
            tags = next((opl_tags(x[1:]) for x in fields if x.startswith("T")), {})
            if blocks_routing(tags):
                print(fields[0])


def test():
    cases = [
        ({"highway": "service", "service": "driveway"}, True),
        ({"highway": "service", "service": "parking_aisle", "tunnel": "yes", "layer": "-1"}, True),
        ({"highway": "service", "tunnel": "yes", "layer": "-1"}, True),
        ({"highway": "service", "tunnel": "yes"}, False),  # a service road through a hill, not a garage
        ({"highway": "service", "tunnel": "building_passage"}, False),
        ({"highway": "service"}, False),
        ({"highway": "service", "service": "alley"}, False),
        ({"highway": "residential", "access": "private"}, True),
        ({"highway": "footway", "access": "no"}, True),
        ({"highway": "track", "access": "private", "foot": "yes"}, False),
        ({"highway": "service", "service": "driveway", "foot": "designated"}, False),
        ({"highway": "residential", "access": "destination"}, False),
        ({"highway": "residential", "access": "customers"}, False),
        ({"highway": "service", "service": "driveway", "layer": "x"}, True),
        ({"building": "yes", "access": "private"}, False),
    ]
    for tags, want in cases:
        assert blocks_routing(tags) is want, (tags, want)
    assert opl_tags("highway=service,name=Calle%20%de%2c%Abtao") == {"highway": "service", "name": "Calle de,Abtao"}
    print(f"ok, {len(cases)} cases")


if __name__ == "__main__":
    if sys.argv[1:] == ["--test"]:
        test()
    else:
        main(sys.argv[1])
