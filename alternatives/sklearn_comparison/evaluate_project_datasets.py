"""Apply dataset0-trained classifiers to other m6Anet datasets.

Requires compare_project_models.py in the same folder, and numpy, pandas,
scipy, scikit-learn>=1.3, joblib, xgboost. Python >=3.9.

Prediction only (no labels needed):
    python evaluate_project_datasets.py predict --model selected_model.joblib \
        --data dataset1.json.gz --output dataset1_predictions.csv

Compare four models trained ONLY on dataset0:
    python evaluate_project_datasets.py compare \
        --train-data dataset0.json.gz --train-labels data.info.labelled \
        --test-data dataset1.json.gz dataset2.json.gz \
        --test-labels data.info data2.info --output results/external_comparison

All sites are predicted. CSV prediction files have exactly transcript_id,
transcript_position,score. Scores are site-ranking outputs, not modification
fractions or necessarily calibrated probabilities. No threshold is imposed.
Labels are joined only for evaluation, never passed to predictors.
For fractional label values, binary metrics use ONLY exact 0 and 1 labels;
intermediate values remain in predictions and descriptive score summaries.
Labels such as 0.25 are not silently converted to positive/negative classes.
The meaning of fractional labels must be confirmed from dataset documentation.
Shared site IDs between training and evaluation are reported explicitly.
No gene IDs are fabricated for anonymised transcripts.
"""

import argparse
import json
import os
import tempfile
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from scipy.stats import spearmanr
from threadpoolctl import threadpool_limits

from compare_project_models import _load_sites, _model, _open_text, _position, _scores


def _write_csv(frame, path):
    """Publish each complete CSV atomically after a successful write."""
    path = Path(path)
    descriptor, temporary = tempfile.mkstemp(prefix=path.name+'.', suffix='.tmp', dir=path.parent)
    os.close(descriptor)
    try:
        frame.to_csv(temporary,index=False)
        os.replace(temporary,path)
    finally:
        Path(temporary).unlink(missing_ok=True)


def load_features(data_json):
    """Extract the exact same 45 numeric summaries + sequence as training."""
    rows, seen = [], set()
    with _open_text(data_json) as handle:
        for line_number, line in enumerate(handle, 1):
            if not line.strip():
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError as exc:
                raise ValueError(f'Invalid JSON on line {line_number}; expected JSON objects, one per line.') from exc
            if not isinstance(obj, dict):
                raise ValueError(f'JSON line {line_number} must be an object.')
            for tx, positions in obj.items():
                if not isinstance(positions, dict):
                    raise ValueError(f'Invalid positions for {tx}')
                for pos, contexts in positions.items():
                    key = (str(tx), int(_position(pos)))
                    if key in seen:
                        raise ValueError(f'Duplicate site: {key}. Merge replicates deliberately before use.')
                    seen.add(key)
                    if not isinstance(contexts, dict) or len(contexts) != 1:
                        raise ValueError(f'Expected one sequence context at {key}')
                    context, reads = next(iter(contexts.items()))
                    context = str(context).upper().replace('U', 'T')
                    if len(context) != 7 or set(context) - set('ACGT'):
                        raise ValueError(f'Expected an unambiguous 7-base sequence at {key}')
                    matrix = np.asarray(reads, dtype=float)
                    if matrix.ndim != 2 or matrix.shape[1] != 9 or len(matrix) == 0 or not np.isfinite(matrix).all():
                        raise ValueError(f'Reads at {key} must be nonempty, finite, and shaped (n_reads, 9).')
                    summaries = [matrix.mean(axis=0), np.median(matrix, axis=0), matrix.std(axis=0),
                                 np.quantile(matrix, .25, axis=0), np.quantile(matrix, .75, axis=0)]
                    row = dict(transcript_id=key[0], transcript_position=key[1], n_reads=len(matrix), sequence=context)
                    row.update({f'f{j}_{stat}':float(values[j])
                                for stat, values in zip(['mean','median','sd','q25','q75'], summaries)
                                for j in range(9)})
                    rows.append(row)
            if line_number % 50000 == 0:
                print(f'{Path(data_json).name}: parsed {line_number:,} lines', flush=True)
    if not rows:
        raise ValueError('No sites found.')
    return pd.DataFrame(rows)


def read_labels(path):
    with _open_text(path) as handle:
        labels = pd.read_csv(handle, dtype={'transcript_id':str, 'transcript_position':str})
    required = ['transcript_id', 'transcript_position', 'label']
    if set(required) - set(labels):
        raise ValueError(f'Labels require {required}')
    if labels[required].isna().any().any():
        raise ValueError('Missing label or site identifier.')
    labels['transcript_id'] = labels.transcript_id.str.strip()
    if labels.transcript_id.eq('').any():
        raise ValueError('Empty transcript ID.')
    labels['transcript_position'] = labels.transcript_position.map(_position).astype(int)
    labels['label'] = pd.to_numeric(labels.label, errors='raise')
    if not np.isfinite(labels.label).all() or not labels.label.between(0,1).all():
        raise ValueError('Labels must be finite numbers between 0 and 1.')
    if labels.duplicated(['transcript_id','transcript_position']).any():
        raise ValueError('Duplicate labelled site IDs.')
    return labels


