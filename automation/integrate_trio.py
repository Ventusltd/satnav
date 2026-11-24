#!/usr/bin/env python3
"""Read-only composition of exact committed SatNav candidates. Never pushes or merges."""
import argparse, hashlib, json, re, subprocess, tempfile, time, os, urllib.request
from pathlib import Path, PurePosixPath

SHA=re.compile(r"^[0-9a-f]{40}$")
def git(*args):
    return subprocess.check_output(["git",*args],timeout=60)
def safe_path(s):
    p=PurePosixPath(s)
    if not s or p.is_absolute() or ".." in p.parts or "\\" in s or ":" in s or str(p)!=s or s=="." or any(x.lower()==".git" for x in p.parts):
        raise ValueError("unsafe path: "+s)
    return p
def commit(s):
    if not SHA.fullmatch(s) or git("rev-parse",s+"^{commit}").decode().strip()!=s: raise ValueError("bad commit: "+s)
    return s
def descendants(base,head):
    if subprocess.run(["git","merge-base","--is-ancestor",base,head],timeout=60).returncode: raise ValueError("head not descended from baseline")
def tree(head):
    out={}
    for item in git("ls-tree","-r","-z",head).split(b"\0"):
        if not item: continue
        meta,path=item.split(b"\t",1);mode,kind,oid=meta.decode().split()
        s=path.decode("utf-8");safe_path(s)
        if kind!="blob" or mode not in ("100644","100755"): raise ValueError("nonregular source: "+s)
        out[s]=(mode,oid)
    return out
def assemble(lock,integrator):
    if lock.get("schema_version")!=1: raise ValueError("bad lock")
    base=commit(lock["baseline"]);integrator=commit(integrator);descendants(base,integrator)
    original=tree(base);selected=tree(integrator);owners={p:22 for p in selected}
    # Lane branches retain the original common baseline; compose the approved
    # public scope independently, without rebasing another agent's branch.
    published=commit(lock["published_baseline"]);descendants(base,published)
    published_tree=tree(published)
    delta={p for p in set(original)|set(published_tree) if original.get(p)!=published_tree.get(p)}
    if delta!=set(lock["published_paths"]):raise ValueError("published baseline path-set mismatch")
    for p in sorted(delta):
        if p not in published_tree or p in original:raise ValueError("unexpected published baseline change: "+p)
        if p in selected and selected[p]!=published_tree[p]:raise ValueError("published scope collision: "+p)
        selected[p]=published_tree[p];owners[p]="published_scope"
    for p,entry in original.items():
        if selected.get(p)!=entry:raise ValueError("original baseline modified: "+p)
    seen=set()
    for lane in lock["lanes"]:
        agent=lane["agent"]
        if agent not in (23,24) or agent in seen:raise ValueError("bad lane")
        seen.add(agent);head=commit(lane["head"]);descendants(base,head);current=tree(head)
        changed={p for p in set(original)|set(current) if original.get(p)!=current.get(p)}
        if changed!=set(lane["paths"]):raise ValueError(f"Agent {agent} path-set mismatch: {sorted(changed)}")
        for p in sorted(changed):
            safe_path(p)
            if p not in current:raise ValueError("deletion forbidden: "+p)
            if p in selected and selected[p]!=original.get(p):raise ValueError("ownership collision: "+p)
            if p in original:raise ValueError("baseline modification requires explicit review: "+p)
            selected[p]=current[p];owners[p]=agent
    if seen!={23,24}:raise ValueError("missing lane")
    return selected,owners
