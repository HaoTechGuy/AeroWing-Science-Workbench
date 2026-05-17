#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KB="$ROOT/bin/kb"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
export PYTHONDONTWRITEBYTECODE=1

cd "$TMP"

"$KB" init --path .research-kb --json > init.json
python3 - <<'PY'
import json
payload = json.load(open('init.json'))
assert payload['ok'] is True
assert payload['command'] == 'kb init'
assert 'kb.yaml' in payload['data']['created']
assert payload['data']['git_initialized'] is True
PY

"$KB" status --kb-path .research-kb --json > status.json
python3 - <<'PY'
import json
payload = json.load(open('status.json'))
assert payload['ok'] is True
assert payload['data']['branch'] == 'main'
assert payload['data']['config_valid'] is True
assert payload['repo']['default_branch'] == 'main'
PY

"$KB" schema --json > schema.json
"$KB" schema commands --json > schema-commands.json
"$KB" schema domain --json > schema-domain.json
"$KB" doctor --skip-kb --json > doctor-runtime.json
mkdir -p "$TMP/bootstrap-empty"
(cd "$TMP/bootstrap-empty" && "$KB" bootstrap --json > "$TMP/bootstrap-no-repo.json")
"$KB" bootstrap --repo "$TMP/bootstrap-url.git" --json > bootstrap-with-repo.json
python3 - <<'PY'
import json
schema = json.load(open('schema.json'))
commands = json.load(open('schema-commands.json'))
domain = json.load(open('schema-domain.json'))
doctor = json.load(open('doctor-runtime.json'))
bootstrap_no_repo = json.load(open('bootstrap-no-repo.json'))
bootstrap_with_repo = json.load(open('bootstrap-with-repo.json'))
assert schema['ok'] is True
assert 'commands' in schema['data']
assert 'domain.append' in commands['data']['commands']
assert 'root' in domain['data']['domain_schema']
assert doctor['ok'] is True
assert doctor['data']['ok'] is True
assert bootstrap_no_repo['data']['status'] == 'needs_repo_url'
assert any(action['actor'] == 'user' for action in bootstrap_no_repo['data']['actions'])
assert bootstrap_with_repo['data']['status'] == 'ready_to_attach'
assert any(action['id'] == 'attach_kb_repo' for action in bootstrap_with_repo['data']['actions'])
PY

"$KB" config validate --kb-path .research-kb --json > validate.json
python3 - <<'PY'
import json
payload = json.load(open('validate.json'))
assert payload['ok'] is True
assert payload['data']['valid'] is True
assert payload['data']['diagnostics'] == []
PY

"$KB" config get --kb-path .research-kb --json > config.json
python3 - <<'PY'
import json
payload = json.load(open('config.json'))
assert payload['ok'] is True
assert payload['data']['effective']['version'] == 1
assert payload['data']['effective']['repo']['default_branch'] == 'main'
assert 'domains' in payload['data']['effective']
assert 'collaboration' in payload['data']['effective']
PY

"$KB" domain list --kb-path .research-kb --json > domains.json
python3 - <<'PY'
import json
payload = json.load(open('domains.json'))
names = {domain['name'] for domain in payload['data']['domains']}
assert {'handbook', 'projects', 'experiments', 'seminars'} <= names
PY

"$KB" domain schema experiments --kb-path .research-kb --json > domain-schema.json
python3 - <<'PY'
import json
payload = json.load(open('domain-schema.json'))
assert payload['ok'] is True
assert payload['data']['name'] == 'experiments'
assert payload['data']['schema']['root'] == 'experiments/'
assert 'project' in payload['data']['schema']['required_fields']
PY

python3 - <<'PY'
from pathlib import Path
import yaml

config_path = Path('.research-kb/kb.yaml')
config = yaml.safe_load(config_path.read_text())
config['domains']['ideas'] = {
    'root': 'ideas/',
    'description': 'Free-form research ideas',
    'path_template': '{slug}.md',
    'required_fields': ['title'],
    'optional_fields': ['tags'],
    'frontmatter': {'type': 'idea'},
}
config_path.write_text(yaml.safe_dump(config, sort_keys=False, allow_unicode=True))
PY

