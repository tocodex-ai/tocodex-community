import pathlib
import re

root = pathlib.Path("packages/types/src")
pattern = re.compile(r'(?P<path>(?:\.\.?/|\.)(?:[\w\-./]+?))\.js(?P<quote>["\'])')

def replace_in_file(path: pathlib.Path) -> int:
    text = path.read_text(encoding="utf-8")
    new_text, count = pattern.subn(r"\g<path>.ts\g<quote>", text)
    if count:
        path.write_text(new_text, encoding="utf-8")
    return count

total = 0
for path in sorted(root.rglob("*.ts")):
    count = replace_in_file(path)
    if count:
        print(f"Updated {path.relative_to(root.parent)} ({count} replacements)")
        total += count

print(f"Total replacements: {total}")