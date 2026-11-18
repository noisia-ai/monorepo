#!/usr/bin/env python3
"""
wait-export.py: espera una exportación de la herramienta de escucha, la verifica y la archiva.

    python3 builders/wait-export.py --from 202609300000 [--to 202612110000] --expected 19795 \
        --dest <caso>/inputs/exports [--label MX_2025] [--manifest <caso>/inputs/exports/MANIFEST.tsv] \
        [--downloads ~/Downloads] [--timeout 600] [--tolerance 0.01] [--gzip]

Se corre en segundo plano justo después de pedir la exportación (SENTIONE.md §5). Reemplaza los
scripts de espera que cada caso escribió por su cuenta.

1. Espera a que en la carpeta de descargas no quede ningún .crdownload.
2. Elige el archivo por la ventana de su nombre (_from<AAAAMMDDhhmm>, y _to si se da), nunca por la
   hora de llegada: dos exports pedidos el mismo minuto llegaron en otro orden y cruzaron sus nombres.
   Si hay dos con la misma ventana, se detiene.
3. Espera a que su tamaño deje de cambiar.
4. Cuenta filas con lector CSV real (';', utf-8-sig, campos multilínea), no con wc -l.
5. Calcula el sha256, lo mueve a --dest (con la etiqueta delante si se da) y agrega una línea al
   manifiesto: archivo, etiqueta, ventana, esperado, filas, cuadra, bytes, sha256, hora UTC.

Salida: 0 si cuadra (o trae de más dentro de --tolerance: menciones indexadas durante el export),
1 si no cuadra, 2 si se acabó el tiempo, 3 si la ventana es ambigua. Solo biblioteca estándar.
"""
import argparse, csv, datetime, glob, gzip, hashlib, os, re, shutil, sys, time

POLL = 3


def candidates(folder, start, end):
    out = []
    for p in glob.glob(os.path.join(folder, "*.csv")):
        name = os.path.basename(p)
        if f"_from{start}" not in name:
            continue
        if end and f"_to{end}" not in name:
            continue
        out.append(p)
    return out


def pending(folder):
    return glob.glob(os.path.join(folder, "*.crdownload"))


def count_rows(path):
    csv.field_size_limit(10**9)
    with open(path, encoding="utf-8-sig", newline="") as f:
        return max(sum(1 for _ in csv.reader(f, delimiter=";")) - 1, 0)


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--from", dest="start", required=True, help="AAAAMMDDhhmm, como sale en el nombre")
    ap.add_argument("--to", dest="end", help="AAAAMMDDhhmm, exclusivo, como sale en el nombre")
    ap.add_argument("--expected", type=int, required=True, help="el contador de la vista antes de exportar")
    ap.add_argument("--dest", required=True)
    ap.add_argument("--label", default="")
    ap.add_argument("--manifest")
    ap.add_argument("--downloads", default=os.path.expanduser("~/Downloads"))
    ap.add_argument("--timeout", type=int, default=600, help="segundos")
    ap.add_argument("--tolerance", type=float, default=0.01, help="filas de más aceptadas, como fracción")
    ap.add_argument("--gzip", action="store_true", help="comprime el archivo archivado")
    a = ap.parse_args()

    for v, n in ((a.start, "--from"), (a.end, "--to")):
        if v and not re.fullmatch(r"\d{12}", v):
            sys.exit(f"{n} va como AAAAMMDDhhmm, igual que en el nombre del archivo")

    deadline = time.time() + a.timeout
    found, last_size = None, -1
    while time.time() < deadline:
        if not pending(a.downloads):
            c = candidates(a.downloads, a.start, a.end)
            if len(c) > 1:
                print("AMBIGUO: más de un archivo con esa ventana:", *map(os.path.basename, c), sep="\n  ")
                return 3
            if c:
                size = os.path.getsize(c[0])
                if size == last_size and size > 0:
                    found = c[0]
                    break
                last_size = size
        time.sleep(POLL)
    if not found:
        print(f"TIMEOUT: no llegó un archivo _from{a.start} en {a.timeout} s. No pidas otro encima: "
              "revisa la app y pide el mismo tramo.")
        left = pending(a.downloads)
        if left:
            print("Siguen descargas a medias; si alguna es vieja, bórrala con permiso:",
                  *map(os.path.basename, left), sep="\n  ")
        return 2

    rows = count_rows(found)
    digest = sha256(found)
    os.makedirs(a.dest, exist_ok=True)
    name = os.path.basename(found)
    target = os.path.join(a.dest, f"{a.label}__{name}" if a.label else name)
    if os.path.exists(target) or os.path.exists(target + ".gz"):
        print(f"YA EXISTE: {target}. No se sobrescribe; el archivo sigue en {found}")
        return 3
    if a.gzip:
        with open(found, "rb") as src, gzip.open(target + ".gz", "wb") as dst:
            shutil.copyfileobj(src, dst)
        os.remove(found)
        target += ".gz"
    else:
        shutil.move(found, target)

    extra = rows - a.expected
    ok = extra == 0 or (extra > 0 and extra <= max(1, round(a.expected * a.tolerance)))
    status = "OK" if extra == 0 else ("OK+" if ok else "MISMATCH")
    size = os.path.getsize(target)
    if a.manifest:
        new = not os.path.exists(a.manifest)
        with open(a.manifest, "a", encoding="utf-8") as m:
            if new:
                m.write("archivo\tetiqueta\tfrom\tto\tesperado\tfilas\testado\tbytes\tsha256\tarchivado_utc\n")
            m.write("\t".join(map(str, [os.path.basename(target), a.label, a.start, a.end or "",
                                        a.expected, rows, status, size, digest,
                                        datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")])) + "\n")
    print(f"{status}: {rows:,} filas contra {a.expected:,} esperadas ({extra:+,}). "
          f"{size / 1e6:.1f} MB → {target}")
    if status == "OK+":
        print("Filas de más: menciones indexadas entre el conteo y la descarga. Se anota (DATA.md §7).")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