"$KB" config validate --kb-path .research-kb --json > validate-custom-domain.json
python3 - <<'PY'
import json
payload = json.load(open('validate-custom-domain.json'))
assert payload['ok'] is True
assert payload['data']['valid'] is True
PY

"$KB" domain append --kb-path .research-kb --domain ideas --field title="Cross agent retrieval notes" --json > idea-append.json
python3 - <<'PY'
import json
from pathlib import Path
payload = json.load(open('idea-append.json'))
assert payload['ok'] is True
assert payload['data']['domain'] == 'ideas'
assert payload['data']['created_path'] == 'ideas/cross-agent-retrieval-notes.md'
assert Path('.research-kb/ideas/cross-agent-retrieval-notes.md').exists()
PY

"$KB" domain list-records --kb-path .research-kb --domain ideas --json > idea-records.json
python3 - <<'PY'
import json
payload = json.load(open('idea-records.json'))
records = payload['data']['records']
assert len(records) == 1
assert records[0]['path'] == 'ideas/cross-agent-retrieval-notes.md'
assert records[0]['frontmatter']['type'] == 'idea'
PY

set +e
"$KB" domain append --kb-path .research-kb --domain ideas --json > missing-field.json
code=$?
set -e
test "$code" -eq 9
python3 - <<'PY'
import json
payload = json.load(open('missing-field.json'))
assert payload['ok'] is False
assert payload['error']['code'] == 'KB_DOMAIN_FIELD_REQUIRED'
PY

mkdir -p .research-kb/handbook/compute
cat > .research-kb/handbook/compute/slurm.md <<'MD'
# Slurm

Use slurm for scheduled GPU jobs.

Request A100 nodes through the gpu partition.
MD

"$KB" tree --kb-path .research-kb --domain handbook --max-depth 3 --json > tree.json
python3 - <<'PY'
import json
payload = json.load(open('tree.json'))
assert payload['data']['domain'] == 'handbook'
paths = {entry['path'] for entry in payload['data']['entries']}
assert 'handbook/compute/slurm.md' in paths
PY

"$KB" grep slurm --kb-path .research-kb --domain handbook --context 1 --limit 5 --json > grep.json
python3 - <<'PY'
import json
payload = json.load(open('grep.json'))
assert payload['ok'] is True
assert payload['data']['domain'] == 'handbook'
assert payload['data']['results'][0]['path'] == 'handbook/compute/slurm.md'
assert 'slurm' in payload['data']['results'][0]['snippet']
PY

"$KB" read handbook/compute/slurm.md --kb-path .research-kb --range 1:3 --json > read.json
python3 - <<'PY'
import json
payload = json.load(open('read.json'))
assert payload['ok'] is True
assert payload['data']['line_start'] == 1
assert payload['data']['line_end'] == 3
assert '# Slurm' in payload['data']['content']
PY

"$KB" attach --path .research-kb --json > attach.json
"$KB" status --json > attached-status.json
python3 - <<'PY'
import json
payload = json.load(open('attached-status.json'))
assert payload['ok'] is True
assert payload['data']['attachment']['mode'] == 'ignored-subrepo'
assert payload['data']['attachment']['path'] == '.research-kb'
PY

set +e
"$KB" config validate --kb-path missing --json > missing.json
code=$?
set -e
test "$code" -eq 3
python3 - <<'PY'
import json
payload = json.load(open('missing.json'))
assert payload['ok'] is False
assert payload['error']['code'] == 'KB_REPO_NOT_FOUND'
PY

BOOT="$TMP/bootstrap"
mkdir -p "$BOOT"
git init --bare --initial-branch=main "$BOOT/empty-kb.git" >/dev/null
mkdir -p "$BOOT/project"
cd "$BOOT/project"
"$KB" attach --repo "$BOOT/empty-kb.git" --path .research-kb --clone --init-if-missing --json > bootstrap-attach.json
python3 - <<'PY'
import json
from pathlib import Path
payload = json.load(open('bootstrap-attach.json'))
assert payload['ok'] is True
assert payload['data']['cloned'] is True
assert payload['data']['initialized'] is True
assert Path('.research-kb/kb.yaml').exists()
assert Path('.kb-attachment.json').exists()
PY
"$KB" config validate --json > bootstrap-validate.json
"$KB" domain list --json > bootstrap-domains.json
python3 - <<'PY'
import json
validate = json.load(open('bootstrap-validate.json'))
domains = json.load(open('bootstrap-domains.json'))
assert validate['ok'] is True
assert validate['data']['valid'] is True
names = {domain['name'] for domain in domains['data']['domains']}
assert 'experiments' in names
assert 'handbook' in names
PY

