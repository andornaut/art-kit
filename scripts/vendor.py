"""Install or verify an exact package payload without following destination symlinks."""

import shutil
import sys
from pathlib import Path


def sync(check, source, target):
    source, target = Path(source), Path(target)
    for parent in (target, *target.parents):
        if parent.is_symlink():
            raise ValueError(f"Vendor destination must not use symlinks: {parent}")
    expected = {p.relative_to(source): p for p in source.rglob("*") if p.is_file()}
    actual = {}
    if target.exists():
        for path in target.rglob("*"):
            if path.is_symlink():
                raise ValueError(f"Unexpected vendor symlink: {path}")
            if path.is_file():
                actual[path.relative_to(target)] = path
    extra = actual.keys() - expected.keys()
    if extra:
        raise ValueError(f"Unexpected vendor files require owner review: {sorted(map(str, extra))}")
    if check:
        different = [
            str(name)
            for name, path in expected.items()
            if name not in actual or actual[name].read_bytes() != path.read_bytes()
        ]
        if different:
            raise ValueError(f"Vendor payload differs: {different}")
    else:
        for name, path in expected.items():
            destination = target / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(path, destination)
    print(f"{'Verified' if check else 'Installed'} art-kit {target}")


if __name__ == "__main__":
    sync(sys.argv[1] == "true", sys.argv[2], sys.argv[3])
