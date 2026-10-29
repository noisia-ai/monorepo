#!/usr/bin/env python3
"""
check-delivery.py — the gates of a data delivery, run on the files that are about to leave.

    python3 builders/check-delivery.py <dir-or-files…> \
        [--ref client_sample.csv] [--forbid names.txt] [--skip-cols Texto,Título] \
        [--network-col Fonte --type-col Tipo --date-col Data] [--fill-cols Autor,Seguidores] \
        [--manifest MANIFEST.csv] [--sep ';']

DATA_DELIVERY.md §7 lists the gates; this script runs the four that can be automated:

  I. Target schema. With --ref (the client's own export, or the partner's import template as
     CSV), every file must carry the same headers, in the same order. A file that does not is
     a failure: the client's system ingests by position or by name, and either breaks.
  J. Confidentiality. With --forbid (one string or /regex/ per line: the provider's name, its id
     prefixes, its export field names), nothing in a file name or a cell may match. Free-text
     columns can be skipped with --skip-cols, since a post may legitimately say anything.
  H. Monthly series by network and type. With --date-col and --network-col, rows per month per
     network (and per type, with --type-col), flagging a jump of more than 2x between
     consecutive months (above --min-flag rows), a network that appears or disappears, and a
     range of more than 4x across the full months, which catches a slow slide. Twice a client found a drop
     that was the collection, not the market; this is the table that catches it first.
  Fill. With --fill-cols, the share of rows that carry each column, by network and type. A
     global fill hides exactly what the client uses: one feed had author on 0.5% of Instagram.

And it writes the manifest the recipient verifies against: file, rows, columns, sha256.

Reads streaming, so a file of hundreds of MB is fine. Exit code 1 on a schema or
confidentiality failure; the series and fill tables are reported for a person to read.
"""
import argparse, collections, csv, glob, hashlib, os, re, sys

csv.field_size_limit(10**9)


def files_from(paths):
    out = []
    for p in paths:
        out += sorted(glob.glob(os.path.join(p, "**", "*.csv"), recursive=True)) if os.path.isdir(p) else [p]
    return out


def sniff_sep(path, default):
    if default:
        return default
    with open(path, encoding="utf-8-sig", newline="") as fh:
        head = fh.readline()
    return max([",", ";", "\t", "|"], key=head.count)


def header(path, sep):
    with open(path, encoding="utf-8-sig", newline="") as fh:
        return next(csv.reader(fh, delimiter=sep), [])


def patterns(path):
    pats = []
    for line in open(path, encoding="utf-8"):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if len(line) > 2 and line.startswith("/") and line.endswith("/"):
            pats.append(re.compile(line[1:-1], re.I))
        else:
            pats.append(re.compile(re.escape(line), re.I))
    return pats


