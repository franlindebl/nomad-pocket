#!/usr/bin/env python3
"""How long each official register has been failing, so that a server down for a night pages no one.

official-points.yml asks every country on the 1st and, every day, again only the countries whose last fetch
failed. A source that doesn't answer keeps last month's rows (each <cc>.py does that); this script writes into
<cc>.official.report.json, per source, the last day it answered (freshAt) and the first day of its current
failure (failingSince), carried over from the report of the run before, and tells the workflow how loud to be:
a warning while a source has failed for under a week (the run stays green: no email), an error once it has
failed for a week straight (the run fails and GitHub emails).

Usage:
  python3 -I state.py mark <report.json> [--previous <report.json>] [--status <exit code>] [--only <source> ...]
                           [--output <file>] [--today YYYY-MM-DD]
      Rewrites the report with the dates and appends level=ok|warn|error and message=… to --output
      ($GITHUB_OUTPUT; stdout without it). --only: the sources es.py was asked for; the others keep the state
      they had.
  python3 -I state.py due <reports dir> <cc> ...
      Prints countries=<json list> and only=<sources>: the countries whose last fetch failed or that never ran,
      and for Spain the sources to ask again (es.py --only; empty: all of them).
Standard library only (CI runs it on a bare runner).
"""
import datetime
import json
import os
import sys

DAYS = 7  # a source failing for this many days in a row turns the run red


def load(path):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def days_since(day, today):
    return (datetime.date.fromisoformat(today) - datetime.date.fromisoformat(day)).days


def mark(report, previous, status, only, today):
    """Adds freshAt / failingSince to the report's sources (in place); returns (level, message)."""
    before = (previous or {}).get("sources", {})
    sources = report.setdefault("sources", {})
    if only is not None:
        # Sources es.py wasn't asked for: their rows came from the last run, so does their state (es.py writes
        # no entry for most of them, and "kept last month's" for the centres).
        for sid, old in before.items():
            if sid not in only:
                state = {k: old[k] for k in ("status", "freshAt", "failingSince") if k in old}
                sources[sid] = {**old, **sources.get(sid, {}), **state}
    for sid, s in sources.items():
        if only is not None and sid not in only:
            continue
        old = before.get(sid, {})
        if s.get("status") == "fresh":
            s["freshAt"] = today
            s.pop("failingSince", None)
        else:
            s["failingSince"] = old.get("failingSince") or today
            if "freshAt" in old:
                s["freshAt"] = old["freshAt"]
    failing = {sid: s for sid, s in sources.items() if "failingSince" in s}
    # A script that ends in failure while every source says fresh (a bug, or a failure outside the sources).
    if status and not failing:
        report["scriptFailingSince"] = (previous or {}).get("scriptFailingSince") or today
        failing["script"] = {"failingSince": report["scriptFailingSince"], "status": f"exit status {status}"}
    else:
        report.pop("scriptFailingSince", None)
    report["checkedAt"] = today
    if not failing:
        return "ok", ""
    worst = max(days_since(s["failingSince"], today) for s in failing.values())
    message = "; ".join(
        f"{sid} failing since {s['failingSince']} ({days_since(s['failingSince'], today)} d): {s.get('status', '')}"
        for sid, s in sorted(failing.items()))
    return ("error" if worst >= DAYS else "warn"), message


def due(reports_dir, countries):
    """The countries to ask again, and Spain's sources to ask (empty: all)."""
    out, only = [], []
    for cc in countries:
        report = load(os.path.join(reports_dir, f"{cc}.official.report.json"))
        if report is None:  # never ran (a new script): ask it
            out.append(cc)
            continue
        # By status, not failingSince: reports written before this script have no dates.
        failing = [sid for sid, s in report.get("sources", {}).items() if isinstance(s, dict) and s.get("status") != "fresh"]
        if failing or report.get("scriptFailingSince"):
            out.append(cc)
            if cc == "es" and not report.get("scriptFailingSince"):
                only = failing
    return out, only


def one_line(text):
    # One line for $GITHUB_OUTPUT, escaped for a workflow command (::warning::…), where % starts an escape.
    return text.replace("%", "%25").replace("\r", " ").replace("\n", " ")


def main(argv):
    if argv[:1] == ["mark"]:
        path = argv[1]
        opt = lambda name: argv[argv.index(name) + 1] if name in argv else None  # noqa: E731
        only = None
        if "--only" in argv:
            rest = argv[argv.index("--only") + 1:]
            only = rest[:next((i for i, a in enumerate(rest) if a.startswith("--")), len(rest))]
        report = load(path)
        if report is None:
            print(f"no report at {path}", file=sys.stderr)
            return 1
        previous = load(opt("--previous")) if opt("--previous") else None
        today = opt("--today") or datetime.datetime.now(datetime.timezone.utc).date().isoformat()
        level, message = mark(report, previous, int(opt("--status") or 0), only, today)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(report, f, indent=1, ensure_ascii=False)
        lines = f"level={level}\nmessage={one_line(message)}\n"
        if opt("--output"):
            with open(opt("--output"), "a", encoding="utf-8") as f:
                f.write(lines)
        else:
            sys.stdout.write(lines)
        print(f"{level}: {message or 'every source answered'}", file=sys.stderr)
        return 0
    if argv[:1] == ["due"]:
        countries, only = due(argv[1], argv[2:])
        print(f"countries={json.dumps(countries)}")
        print(f"only={' '.join(only)}")
        return 0
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