git -C .research-kb config user.email "kb-test@example.com"
git -C .research-kb config user.name "KB Test"
git -C .research-kb add .
git -C .research-kb commit -m "Initialize KB" >/dev/null
"$KB" sync status --fetch --json > sync-status-initial.json
python3 - <<'PY'
import json
payload = json.load(open('sync-status-initial.json'))
data = payload['data']
assert payload['ok'] is True
assert data['remote_url'].endswith('empty-kb.git')
assert data['branch'] == 'main'
assert data['ahead'] is None or data['ahead'] >= 0
assert data['dirty']['clean'] is True
PY

"$KB" sync push --dry-run --json > sync-push-main-dry-run.json
python3 - <<'PY'
import json
payload = json.load(open('sync-push-main-dry-run.json'))
assert payload['ok'] is True
assert payload['data']['dry_run'] is True
assert payload['data']['before']['branch'] == 'main'
PY

"$KB" sync push --json > sync-push-main.json
python3 - <<'PY'
import json
payload = json.load(open('sync-push-main.json'))
assert payload['ok'] is True
assert payload['data']['dry_run'] is False
assert payload['data']['after']['ahead'] == 0
PY

git -C .research-kb checkout -b changes/smoke-sync >/dev/null 2>&1
"$KB" domain append --domain handbook --field title="Sync branch note" --json > sync-note.json
git -C .research-kb add .
git -C .research-kb commit -m "Add sync branch note" >/dev/null
"$KB" sync push --dry-run --json > sync-push-branch-dry-run.json
python3 - <<'PY'
import json
payload = json.load(open('sync-push-branch-dry-run.json'))
assert payload['ok'] is True
assert payload['data']['dry_run'] is True
assert payload['data']['before']['branch'] == 'changes/smoke-sync'
PY
"$KB" sync push --json > sync-push-branch.json
python3 - <<'PY'
import json
payload = json.load(open('sync-push-branch.json'))
assert payload['ok'] is True
assert payload['data']['after']['branch'] == 'changes/smoke-sync'
PY

cd "$BOOT"
git clone "$BOOT/empty-kb.git" second-kb >/dev/null 2>&1
mkdir -p second-project
cd second-project
"$KB" attach --path ../second-kb --json > second-attach.json
"$KB" sync status --fetch --json > second-sync-status.json
python3 - <<'PY'
import json
payload = json.load(open('second-sync-status.json'))
assert payload['ok'] is True
assert payload['data']['behind'] == 0
assert payload['data']['dirty']['clean'] is True
PY
git -C "$BOOT/project/.research-kb" checkout main >/dev/null 2>&1
mkdir -p "$BOOT/project/.research-kb/handbook"
echo "remote update" > "$BOOT/project/.research-kb/handbook/remote.md"
git -C "$BOOT/project/.research-kb" add handbook/remote.md
git -C "$BOOT/project/.research-kb" commit -m "Add remote handbook note" >/dev/null
"$KB" --version >/dev/null
git -C "$BOOT/project/.research-kb" push origin main >/dev/null 2>&1
"$KB" sync status --fetch --json > second-behind.json
python3 - <<'PY'
import json
payload = json.load(open('second-behind.json'))
assert payload['ok'] is True
assert payload['data']['behind'] == 1
PY
"$KB" sync pull --json > second-pull.json
python3 - <<'PY'
import json
from pathlib import Path
payload = json.load(open('second-pull.json'))
assert payload['ok'] is True
assert payload['data']['after']['behind'] == 0
assert Path('../second-kb/handbook/remote.md').exists()
PY

printf 'kb CLI smoke tests passed\n'
