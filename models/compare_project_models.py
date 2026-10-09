"""Compare m6A classifiers on m6Anet JSON + site labels.

Requires Python >=3.9, numpy, pandas, scikit-learn>=1.3, joblib.
Optional: xgboost. No read-level labels are invented.
JSON can be plain or gzip-compressed, with one JSON object per line.
Labels must be comma-separated: gene_id,transcript_id,transcript_position,label.

Example (Python):
    result = compare_models('data.json', 'data.info', output_dir='results/models')

Example (terminal):
    python compare_project_models.py --data data.json --labels data.info

All labelled, matched sites with >=min_reads are used. Each site's 9 read
features are summarised by mean, median, SD, 25th and 75th percentiles.
The 7-base context is one-hot encoded. Identifiers are never predictors.
Read count is reported but excluded from predictors to limit coverage confounding.
Models use fixed starter settings, NOT exhaustive hyperparameter optimisation.

First reserve ~20% of genes with GroupShuffleSplit. Compare models using
StratifiedGroupKFold on the remaining genes; select by mean CV PR AUC.
Evaluate ONLY the selected model on the reserved test genes, then refit that
model on all eligible labelled sites for subsequent unseen-data predictions.
Do not repeatedly tune using the reserved test score. This test does not
establish cross-cell-line generalisation.

Outputs: comparison.csv, cv_folds.csv, site_splits.csv, heldout_predictions.csv,
heldout_test_metrics.json, data_summary.json, run_config.json, selected_model.joblib.
PR AUC here is trapezoidal area; AP is separately reported. Confirm which
definition the course evaluation uses. Weighted-training scores need not be
calibrated probabilities; use independent calibration if that is required.
Run in your own project copy. Existing output files are never overwritten.
"""

import argparse
import gzip
import json
import time
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import sklearn
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import HistGradientBoostingClassifier, RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import auc, average_precision_score, precision_recall_curve, roc_auc_score
from sklearn.model_selection import GroupShuffleSplit, StratifiedGroupKFold
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler


def _open_text(path):
    path = Path(path).expanduser()
    return gzip.open(path, 'rt', encoding='utf-8') if path.suffix == '.gz' else path.open(encoding='utf-8')


def _position(value):
    value = str(value).strip()
    if not value.isdigit():
        raise ValueError(f'Invalid transcript position: {value!r}')
    return str(int(value))


