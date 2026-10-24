import gzip, pathlib, sys, tarfile
source=pathlib.Path(sys.argv[1]);destination=pathlib.Path(sys.argv[2]);stamp=int(sys.argv[3])
with destination.open('wb') as raw:
 with gzip.GzipFile(filename='',mode='wb',fileobj=raw,mtime=0) as compressed:
  with tarfile.open(fileobj=compressed,mode='w',format=tarfile.USTAR_FORMAT) as archive:
   for path in [source,*sorted(source.rglob('*'))]:
    name=str(path.relative_to(source.parent))
    info=archive.gettarinfo(str(path),arcname=name)
    info.uid=info.gid=0;info.uname=info.gname='root';info.mtime=stamp
    info.mode=0o755 if path.is_dir() or path.suffix=='.sh' else 0o644
    if info.isfile():
     with path.open('rb') as contents:archive.addfile(info,contents)
    elif info.isdir():archive.addfile(info)
    else:raise ValueError('Unsupported archive entry')