def predict_dataset(model_file, data_json, output_csv, threads=2):
    """Predict every site in unlabelled JSON using one exported model."""
    output = Path(output_csv).expanduser()
    if output.exists():
        raise FileExistsError(f'Refusing to overwrite {output}')
    if threads < 1:
        raise ValueError('threads must be >=1')
    saved = joblib.load(Path(model_file).expanduser())
    sites = load_features(data_json)
    with threadpool_limits(limits=threads):
        scores = saved['pipeline'].predict_proba(sites[saved['feature_columns']])[:,1]
    predictions = sites[['transcript_id','transcript_position']].copy()
    predictions['score'] = scores
    output.parent.mkdir(parents=True,exist_ok=True)
    _write_csv(predictions,output)
    print(f'Predicted {len(predictions):,} sites -> {output}',flush=True)
    return predictions


def compare_external_datasets(train_json, train_labels, test_jsons, test_labels,
                              output_dir='results/external_comparison', threads=2,
                              pretrained_xgboost=None, seed=42):
    """Fit four models on dataset0 and evaluate labelled new datasets.

    pretrained_xgboost may point to the dataset0 full-fit selected_model.joblib.
    Its name, seed and feature definitions must match this training run.
    Use only if it was trained on these exact dataset0 inputs; provenance is the
    caller's responsibility. Without it, XGBoost is fitted from scratch.
    Model comparisons on the supplied evaluation data are exploratory. These
    evaluation results must not be described as an untouched final test if they
    inform later feature/model choices. Run on trusted model files only.
    """
    if len(test_jsons) != len(test_labels) or not test_jsons or threads < 1:
        raise ValueError('Provide one labels file per test JSON and threads>=1.')
    output = Path(output_dir).expanduser()
    if output.exists() and any(output.iterdir()):
        raise FileExistsError(f'Output folder is not empty: {output}')
    names = [Path(p).name.removesuffix('.gz').removesuffix('.json') for p in test_jsons]
    if len(set(names)) != len(names):
        raise ValueError('Test JSON basenames must be distinct.')
    training, training_summary = _load_sites(train_json,train_labels,1)
    numeric = [c for c in training if c.startswith('f')]
    features = numeric + ['sequence']
    train_keys = set(zip(training.transcript_id, training.transcript_position))
    train_transcripts = set(training.transcript_id)
    train_label_map = {(r.transcript_id,r.transcript_position):r.label
                       for r in training.itertuples(index=False)}
    output.mkdir(parents=True,exist_ok=True)
    metrics, grouped, audits = [], [], []
    datasets = []
    for name, json_path, label_path in zip(names,test_jsons,test_labels):
        sites = load_features(json_path)
        labels = read_labels(label_path)
        extra = labels.rename(columns={'n_reads':'metadata_n_reads'})
        merged = sites.merge(extra,on=['transcript_id','transcript_position'],how='left',validate='one_to_one')
        keys = list(zip(merged.transcript_id,merged.transcript_position))
        merged['shared_training_site'] = [key in train_keys for key in keys]
        merged['known_training_transcript'] = merged.transcript_id.isin(train_transcripts)
        old_labels = pd.Series([train_label_map.get(key,np.nan) for key in keys],index=merged.index)
        shared = merged.shared_training_site & merged.label.notna()
        audit = dict(dataset=name,json_sites=len(sites),metadata_sites=len(labels),
                     labels_matched=int(merged.label.notna().sum()),
                     json_sites_missing_labels=int(merged.label.isna().sum()),
                     metadata_sites_missing_json=len(labels)-int(merged.label.notna().sum()),
                     transcripts=int(sites.transcript_id.nunique()),
                     shared_training_sites=int(merged.shared_training_site.sum()),
                     new_site_ids=int((~merged.shared_training_site).sum()),
                     new_transcript_ids=int(sites.loc[~sites.transcript_id.isin(train_transcripts),'transcript_id'].nunique()),
                     shared_sites_with_different_labels=int((merged.loc[shared,'label']!=old_labels[shared]).sum()),
                     label_counts={str(k):int(v) for k,v in labels.label.value_counts().sort_index().items()},
                     reads_per_site=sites.n_reads.describe().to_dict(),
                     fractional_labels_present=bool((labels.label.notna() & ~labels.label.isin([0,1])).any()))
        if 'metadata_n_reads' in merged:
            audit['read_count_metadata_mismatches'] = int((merged.metadata_n_reads.notna() &
                (merged.metadata_n_reads!=merged.n_reads)).sum())
            if audit['read_count_metadata_mismatches']:
                raise ValueError(f'Read counts disagree with metadata for {name}')
        print('Dataset audit: '+json.dumps(audit),flush=True)
        audits.append(audit)
        datasets.append((name,merged))
    model_names = ['logistic_regression','random_forest','hist_gradient_boosting','xgboost']
    with threadpool_limits(limits=threads):
        for name in model_names:
            print(f'Fitting dataset0-only model: {name}',flush=True)
            if name=='xgboost' and pretrained_xgboost:
                saved = joblib.load(pretrained_xgboost)
                if saved['selected_model']!='xgboost' or saved['feature_columns']!=features or saved['config']['seed']!=seed:
                    raise ValueError('Pretrained model does not match the expected dataset0 model specification.')
                model = saved['pipeline']
            else:
                model = _model(name,training.label.to_numpy(),numeric,seed,threads)
                model.fit(training[features],training.label.to_numpy())
            joblib.dump(dict(pipeline=model,feature_columns=features,selected_model=name,
                             config=dict(seed=seed,trained_on=str(Path(train_json).resolve()),
                                         train_sites=len(training),train_genes=training.gene_id.nunique())),
                        output/f'{name}.joblib')
            for dataset, sites in datasets:
                scores = model.predict_proba(sites[features])[:,1]
                predictions = sites[['transcript_id','transcript_position']].copy()
                predictions['score'] = scores
                _write_csv(predictions,output/f'{dataset}_{name}_predictions.csv')
                detail = sites[['transcript_id','transcript_position','n_reads','label',
                                'shared_training_site','known_training_transcript']].copy()
                detail['score'] = scores
                _write_csv(detail,output/f'{dataset}_{name}_evaluation.csv')
                for value, group in detail.groupby('label'):
                    grouped.append(dict(dataset=dataset,model=name,label=float(value),sites=len(group),
                                        score_mean=float(group.score.mean()),score_median=float(group.score.median()),
                                        score_q25=float(group.score.quantile(.25)),score_q75=float(group.score.quantile(.75))))
                masks = {'binary_labels_only':detail.label.isin([0,1])}
                if not audits[names.index(dataset)]['fractional_labels_present']:
                    masks.update(shared_training_sites=detail.label.isin([0,1]) & detail.shared_training_site,
                                 new_site_ids=detail.label.isin([0,1]) & ~detail.shared_training_site)
                for subset, mask in masks.items():
                    part=detail.loc[mask]
                    row=dict(dataset=dataset,model=name,subset=subset,sites=len(part),
                             positive_fraction=float(part.label.mean()) if len(part) else None)
                    if part.label.nunique()==2:
                        row.update(_scores(part.label.astype(int),part.score))
                    else:
                        row.update(roc_auc=None,pr_auc=None,average_precision=None)
                    metrics.append(row)
                if audits[names.index(dataset)]['fractional_labels_present']:
                    part = detail.dropna(subset=['label'])
                    rho = float(spearmanr(part.label,part.score).statistic) if part.label.nunique()>1 and part.score.nunique()>1 else None
                    metrics.append(dict(dataset=dataset,model=name,subset='all_labels_descriptive',sites=len(part),
                                        label_score_spearman=rho))
    _write_csv(pd.DataFrame(metrics),output/'model_scores.csv')
    _write_csv(pd.DataFrame(grouped),output/'scores_by_label.csv')
    import sklearn,xgboost,scipy
    config=dict(seed=seed,threads=threads,train_data=str(Path(train_json).resolve()),
                train_labels=str(Path(train_labels).resolve()),test_jsons=[str(Path(p).resolve()) for p in test_jsons],
                test_labels=[str(Path(p).resolve()) for p in test_labels],
                feature_columns=features,models=model_names,pr_auc_definition='trapezoidal',
                binary_label_policy='exact 0 and 1 only; intermediate values retained in descriptive outputs',
                versions=dict(numpy=np.__version__,pandas=pd.__version__,sklearn=sklearn.__version__,
                              xgboost=xgboost.__version__,scipy=scipy.__version__))
    (output/'data_audit.json').write_text(json.dumps(dict(training=training_summary,evaluation=audits),indent=2))
    (output/'run_config.json').write_text(json.dumps(config,indent=2))
    print(pd.DataFrame(metrics).to_string(index=False),flush=True)
    return dict(metrics=pd.DataFrame(metrics),scores_by_label=pd.DataFrame(grouped),audits=audits,output_dir=str(output))


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__,formatter_class=argparse.RawDescriptionHelpFormatter)
    sub=parser.add_subparsers(dest='command',required=True)
    predict=sub.add_parser('predict')
    predict.add_argument('--model',required=True)
    predict.add_argument('--data',required=True)
    predict.add_argument('--output',required=True)
    predict.add_argument('--threads',type=int,default=2)
    compare=sub.add_parser('compare')
    compare.add_argument('--train-data',required=True)
    compare.add_argument('--train-labels',required=True)
    compare.add_argument('--test-data',nargs='+',required=True)
    compare.add_argument('--test-labels',nargs='+',required=True)
    compare.add_argument('--output',default='results/external_comparison')
    compare.add_argument('--threads',type=int,default=2)
    compare.add_argument('--pretrained-xgboost')
    args=parser.parse_args()
    if args.command=='predict':
        predict_dataset(args.model,args.data,args.output,args.threads)
    else:
        compare_external_datasets(args.train_data,args.train_labels,args.test_data,args.test_labels,
                                  args.output,args.threads,args.pretrained_xgboost)
