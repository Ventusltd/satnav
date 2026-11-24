"""Read-only route regression runner. Writes JSON receipt even on test failure."""
import argparse
import hashlib
import json
import pathlib
import subprocess
import time


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--maths', required=True, type=pathlib.Path)
    p.add_argument('--out', required=True, type=pathlib.Path)
    p.add_argument('--root', default=pathlib.Path('.'), type=pathlib.Path)
    a = p.parse_args()
    root = a.root.resolve()
    maths = a.maths.resolve()
    receipt = {'schema': 'satnav.router.audit.v1', 'scope': 'synthetic-only', 'steps': [], 'status': 'FAIL'}
    try:
        raw = maths.read_bytes()
        blob = hashlib.sha1(b'blob ' + str(len(raw)).encode() + b'\0' + raw).hexdigest()
        receipt['maths_blob'] = blob
        if blob != '5a0320ca6db05273fae14f786b20223b088bc60b':
            raise ValueError('canonical maths blob mismatch')
        receipt['head'] = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True, timeout=10).strip()
        commands = [
            ['node', 'test/router-grid.test.mjs'],
            ['node', 'test/router-contract.test.mjs'],
            ['node', 'test/route-follower.test.mjs', str(maths)],
            ['node', 'test/route-benchmark.mjs', str(maths)],
        ]
        for cmd in commands:
            start = time.monotonic()
            step = {'command': cmd[:2]}
            receipt['steps'].append(step)
            try:
                result = subprocess.run(cmd, cwd=root, capture_output=True, text=True, timeout=90, check=False)
                step.update(exit_code=result.returncode, stdout=result.stdout[-16000:], stderr=result.stderr[-16000:])
                if cmd[1].endswith('benchmark.mjs') and result.returncode == 0:
                    step['benchmark'] = json.loads(result.stdout)
            except (OSError, subprocess.TimeoutExpired, ValueError) as exc:
                step.update(exit_code=-1, error=str(exc))
            finally:
                step['elapsed_ms'] = round((time.monotonic() - start) * 1000)
        if all(step['exit_code'] == 0 for step in receipt['steps']):
            receipt['status'] = 'PASS'
    except (OSError, subprocess.SubprocessError, ValueError) as exc:
        receipt['error'] = str(exc)
    finally:
        a.out.parent.mkdir(parents=True, exist_ok=True)
        a.out.write_text(json.dumps(receipt, indent=2) + '\n', encoding='utf-8')
    return 0 if receipt['status'] == 'PASS' else 1


if __name__ == '__main__':
    raise SystemExit(main())
