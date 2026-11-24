#!/usr/bin/env python3
"""Bounded read-only CI coordinator. Never writes Git refs or adopts lane heads."""
import argparse
import datetime as dt
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import unittest
from urllib.parse import urlencode
from urllib.request import Request, urlopen

BRANCHES = {
    "22": "agent22/satnav-contracts-20261124",
    "23": "agent23/satnav-terrain-20261124",
    "24": "agent24/satnav-hybrid-router-20261124",
    "public": "main",
}
SHA = re.compile(r"^[a-f0-9]{40}$")
REPO = "Ventusltd/satnav"

def git(*args):
    return subprocess.check_output(["git", *args], text=True, timeout=60).strip()

def revision(value):
    if not SHA.fullmatch(value):
        raise ValueError("invalid revision")
    return value

def observed_heads():
    return {k: revision(git("rev-parse", "refs/remotes/origin/" + b))
            for k, b in BRANCHES.items()}

def read_lock(head):
    return json.loads(git("show", revision(head) + ":automation/trio-lock.json"))

def compare(lock, heads):
    if lock.get("schema_version") != 1:
        raise ValueError("unsupported lock schema")
    pins = {str(x["agent"]): revision(x["head"]) for x in lock["lanes"]}
    if len(lock["lanes"]) != 2 or set(pins) != {"23", "24"}:
        raise ValueError("missing or duplicate lanes")
    pins["public"] = revision(lock["published_baseline"])
    return [{"lane": k, "pinned": v, "observed": heads[k]}
            for k, v in sorted(pins.items()) if heads[k] != v]

def get_runs(head):
    token = os.environ.get("GH_TOKEN")
    if not token:
        raise RuntimeError("read-only CI token unavailable")
    url = ("https://api.github.com/repos/" + REPO +
           "/actions/workflows/trio-integration.yml/runs?" +
           urlencode({"head_sha": revision(head), "per_page": 20}))
    req = Request(url, headers={"Authorization": "Bearer " + token,
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "satnav-ci"})
    with urlopen(req, timeout=20) as response:
        data = json.loads(response.read(2_000_000))
    return [r for r in data["workflow_runs"] if r["head_sha"] == head]

def decision(runs, force=False, daily=False):
    if force or daily:
        return "RUN"
    if not runs:
        return "RUN"
    newest = max(runs, key=lambda r: (r["created_at"], r["id"]))
    if newest["status"] != "completed":
        return "WAIT_FOR_CI"
    if newest["conclusion"] == "success":
        return "REUSE_EXACT_HEAD_CI"
    return "FAILED_HEAD_REQUIRES_REVIEW"

def execute_candidate(head, out):
    # Test only the exact integrator tree and its explicit lock; observed lane
    # heads are diagnostics, never substituted. No token in candidate subprocess.
    env = {k: v for k, v in os.environ.items()
           if not any(t in k.upper() for t in ("TOKEN", "SECRET", "PASSWORD"))
           and not k.startswith(("GITHUB_", "ACTIONS_"))}
    with tempfile.TemporaryDirectory(prefix="satnav-ci-") as tmp:
        path = Path(tmp) / "candidate"
        git("worktree", "add", "--detach", str(path), revision(head))
        try:
            proc = subprocess.run(
                ["python", "automation/integrate_trio.py", "--integrator", head,
                 "--out", str(out.resolve())], cwd=path, env=env,
                capture_output=True, text=True, timeout=600)
            return proc.returncode, (proc.stdout + proc.stderr)[-8000:]
        finally:
            git("worktree", "remove", "--force", str(path))