def _load_sites(data_json, labels_csv, min_reads):
    with _open_text(labels_csv) as handle:
        labels = pd.read_csv(handle, dtype=str)
    required = ['gene_id', 'transcript_id', 'transcript_position', 'label']
    missing = set(required) - set(labels.columns)
    if missing:
        raise ValueError(f'Labels are missing columns: {sorted(missing)}')
    labels = labels[required].copy()
    for col in required:
        if labels[col].isna().any():
            raise ValueError(f'Missing values in label column {col}')
        labels[col] = labels[col].str.strip()
        if labels[col].eq('').any():
            raise ValueError(f'Empty values in label column {col}')
    if not labels['label'].isin(['0', '1']).all():
        raise ValueError('Site labels must be 0 or 1.')
    labels['transcript_position'] = labels['transcript_position'].map(_position)
    original_count = len(labels)
    labels = labels.drop_duplicates()
    if labels.duplicated(['transcript_id', 'transcript_position']).any():
        raise ValueError('A site has conflicting labels or gene IDs; resolve this before training.')
    labels['label'] = labels['label'].astype(int)
    lookup = {(r.transcript_id, r.transcript_position): (r.gene_id, r.label)
              for r in labels.itertuples(index=False)}
    rows, seen, matched = [], set(), set()
    unmatched_json = low_coverage = 0
    stats = ['mean', 'median', 'sd', 'q25', 'q75']
    with _open_text(data_json) as handle:
        for line_number, line in enumerate(handle, 1):
            if not line.strip():
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError as exc:
                raise ValueError(f'Invalid JSON on line {line_number}. Expected JSON objects, one per line.') from exc
            if not isinstance(obj, dict):
                raise ValueError(f'JSON line {line_number} must contain an object.')
            for transcript, positions in obj.items():
                if not isinstance(positions, dict):
                    raise ValueError(f'Invalid positions for {transcript}')
                for pos, contexts in positions.items():
                    key = (str(transcript), _position(pos))
                    if key in seen:
                        raise ValueError(f'Duplicate site in JSON: {key}. Merge replicates deliberately before use.')
                    seen.add(key)
                    if key not in lookup:
                        unmatched_json += 1
                        continue  # Unlabelled sites are not assumed to be negative.
                    matched.add(key)
                    if not isinstance(contexts, dict) or len(contexts) != 1:
                        raise ValueError(f'Expected exactly one sequence context at {key}')
                    context, reads = next(iter(contexts.items()))
                    context = str(context).upper().replace('U', 'T')
                    if len(context) != 7 or set(context) - set('ACGT'):
                        raise ValueError(f'Expected an unambiguous 7-base context at {key}: {context!r}')
                    try:
                        matrix = np.asarray(reads, dtype=float)
                    except (TypeError, ValueError) as exc:
                        raise ValueError(f'Invalid read measurements at {key}') from exc
                    if matrix.size == 0:
                        low_coverage += 1
                        continue
                    if matrix.ndim != 2 or matrix.shape[1] != 9 or not np.isfinite(matrix).all():
                        raise ValueError(f'Reads at {key} must be finite numbers with shape (n_reads, 9).')
                    if len(matrix) < min_reads:
                        low_coverage += 1
                        continue
                    summaries = [matrix.mean(axis=0), np.median(matrix, axis=0),
                                 matrix.std(axis=0), np.quantile(matrix, .25, axis=0),
                                 np.quantile(matrix, .75, axis=0)]
                    gene, label = lookup[key]
                    row = dict(gene_id=gene, transcript_id=key[0], transcript_position=int(key[1]),
                               label=label, n_reads=len(matrix), sequence=context)
                    row.update({f'f{j}_{stat}': float(values[j])
                                for stat, values in zip(stats, summaries) for j in range(9)})
                    rows.append(row)
            if line_number % 50000 == 0:
                print(f'Parsed {line_number:,} JSON lines; retained {len(rows):,} sites.', flush=True)
    if not rows:
        raise ValueError('No eligible sites match the labels. Check transcript IDs, positions, and file paths.')
    sites = pd.DataFrame(rows)
    summary = dict(json_sites=len(seen), unique_labelled_sites=len(labels),
                   identical_label_rows_removed=original_count - len(labels),
                   matched_labelled_sites=len(matched), unlabelled_json_sites_excluded=unmatched_json,
                   labelled_sites_missing_from_json=len(lookup) - len(matched),
                   matched_sites_below_min_reads=low_coverage, eligible_sites=len(sites),
                   eligible_genes=int(sites.gene_id.nunique()),
                   modified_sites=int(sites.label.sum()), unmodified_sites=int((sites.label == 0).sum()),
                   positive_fraction=float(sites.label.mean()),
                   reads_per_site=sites.n_reads.describe().to_dict())
    return sites, summary


def _scores(y, probability):
    if len(np.unique(y)) != 2:
        raise ValueError('Every evaluation split must contain both classes.')
    precision, recall, _ = precision_recall_curve(y, probability)
    return dict(roc_auc=float(roc_auc_score(y, probability)),
                pr_auc=float(auc(recall, precision)),
                average_precision=float(average_precision_score(y, probability)))


def _model(name, y_train, numeric_columns, seed, threads):
    if name == 'logistic_regression':
        estimator = LogisticRegression(class_weight='balanced', max_iter=2000, random_state=seed)
    elif name == 'random_forest':
        estimator = RandomForestClassifier(n_estimators=200, max_depth=12, min_samples_leaf=5,
                                          class_weight='balanced_subsample', n_jobs=threads, random_state=seed)
    elif name == 'hist_gradient_boosting':
        estimator = HistGradientBoostingClassifier(max_iter=200, max_leaf_nodes=15,
                     learning_rate=.05, l2_regularization=1, class_weight='balanced',
                     early_stopping=False, random_state=seed)
    elif name == 'xgboost':
        from xgboost import XGBClassifier
        negatives, positives = np.bincount(y_train, minlength=2)
        estimator = XGBClassifier(n_estimators=250, max_depth=4, learning_rate=.05,
                     subsample=.8, colsample_bytree=.8, reg_lambda=1, tree_method='hist',
                     objective='binary:logistic', eval_metric='logloss',
                     scale_pos_weight=float(negatives / positives), n_jobs=threads, random_state=seed)
    else:
        raise ValueError(f'Unknown model: {name}')
    numeric = Pipeline([('impute', SimpleImputer(strategy='median')),
                        ('scale', StandardScaler())])
    preprocess = ColumnTransformer([('numeric', numeric, numeric_columns),
                ('sequence', OneHotEncoder(handle_unknown='ignore', sparse_output=False), ['sequence'])])
    return Pipeline([('features', preprocess), ('classifier', estimator)])