def asset_fixtures(root):
    root.mkdir()
    sources=[
        ("gridatlas","1c9ed251ea31de67cc9d7e3b3d7908ea6aa39779","tools/vicinity/src/model.mjs","4e6573e3798e4f6483ed546b29020da8992f194d","vicinity.mjs"),
        ("gridatlas","1c9ed251ea31de67cc9d7e3b3d7908ea6aa39779","atlas/modules/202609011950-geodesy.js","bfc364925b05a4295fc916fc6d55ec771b337548","atlas-geodesy.mjs"),
        ("grid-distance-maths","8e91b07d8312acca5bcaef43e839f06a3b1d642a","src/geodesy.mjs","5a0320ca6db05273fae14f786b20223b088bc60b","canonical-geodesy.mjs"),
    ]
    receipts=[]
    for repo,rev,path,blob,name in sources:
        with urllib.request.urlopen(f"https://raw.githubusercontent.com/Ventusltd/{repo}/{rev}/{path}",timeout=30) as response:
            data=response.read(1000001)
        if len(data)>1000000 or hashlib.sha1(f"blob {len(data)}\0".encode()+data).hexdigest()!=blob:
            raise ValueError("upstream fixture integrity mismatch: "+name)
        (root/name).write_bytes(data)
        receipts.append({"repo":repo,"revision":rev,"path":path,"blob":blob,"sha256":hashlib.sha256(data).hexdigest(),"scope":"synthetic test only"})
    return receipts

def run(lock,head,out):
    started=time.monotonic();receipt={"schema_version":1,"integrator":head,"published_baseline":lock["published_baseline"],"lanes":lock["lanes"],"status":"FAIL","checks":[]}
    try:
        selected,owners=assemble(lock,head)
        with tempfile.TemporaryDirectory(prefix="satnav-trio-") as tmp:
            root=Path(tmp);files=[]
            for path,(_,oid) in sorted(selected.items()):
                data=git("cat-file","blob",oid)
                if hashlib.sha1(f"blob {len(data)}\0".encode()+data).hexdigest()!=oid:raise ValueError("blob mismatch: "+path)
                dest=root/safe_path(path);dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(data)
                files.append({"path":path,"agent":owners[path],"blob":oid,"sha256":hashlib.sha256(data).hexdigest(),"bytes":len(data)})
            receipt["files"]=files
            fixture_root=root/".asset-fixtures"
            receipt["upstream_fixtures"]=asset_fixtures(fixture_root)
            env={**os.environ,"SATNAV_UPSTREAM_FIXTURES":str(fixture_root)}
            commands=[["node","--test","nav/contracts.test.mjs"],["node","vendor/grid-distance-maths/test/verify.mjs"],["node","prototypes/terrain/cost-grid-builder.test.mjs"],["node","prototypes/terrain/asset-adapter.test.mjs"],["node","test/router-grid.test.mjs"],["node","test/router-contract.test.mjs"],["node","test/route-follower.test.mjs"],["node","automation/trio-smoke.mjs"],["node","--check","nav/app.mjs"]]
            for command in commands:
                t=time.monotonic()
                result=subprocess.run(command,cwd=root,env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,timeout=90)
                receipt["checks"].append({"command":command,"exit":result.returncode,"seconds":round(time.monotonic()-t,3),"tail":result.stdout[-4000:]})
                if result.returncode:raise RuntimeError("test failed: "+" ".join(command))
            receipt["status"]="PASS"
    except Exception as e:receipt["error"]=str(e)
    finally:
        receipt["seconds"]=round(time.monotonic()-started,3);out.parent.mkdir(parents=True,exist_ok=True);out.write_text(json.dumps(receipt,indent=2)+"\n",encoding="utf-8")
        print(json.dumps({k:v for k,v in receipt.items() if k!="files"},indent=2))
    return 0 if receipt["status"]=="PASS" else 1
def main():
    p=argparse.ArgumentParser();p.add_argument("--lock",type=Path,default=Path("automation/trio-lock.json"));p.add_argument("--integrator",required=True);p.add_argument("--out",type=Path,default=Path("trio-receipt.json"));a=p.parse_args()
    return run(json.loads(a.lock.read_text(encoding="utf-8")),a.integrator,a.out)
if __name__=="__main__":raise SystemExit(main())
