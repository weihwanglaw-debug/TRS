"""Maintain the local TRS architecture index. Requires Git, Python 3.10+ and Graphify."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "graphify-out"
HEAD = OUT / "current.json"
PRODUCTS = ("graph.json", "manifest.json", "GRAPH_REPORT.md", "graph.html")
EXTENSIONS = {".ts", ".tsx", ".js", ".jsx", ".cs", ".csproj", ".sql"}
SKIP = {"bin", "obj", "dist", "build", "node_modules", "wwwroot", "data", "temp",
        "tmp", "generated", "secrets", "credentials", "coverage", "graphify-out"}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def inputs():
    raw = subprocess.check_output(
        ["git", "ls-files", "-co", "--exclude-standard", "-z", "--", "Frontend/src", "Backend"],
        cwd=ROOT)
    result = {}
    for name in sorted(set(raw.decode("utf-8").split("\0")) - {""}):
        path = ROOT / name
        parts = {p.lower() for p in Path(name).parts}
        if (path.suffix.lower() not in EXTENSIONS or SKIP & parts or not path.is_file()
                or any(p in {"test", "tests", "__tests__"} or p.endswith("tests") for p in parts)
                or ".test." in path.name or ".spec." in path.name):
            continue
        if path.resolve() != path or any(p.startswith(".") for p in parts):
            continue
        result[name] = digest(path)
    if not result:
        raise ValueError("No TRS implementation files found.")
    return result


def read(path):
    return json.loads(path.read_text(encoding="utf-8"))


def tool():
    found = shutil.which("graphify") or Path.home() / ".local/bin/graphify.exe"
    if not Path(found).is_file():
        raise ValueError("Graphify executable missing. Check the uv tool installation.")
    return str(found)


def load():
    if not HEAD.exists():
        return {}, None
    state = read(HEAD)
    if state["slot"] not in ("a", "b"):
        raise ValueError("Invalid graph generation pointer.")
    return state, OUT / state["slot"]


def intact(state, folder):
    return folder is not None and all(
        (folder / f).is_file() and digest(folder / f) == state["outputs"].get(f)
        for f in PRODUCTS)


def run(exe, args, cwd):
    subprocess.run([exe, *args], cwd=cwd, env={**os.environ, "PYTHONUTF8": "1"}, check=True)


def build(files, state, previous, version, exe):
    with tempfile.TemporaryDirectory(dir=OUT) as tmp:
        corpus = Path(tmp)
        dest = corpus / "graphify-out"
        dest.mkdir()
        indexed = {name for name in files if Path(name).suffix.lower() != ".sql"}
        for name in sorted(indexed):
            target = corpus / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT / name, target)
            if digest(target) != files[name]:
                raise ValueError("Source changed while copying. Retry sync.")
        if (intact(state, previous) and state.get("version") == version
                and state.get("helper") == digest(Path(__file__))):
            for f in ("graph.json", "manifest.json"):
                shutil.copyfile(previous / f, dest / f)
        run(exe, ["extract", ".", "--code-only", "--max-workers", "2"], corpus)
        run(exe, ["cluster-only", ".", "--no-label"], corpus)
        graph = read(dest / "graph.json")
        ids = {n["id"] for n in graph["nodes"]}
        edges = graph["links"]
        if not ids or not edges or any(e[k] not in ids for e in edges for k in ("source", "target")):
            raise ValueError("Graph integrity check failed.")
        manifest = read(dest / "manifest.json")
        if set(manifest) != indexed:
            raise ValueError(f"Graphify input coverage mismatch: {sorted(set(manifest) ^ indexed)}")
        if any(not entry.get("ast_hash") for entry in manifest.values()):
            raise ValueError("Graphify left an indexed file pending extraction.")
        report = dest / "GRAPH_REPORT.md"
        summary = report.read_text(encoding="utf-8")
        start = summary.index("## Graph Freshness")
        end = summary.index("\n## ", start + 3)
        summary = summary[:start] + (
            "## Graph Freshness\n\nRun `python tools/graphify_trs.py check` in TRS. "
            "The baseline includes uncommitted implementation files.\n"
        ) + summary[end:]
        report.write_text(summary.replace("# Graph Report - " + corpus.name, "# TRS Graph Report", 1),
                          encoding="utf-8")
        if any(not (dest / f).stat().st_size for f in PRODUCTS):
            raise ValueError("Graphify produced an empty output.")
        if inputs() != files:
            raise ValueError("Source changed during extraction. Retry sync.")
        slot = "b" if state.get("slot") == "a" else "a"
        target = OUT / slot
        target.mkdir(exist_ok=True)
        for f in PRODUCTS:
            os.replace(dest / f, target / f)
        baseline = dict(slot=slot, files=files, outputs={f: digest(target / f) for f in PRODUCTS},
                        version=version, helper=digest(Path(__file__)))
        pointer = corpus / "current.json"
        pointer.write_text(json.dumps(baseline, indent=2), encoding="utf-8")
        os.replace(pointer, HEAD)
        print(f"Verified {len(files)} files, {len(ids)} nodes and {len(edges)} edges: {target}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["check", "sync", "path"])
    action = parser.parse_args().action
    # Windows releases this byte-range lock even if extraction or the shell dies.
    if action == "sync":
        import msvcrt
        OUT.mkdir(exist_ok=True)
        lock = (OUT / "sync.lock").open("a+b")
        msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
    state, folder = load()
    files = inputs()
    exe = tool()
    version = subprocess.check_output([exe, "--version"], text=True).strip()
    current = (state.get("files") == files and state.get("version") == version
               and state.get("helper") == digest(Path(__file__)) and intact(state, folder))
    if current:
        print(folder / "graph.json" if action == "path" else f"Current: {folder}")
        return 0
    if action != "sync":
        print("Graph stale or missing. Run python tools/graphify_trs.py sync.", file=sys.stderr)
        return 2
    build(files, state, folder, version, exe)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, ValueError, KeyError, subprocess.CalledProcessError) as error:
        sys.exit(f"Graphify: {error}")
