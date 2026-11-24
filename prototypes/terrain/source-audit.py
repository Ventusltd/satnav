"""Pinned upstream source audit for Agent23; not operational data approval."""
import argparse
import hashlib
import json
from pathlib import Path
import sys
import urllib.request

ATLAS = "1c9ed251ea31de67cc9d7e3b3d7908ea6aa39779"
MATHS = "8e91b07d8312acca5bcaef43e839f06a3b1d642a"
LICENSE = "d645695673349e3947e8e5ae42332d0ac3164cd7"
SOURCES = [
    ("GridAtlas", ATLAS, "tools/vicinity/src/model.mjs", "4e6573e3798e4f6483ed546b29020da8992f194d", "vicinity.mjs"),
    ("GridAtlas", ATLAS, "atlas/modules/202609011950-geodesy.js", "bfc364925b05a4295fc916fc6d55ec771b337548", "atlas-geodesy.mjs"),
    ("grid-distance-maths", MATHS, "src/geodesy.mjs", "5a0320ca6db05273fae14f786b20223b088bc60b", "canonical-geodesy.mjs"),
    ("GridAtlas", ATLAS, "LICENSE", LICENSE, "atlas-LICENSE"),
    ("grid-distance-maths", MATHS, "LICENSE", LICENSE, "maths-LICENSE"),
]
LIMIT = 1_000_000

def blob_hash(data):
    return hashlib.sha1(f"blob {len(data)}\0".encode() + data).hexdigest()

def checked_read(path):
    with path.open("rb") as stream:
        return stream.read(LIMIT + 1)

def fetch_source(root, item):
    repo, revision, path, expected, target = item
    dest = root / target
    cached = dest.is_file()
    if cached:
        data = checked_read(dest)
        if len(data) > LIMIT or blob_hash(data) != expected:
            raise ValueError(f"Invalid cached bytes: {target}")
    else:
        url = f"https://raw.githubusercontent.com/Ventusltd/{repo}/{revision}/{path}"
        with urllib.request.urlopen(url, timeout=30) as response:
            data = response.read(LIMIT + 1)
        if len(data) > LIMIT or blob_hash(data) != expected:
            raise ValueError(f"Invalid upstream bytes: {target}")
        dest.write_bytes(data)
    return {"repo": repo, "revision": revision, "path": path,
            "git_blob": expected, "sha256": hashlib.sha256(data).hexdigest(),
            "bytes": len(data), "cache_hit": cached}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fixtures", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args()
    receipt = {"schema": 1, "status": "FAIL", "sources": [],
               "scope": "source-code integrity only",
               "repository_code_licence": "Apache-2.0 (pinned LICENSE files)",
               "asset_data": {"status": "NOT_APPROVED", "revision": ATLAS,
                   "historical_path": "atlas/releases/202608300453-atlas-v9/data/grid_substations.geojson",
                   "tree_blob": "242a63461ba3e07f3fffb6b16677711fa4a644b2",
                   "tree_bytes": 1192748,
                   "content_audited": False, "data_licence_verified": False,
                   "spatial_coverage_verified": False, "access_verified": False,
                   "navigation_permitted": False},
               "jurisdiction": {"classifier": "synthetic fixture only",
                   "operational_four_nation_coverage": False}}
    try:
        args.fixtures.mkdir(parents=True, exist_ok=True)
        for item in SOURCES:
            receipt["sources"].append(fetch_source(args.fixtures, item))
        receipt["status"] = "PASS"
    except Exception as exc:
        receipt["error"] = str(exc)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(receipt, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(receipt, sort_keys=True))
    return 0 if receipt["status"] == "PASS" else 1

if __name__ == "__main__":
    sys.exit(main())