def month(v):
    m = re.search(r"(\d{4})-(\d{2})", v or "") or re.search(r"(\d{1,2})[/.](\d{1,2})[/.](\d{4})", v or "")
    if not m:
        return None
    if len(m.groups()) == 2:
        return f"{m.group(1)}-{m.group(2)}"
    return f"{m.group(3)}-{int(m.group(2)):02d}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("paths", nargs="+")
    ap.add_argument("--ref"); ap.add_argument("--forbid"); ap.add_argument("--skip-cols", default="")
    ap.add_argument("--network-col"); ap.add_argument("--type-col"); ap.add_argument("--date-col")
    ap.add_argument("--fill-cols", default=""); ap.add_argument("--manifest"); ap.add_argument("--sep")
    ap.add_argument("--min-flag", type=int, default=50, help="no flag a jump between months under this count")
    a = ap.parse_args()

    files = files_from(a.paths)
    if not files:
        sys.exit("No hay CSV que revisar.")
    pats = patterns(a.forbid) if a.forbid else []
    skip = {c for c in a.skip_cols.split(",") if c}
    fill_cols = [c for c in a.fill_cols.split(",") if c]
    ref = header(a.ref, sniff_sep(a.ref, a.sep)) if a.ref else None
    failed, manifest = False, []

    for f in files:
        sep = sniff_sep(f, a.sep)
        name = os.path.basename(f)
        print(f"\n== {name}")
        h = header(f, sep)
        if ref is not None:
            if h == ref:
                print("  ✓ esquema idéntico al de referencia")
            else:
                failed = True
                missing = [c for c in ref if c not in h]
                extra = [c for c in h if c not in ref]
                print(f"  ✗ esquema distinto: faltan {missing[:8]}, sobran {extra[:8]}"
                      + ("" if missing or extra else ", mismo set en otro orden"))
        for p in pats:
            if p.search(name):
                failed = True
                print(f"  ✗ el nombre del archivo contiene «{p.pattern}»")
        sha = hashlib.sha256()
        with open(f, "rb") as fb:
            for chunk in iter(lambda: fb.read(1 << 20), b""):
                sha.update(chunk)
        rows, hits = 0, collections.Counter()
        series = collections.defaultdict(collections.Counter)
        nets_by_key = collections.Counter()
        filled = collections.defaultdict(collections.Counter)
        with open(f, encoding="utf-8-sig", newline="") as fh:
            for r in csv.DictReader(fh, delimiter=sep):
                rows += 1
                for k, v in r.items():
                    if pats and v and k not in skip:
                        for p in pats:
                            if p.search(v) or (k and p.search(k)):
                                hits[p.pattern] += 1
                key = " | ".join(x for x in (r.get(a.network_col or "", ""), r.get(a.type_col or "", "")) if x) or "todo"
                nets_by_key[key] += 1
                if a.date_col:
                    m = month(r.get(a.date_col))
                    if m:
                        series[key][m] += 1
                for c in fill_cols:
                    if (r.get(c) or "").strip() not in ("",):
                        filled[key][c] += 1
        manifest.append((name, rows, len(h), sha.hexdigest()))
        print(f"  filas {rows:,} · columnas {len(h)} · sha256 {sha.hexdigest()[:16]}…")
        if pats:
            if hits:
                failed = True
                for pat, n in hits.most_common():
                    print(f"  ✗ rastro del proveedor «{pat}» en {n:,} celdas o encabezados")
            else:
                print("  ✓ sin rastros del proveedor")
        if fill_cols:
            print("  llenado por red y tipo (%):")
            for key, n in nets_by_key.most_common():
                if n >= 20:
                    cells = " · ".join(f"{c} {100 * filled[key][c] / n:.0f}" for c in fill_cols)
                    print(f"    {key} (n={n:,}): {cells}")
        if a.date_col and series:
            print("  serie mensual por red y tipo (↯ = salto de más de 2x o red que aparece o desaparece):")
            months = sorted({m for s in series.values() for m in s})
            for key, s in sorted(series.items(), key=lambda kv: -sum(kv[1].values())):
                vals = [s.get(m, 0) for m in months]
                flags = []
                for i in range(1, len(vals)):
                    prev, cur = vals[i - 1], vals[i]
                    if max(prev, cur) < a.min_flag:
                        continue        # small counts jump by nature
                    if (prev == 0) != (cur == 0) or (prev and cur and max(prev, cur) / min(prev, cur) > 2):
                        flags.append(months[i])
                # A slow slide never jumps 2x in one month: compare the full months (edges are
                # usually partial) from top to bottom. One client found an 86% yearly drop this way.
                inner = [v for v in vals[1:-1] if v] if len(vals) > 3 else []
                span = f"   amplitud {max(inner) / min(inner):.0f}x" if inner and max(inner) >= a.min_flag \
                    and max(inner) / min(inner) > 4 else ""
                print(f"    {key}: " + " ".join(f"{m[2:]}:{v}" for m, v in zip(months, vals))
                      + (f"   ↯ {', '.join(flags)}" if flags else "") + span)

    if a.manifest:
        with open(a.manifest, "w", encoding="utf-8", newline="") as fh:
            w = csv.writer(fh)
            w.writerow(["archivo", "filas", "columnas", "sha256"])
            w.writerows(manifest)
        print(f"\nmanifiesto: {a.manifest}")
    print("\n" + ("HAY FALLAS: no se manda así." if failed else "Esquema y confidencialidad en orden. Lee la serie y el llenado antes de mandar."))
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