def main(force=False, out=Path("ci-receipts")):
    out.mkdir(parents=True, exist_ok=True)
    now = dt.datetime.now(dt.timezone.utc)
    receipt = {"schema_version": 1, "utc": now.isoformat(),
               "status": "FAIL", "scope": "synthetic CI; not field acceptance"}
    try:
        heads = observed_heads()
        receipt["observed_heads"] = heads
        head = heads["22"]
        lock = read_lock(head)
        receipt["pinned_lock"] = lock
        receipt["review_required"] = compare(lock, heads)
        runs = get_runs(head)
        receipt["existing_ci"] = [{k: r.get(k) for k in
            ("id", "head_sha", "status", "conclusion", "html_url", "created_at")}
            for r in runs]
        action = decision(runs, force=force, daily=now.hour == 3)
        receipt["decision"] = action
        if action == "RUN":
            code, tail = execute_candidate(head, out / "composition.json")
            receipt.update(exit_code=code, log_tail=tail)
            receipt["status"] = "PASS" if code == 0 else "FAIL"
        elif action == "REUSE_EXACT_HEAD_CI":
            receipt["status"] = "REUSED_PASS"
        elif action == "WAIT_FOR_CI":
            receipt["status"] = "WAITING"
        else:
            receipt["status"] = "FAIL"
            receipt["error"] = "Latest exact-head CI did not pass; inspect before retry"
    except Exception as exc:
        receipt["error"] = str(exc)
    finally:
        (out / "coordinator.json").write_text(
            json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
        summary = ("SatNav CI: " + receipt["status"] + "; " +
                   str(len(receipt.get("review_required", []))) +
                   " observed revisions require lock review")
        print(summary)
        if os.environ.get("GITHUB_STEP_SUMMARY"):
            with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as f:
                f.write("### " + summary + "\n\n")
                for item in receipt.get("review_required", []):
                    f.write("- Lane " + item["lane"] + ": " + item["observed"] +
                            " differs from pin " + item["pinned"] + "\n")
                f.write("\nSee JSON receipts. No publication or navigation approval.\n")
    return int(receipt["status"] == "FAIL")

class PolicyTests(unittest.TestCase):
    def test_exact_head_policy(self):
        a = {"id": 1, "created_at": "2026-01-01", "status": "completed",
             "conclusion": "success"}
        b = {**a, "id": 2, "conclusion": "failure"}
        self.assertEqual(decision([a]), "REUSE_EXACT_HEAD_CI")
        self.assertEqual(decision([a, b]), "FAILED_HEAD_REQUIRES_REVIEW")
        self.assertEqual(decision([{**b, "status": "in_progress"}]), "WAIT_FOR_CI")
        self.assertEqual(decision([]), "RUN")
        self.assertEqual(decision([b], daily=True), "RUN")
        self.assertEqual(decision([a], force=True), "RUN")
    def test_pins_never_follow_observed(self):
        a, b, c = "a"*40, "b"*40, "c"*40
        lock = {"schema_version":1, "lanes":[{"agent":23,"head":a},
                {"agent":24,"head":a}], "published_baseline":a}
        diff = compare(lock, {"23":b,"24":a,"public":c})
        self.assertEqual([x["lane"] for x in diff], ["23","public"])
        self.assertEqual(lock["lanes"][0]["head"], a)
        with self.assertRaises(ValueError):
            compare({**lock,"lanes":lock["lanes"][:1]}, {"23":b,"24":a,"public":c})


    def test_idle_main_exit_and_receipt(self):
        from unittest.mock import patch
        from types import SimpleNamespace
        head = "a"*40
        heads = {k: head for k in BRANCHES}
        lock = {"schema_version":1,"lanes":[{"agent":23,"head":head},
                {"agent":24,"head":head}],"published_baseline":head}
        frozen = dt.datetime(2026,11,24,12,0,tzinfo=dt.timezone.utc)
        for status, conclusion, expected, code in [
            ("completed","success","REUSED_PASS",0),
            ("in_progress",None,"WAITING",0),
            ("completed","failure","FAIL",1),
        ]:
            with self.subTest(status=status, conclusion=conclusion):
                run = {"id":1,"head_sha":head,"created_at":"2026-11-24",
                       "status":status,"conclusion":conclusion}
                with tempfile.TemporaryDirectory() as tmp, \
                     patch.dict(os.environ, {"GITHUB_STEP_SUMMARY":""}), \
                     patch(__name__+".dt", SimpleNamespace(datetime=SimpleNamespace(now=lambda _: frozen),timezone=dt.timezone)), \
                     patch(__name__+".observed_heads",return_value=heads), \
                     patch(__name__+".read_lock",return_value=lock), \
                     patch(__name__+".get_runs",return_value=[run]), \
                     patch(__name__+".execute_candidate") as compose:
                    self.assertEqual(main(out=Path(tmp)),code)
                    receipt=json.loads((Path(tmp)/"coordinator.json").read_text())
                    self.assertEqual(receipt["status"],expected)
                    compose.assert_not_called()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        unittest.main(argv=["scheduled_ci"], exit=True)
    raise SystemExit(main(force=args.force))