def compare_models(data_json, labels_csv, output_dir='results/model_comparison', *,
                   folds=3, test_size=.2, min_reads=1, seed=42, threads=2):
    """Return comparison DataFrame, selected fitted model, and held-out metrics.

    See module docstring for input structure, split policy and output files.
    Uses all eligible labelled sites; never runs on unlabelled leaderboard data.
    Fits sequentially with limited CPU threads. Extraction streams reads, but the
    resulting site feature table and estimator must still fit in RAM.
    """
    from threadpoolctl import threadpool_limits
    if folds < 2 or min_reads < 1 or threads < 1 or not 0 < test_size < 1:
        raise ValueError('Require folds>=2, min_reads>=1, threads>=1 and 0<test_size<1.')
    out = Path(output_dir).expanduser()
    if out.exists() and any(out.iterdir()):
        raise FileExistsError(f'Output directory is not empty: {out}. Choose a new directory.')
    sites, summary = _load_sites(data_json, labels_csv, min_reads)
    numeric_columns = [c for c in sites.columns if c.startswith('f')]
    feature_columns = numeric_columns + ['sequence']
    X, y, groups = sites[feature_columns], sites.label.to_numpy(), sites.gene_id.to_numpy()
    if len(np.unique(y)) != 2 or len(np.unique(groups)) < folds + 1:
        raise ValueError('Need both classes and enough distinct genes for training, CV and test.')
    # Split once, before seeing any model scores. Do not search seeds for better scores.
    train_index, test_index = next(GroupShuffleSplit(n_splits=1, test_size=test_size,
                                      random_state=seed).split(X, y, groups))
    for idx in [train_index, test_index]:
        if len(np.unique(y[idx])) != 2:
            raise ValueError('A held-out split has one class. Need more labelled genes or a planned split policy.')
    X_train, y_train, g_train = X.iloc[train_index], y[train_index], groups[train_index]
    if len(np.unique(g_train)) < folds:
        raise ValueError('Not enough training genes for the requested folds.')
    cv = list(StratifiedGroupKFold(n_splits=folds, shuffle=True, random_state=seed)
              .split(X_train, y_train, g_train))
    for fit_idx, val_idx in cv:
        if len(np.unique(y_train[fit_idx])) != 2 or len(np.unique(y_train[val_idx])) != 2:
            raise ValueError('A CV fold has one class. Use fewer folds or gather more labelled genes.')
        assert not set(g_train[fit_idx]) & set(g_train[val_idx])
    assert not set(groups[train_index]) & set(groups[test_index])
    names = ['logistic_regression', 'random_forest', 'hist_gradient_boosting']
    try:
        import xgboost
        names.append('xgboost')
    except ImportError:
        print('XGBoost is not installed; skipping it. Install with: python -m pip install xgboost', flush=True)
    print(json.dumps(summary, indent=2), flush=True)
    records = []
    with threadpool_limits(limits=threads):
        for name in names:
            for fold, (fit_idx, val_idx) in enumerate(cv, 1):
                start = time.perf_counter()
                model = _model(name, y_train[fit_idx], numeric_columns, seed, threads)
                print(f'Training {name}: fold {fold}/{folds}', flush=True)
                model.fit(X_train.iloc[fit_idx], y_train[fit_idx])
                score = model.predict_proba(X_train.iloc[val_idx])[:, 1]
                records.append(dict(model=name, fold=fold, **_scores(y_train[val_idx], score),
                                    seconds=time.perf_counter()-start))
        fold_results = pd.DataFrame(records)
        comparison = fold_results.groupby('model').agg(
            cv_pr_auc_mean=('pr_auc', 'mean'), cv_pr_auc_sd=('pr_auc', 'std'),
            cv_roc_auc_mean=('roc_auc', 'mean'), cv_roc_auc_sd=('roc_auc', 'std'),
            cv_average_precision_mean=('average_precision', 'mean'),
            total_cv_seconds=('seconds', 'sum')).sort_values('cv_pr_auc_mean', ascending=False)
        winner = comparison.index[0]
        print('\nCV comparison:\n' + comparison.to_string(), flush=True)
        print(f'Chosen by CV PR AUC: {winner}. Evaluating once on reserved test genes.', flush=True)
        chosen = _model(winner, y_train, numeric_columns, seed, threads)
        chosen.fit(X_train, y_train)
        test_score = chosen.predict_proba(X.iloc[test_index])[:, 1]
        test_metrics = dict(selected_model=winner, **_scores(y[test_index], test_score),
                            test_sites=len(test_index), test_genes=int(len(np.unique(groups[test_index]))),
                            test_positive_fraction=float(y[test_index].mean()))
        print('Held-out test: ' + json.dumps(test_metrics), flush=True)
        # Final export is retrained on all sites only AFTER independent evaluation.
        final_model = _model(winner, y, numeric_columns, seed, threads)
        final_model.fit(X, y)
    out.mkdir(parents=True, exist_ok=True)
    comparison.to_csv(out / 'comparison.csv')
    fold_results.to_csv(out / 'cv_folds.csv', index=False)
    split_table = sites[['gene_id', 'transcript_id', 'transcript_position', 'label', 'n_reads']].copy()
    split_table['split'] = 'development'
    split_table.loc[test_index, 'split'] = 'heldout_test'
    split_table['cv_fold'] = -1
    for fold, (_, val_idx) in enumerate(cv, 1):
        split_table.loc[train_index[val_idx], 'cv_fold'] = fold
    split_table.to_csv(out / 'site_splits.csv', index=False)
    predictions = sites.iloc[test_index][['transcript_id', 'transcript_position', 'label']].copy()
    predictions['score'] = test_score
    predictions.to_csv(out / 'heldout_predictions.csv', index=False)
    versions = dict(numpy=np.__version__, pandas=pd.__version__, sklearn=sklearn.__version__)
    if 'xgboost' in names:
        versions['xgboost'] = xgboost.__version__
    config = dict(seed=seed, folds=folds, test_size_gene_fraction=test_size, min_reads=min_reads,
                  threads=threads, model_names=names, feature_columns=feature_columns,
                  feature_definition='9 read features: mean, median, population SD, q25, q75; one-hot 7mer',
                  selection_metric='mean CV trapezoidal PR AUC', versions=versions,
                  input_data=str(Path(data_json).expanduser().resolve()),
                  input_labels=str(Path(labels_csv).expanduser().resolve()))
    for filename, payload in [('data_summary.json', summary), ('run_config.json', config),
                              ('heldout_test_metrics.json', test_metrics)]:
        (out / filename).write_text(json.dumps(payload, indent=2), encoding='utf-8')
    joblib.dump(dict(pipeline=final_model, feature_columns=feature_columns,
                    config=config, selected_model=winner), out / 'selected_model.joblib')
    return dict(comparison=comparison, selected_model=final_model,
                heldout_metrics=test_metrics, data_summary=summary, output_dir=str(out))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--data', required=True, help='m6Anet data.json or JSON-lines .json.gz')
    parser.add_argument('--labels', required=True, help='CSV labels, e.g. data.info')
    parser.add_argument('--output', default='results/model_comparison')
    parser.add_argument('--folds', type=int, default=3)
    parser.add_argument('--min-reads', type=int, default=1)
    parser.add_argument('--threads', type=int, default=2)
    parser.add_argument('--seed', type=int, default=42)
    parser.add_argument('--test-size', type=float, default=.2)
    args = parser.parse_args()
    compare_models(args.data, args.labels, args.output, folds=args.folds,
                   min_reads=args.min_reads, threads=args.threads, seed=args.seed,
                   test_size=args.test_size)
