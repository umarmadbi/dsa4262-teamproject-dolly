#!/usr/bin/env python3
"""Create browser-friendly coverage CSV from m6Anet JSON, without a model.

python3 export_coverage.py --input data.json --sample SGNex_A549_directRNA_replicate6_run1 --output coverage.csv
Optional --gene-map CSV with transcript_id,gene_id and optional gene_name.
Uses only Python's standard library. Reads .json or .json.gz one object per line.
Preserves the original read-level JSON. Does not generate modification scores.
"""
import argparse
import csv
import gzip
import json
import math
import os
from pathlib import Path
import tempfile


def export_coverage(input_path, sample_id, output_path, gene_map_path=None):
    path, output = Path(input_path).expanduser(), Path(output_path).expanduser()
    if output.exists():
        raise FileExistsError(f'Refusing to overwrite {output}')
    if not sample_id.strip():
        raise ValueError('A sample identifier is required.')
    genes = {}
    if gene_map_path:
        with Path(gene_map_path).expanduser().open(newline='') as f:
            reader = csv.DictReader(f)
            if not {'transcript_id','gene_id'}.issubset(reader.fieldnames or []):
                raise ValueError('Gene mapping CSV requires transcript_id and gene_id.')
            for r in reader:
                value = (r['gene_id'],r.get('gene_name',''))
                if r['transcript_id'] in genes and genes[r['transcript_id']] != value:
                    raise ValueError('Conflicting gene annotation for '+r['transcript_id'])
                genes[r['transcript_id']] = value
    output.parent.mkdir(parents=True,exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=output.name+'.',suffix='.tmp',dir=output.parent)
    os.close(fd)
    seen = set(); count = 0
    try:
        opener = gzip.open if path.suffix == '.gz' else open
        with opener(path,'rt',encoding='utf-8') as source, open(temporary,'w',newline='') as dest:
            writer=csv.writer(dest)
            writer.writerow(['sample_id','transcript_id','transcript_position','n_reads','sequence','gene_id','gene_name','features_per_read'])
            for line_no,line in enumerate(source,1):
                if not line.strip(): continue
                obj=json.loads(line)
                if not isinstance(obj,dict): raise ValueError(f'Expected a JSON object on line {line_no}')
                for tx,positions in obj.items():
                    if not isinstance(positions,dict): raise ValueError(f'Invalid positions for {tx}')
                    for position,contexts in positions.items():
                        if not str(position).isdigit(): raise ValueError('Invalid transcript position')
                        pos=int(position); key=(tx,pos)
                        if key in seen: raise ValueError(f'Duplicate site: {key}')
                        seen.add(key)
                        if not isinstance(contexts,dict) or len(contexts)!=1: raise ValueError(f'Expected one sequence context at {key}')
                        sequence,reads=next(iter(contexts.items()))
                        if not isinstance(reads,list) or not reads or not isinstance(reads[0],list): raise ValueError(f'Invalid or missing reads at {key}')
                        width=len(reads[0])
                        if not width or any(not isinstance(r,list) or len(r)!=width for r in reads): raise ValueError(f'Inconsistent feature dimensions at {key}')
                        if any(isinstance(v,bool) or not isinstance(v,(int,float)) or not math.isfinite(v) for r in reads for v in r):
                            raise ValueError(f'Nonfinite or nonnumeric read feature at {key}')
                        gene,name=genes.get(tx,('',''))
                        writer.writerow([sample_id,tx,pos,len(reads),sequence,gene,name,width]); count+=1
        os.replace(temporary,output)
    finally:
        Path(temporary).unlink(missing_ok=True)
    print(f'Exported {count:,} candidate sites to {output}. No modification scores were generated.')
    return count


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__,formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--input',required=True)
    p.add_argument('--sample',required=True)
    p.add_argument('--output',required=True)
    p.add_argument('--gene-map')
    args=p.parse_args()
    export_coverage(args.input,args.sample,args.output,args.gene_map)
