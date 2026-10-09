# =============================================================================
# Red Alerts - local dev Makefile
# =============================================================================
# `make setup`             -> build everything locally (.venv + node/python deps)
#
# `make serve dev`         -> run the app with .env.dev   (dev cloud DB)
# `make serve qa`          -> run the app with .env.qa    (qa  cloud DB)
# `make serve prod`        -> run the app with .env.prod  (prod cloud DB)
# add `local` AFTER any env to use that env's LOCAL db instead (it is a
# modifier, not a command of its own), e.g.
#   `make serve dev local` / `make serve qa local` / `make serve prod local`
#
# `ONLY=api`  -> only the API (no poller)     `ONLY=worker` -> only the poller
#     e.g. `make serve dev ONLY=api`
#
# --- Deploy (same targets are used locally AND by GitHub Actions) ------------
# `make push-docker dev`   -> build+push the worker image to ECR (keeps last 5)
# `make deploy dev`        -> cdk deploy using .env.dev / CI env (cloud DB)
# `make release dev`       -> push-docker then deploy (one shot)
# `make bootstrap dev`     -> one-time cdk bootstrap for the account/region
#   (swap `dev` for `qa` / `prod`)
#
# Per-environment config lives in gitignored .env.<env> files, each holding both
# DATABASE_URL_CLOUD (deployed/cloud DB) and DATABASE_URL_LOCAL (your local DB),
# plus the deploy values (AWS_ACCOUNT_ID, CERT_ARN, VPC_ID, WAF_WEB_ACL_ARN, ...).
# WAF_WEB_ACL_ARN is optional (empty -> no WAF on CloudFront). In CI those
# come from GitHub secrets/vars (the same names) instead of a file. Python deps
# install into a project-local .venv, NEVER your global Python. AWS credentials
# come from your ambient AWS CLI session (aws sso login) / OIDC - not here.
# =============================================================================

.DEFAULT_GOAL := help

# --- Pick the environment + DB from the words on the command line -----------
# (parsed here so the matching .env.<env> file can be included below).
ENV ?= dev
ifneq ($(filter dev,$(MAKECMDGOALS)),)
  ENV := dev
endif
ifneq ($(filter qa,$(MAKECMDGOALS)),)
  ENV := qa
endif
ifneq ($(filter prod,$(MAKECMDGOALS)),)
  ENV := prod
endif

# `local` word -> use the LOCAL db url; otherwise the CLOUD one. `local` is a
# MODIFIER on an env, never standalone: it must be paired with dev/qa/prod.
DB_MODE := cloud
ifneq ($(filter local,$(MAKECMDGOALS)),)
  ifeq ($(filter dev qa prod,$(MAKECMDGOALS)),)
    $(error 'local' is a modifier - pick an env too, e.g. `make serve qa local`)
  endif
  DB_MODE := local
endif

# --- TEMPORARY: production-only deploys + schema sync -----------------------
# Until we have a working product we run a SINGLE environment: prod. The deploy
# AND schema-sync targets (bootstrap / push-docker / deploy / release / sync)
# are intentionally blocked unless `prod` is named explicitly, so we can NEVER
# accidentally deploy, push or sync against dev/qa (this also catches a bare
# `make deploy`, which would otherwise fall back to the dev default). Local
# `serve` is untouched: `make serve dev local` etc. still work for development.
#
# TO RE-ENABLE dev/qa later (when wiring up the extra branches): comment out the
# two `$(error ...)` lines below (or delete this whole block). After that,
# `make sync dev local` / `make deploy qa` / ... work exactly like before.
PROD_ONLY_GOALS := bootstrap push-docker deploy release sync destroy
ifneq ($(filter $(PROD_ONLY_GOALS),$(MAKECMDGOALS)),)
  ifeq ($(filter prod,$(MAKECMDGOALS)),)
    $(error Deploys + sync are production-only for now. Name prod explicitly, e.g. `make sync prod local` / `make deploy prod` / `make release prod` / `make push-docker prod` / `make bootstrap prod`. dev/qa are disabled - see the TEMPORARY block in the Makefile to re-enable.)
  endif
endif

# Load the selected environment file (silently skipped if it doesn't exist yet).
-include .env.$(ENV)

# Choose which database url this run connects to. Use `:=` (not `?=`) so an
# ambient DATABASE_URL in your shell can NEVER silently win over the env/DB you
# picked here. A command-line override (`make serve dev DATABASE_URL=...`) still
# takes precedence, since command-line vars beat makefile assignments.
ifeq ($(DB_MODE),local)
  DATABASE_URL := $(DATABASE_URL_LOCAL)
else
  DATABASE_URL := $(DATABASE_URL_CLOUD)
endif

# --- Config (env file wins; these are fallbacks; override inline too) --------
# Per-env topic for parity with the deployed name (red-alerts-<env>-alerts).
IOT_TOPIC  ?= red-alerts-$(ENV)-alerts
AWS_REGION ?= il-central-1
API_PORT   ?= 8000

# Optional knobs for `make geocode` (city coordinate backfill). Exported below so
# the python process picks them up from the environment (cross-platform).
LIMIT    ?=
INTERVAL ?=
RESET    ?=

# --- Deploy config ----------------------------------------------------------
# Image tag = current git short-sha so every push rolls the worker forward
# (immutable tag -> ECS redeploys). Falls back to "latest" outside a git repo.
IMAGE_TAG := $(shell git rev-parse --short HEAD)
ifeq ($(IMAGE_TAG),)
  IMAGE_TAG := latest
endif

# ECR repository for the worker image. Per-env so each stack has its own repo;
# must match the CDK name `resourceName(this, ECR.WORKER_REPO)` = red-alerts-<env>-worker.
ECR_REPO     := red-alerts-$(ENV)-worker
ECR_REGISTRY := $(AWS_ACCOUNT_ID).dkr.ecr.$(AWS_REGION).amazonaws.com
ECR_IMAGE    := $(ECR_REGISTRY)/$(ECR_REPO)

# Context passed to `cdk deploy`. Values come from .env.<env> locally or from
# CI env (GitHub secrets/vars). Deploy always targets the CLOUD database.
CDK_CONTEXT := \
  -c env="$(ENV)" \
  -c account="$(AWS_ACCOUNT_ID)" \
  -c certArn="$(CERT_ARN)" \
  -c databaseUrl="$(DATABASE_URL_CLOUD)" \
  -c vpcId="$(VPC_ID)" \
  -c subnetIds="$(SUBNET_IDS)" \
  -c dbSecurityGroupId="$(DB_SECURITY_GROUP_ID)" \
  -c domain="$(APP_DOMAIN)" \
  -c hostedZone="$(HOSTED_ZONE)" \
  -c imageTag="$(IMAGE_TAG)" \
  -c webAclArn="$(WAF_WEB_ACL_ARN)"

# Project-local virtual environment. PYTHON creates it (your global python);
# VENV_PY is the interpreter INSIDE it. Bin dir differs Windows vs POSIX.
PYTHON ?= python
VENV   := .venv
ifeq ($(OS),Windows_NT)
  VENV_PY := $(VENV)\Scripts\python.exe
else
  VENV_PY := $(VENV)/bin/python
endif

# Exported so the python processes (app code + boto3) inherit them. These also
# propagate to the parallel sub-make below, so its run-* recipes use this run's
# environment (not a freshly defaulted one).
export DATABASE_URL
export IOT_TOPIC
export AWS_REGION
export LIMIT
export INTERVAL
export RESET
# Shared business code lives in layer/python; the API package dir is added by
# uvicorn's --app-dir below.
export PYTHONPATH := layer/python

# Which instances `make serve` starts. ONLY=api or ONLY=worker narrows it down.
SERVICES := run-worker run-api
ifeq ($(ONLY),api)
  SERVICES := run-api
endif
ifeq ($(ONLY),worker)
  SERVICES := run-worker
endif

.PHONY: help setup serve dev qa prod local run-api run-worker publish-test sync \
        geocode bootstrap push-docker deploy release

help:
	@echo Red Alerts - local dev
	@echo   make setup            build everything locally [.venv + deps]
	@echo   make serve dev        run with .env.dev   [dev cloud DB]
	@echo   make serve qa         run with .env.qa    [qa cloud DB]
	@echo   make serve prod       run with .env.prod  [prod cloud DB]
	@echo   add 'local' after any env for that env's LOCAL DB
	@echo   e.g. make serve dev local / make serve qa local / make serve prod local
	@echo   add ONLY=api or ONLY=worker to limit to one instance
	@echo   e.g. make serve dev ONLY=api
	@echo .
	@echo   make publish-test prod   fire a synthetic alert to IoT [test browser push]
	@echo                          e.g. make publish-test prod CITY="שלומי"
	@echo .
	@echo   Schema sync [Sequelize-style: diffs models -^> DB, applies in place]:
	@echo   make sync prod local   make the DB match the models [no migration files]
	@echo                        [sync is prod-only for now; dev/qa disabled like deploys]
	@echo .
	@echo   make geocode prod local  backfill coordinates for ALL cities [Nominatim, paced]
	@echo                          e.g. make geocode prod local LIMIT=500 / RESET=1
	@echo .
	@echo Deploy [PROD ONLY for now - dev/qa are temporarily disabled]:
	@echo   make push-docker prod build+push worker image to ECR [keeps last 5]
	@echo   make deploy prod      cdk deploy prod [cloud DB]
	@echo   make release prod     push-docker then deploy
	@echo   make bootstrap prod   one-time cdk bootstrap

# Build everything needed to run locally (into .venv, not global python).
# uvicorn (local API server) + boto3 (worker IoT publish) are local-only extras:
# in the cloud they come from the Lambda runtime / worker container image.
setup:
	npm install
	$(PYTHON) -m venv $(VENV)
	$(VENV_PY) -m pip install --upgrade pip
	$(VENV_PY) -m pip install -r resources/dependencies_layers/common-layer/requirements.txt uvicorn boto3

# Run the app: start the selected instances in parallel.
# We pass DATABASE_URL explicitly to the sub-make as a COMMAND-LINE variable.
# That matters because the recursive make below no longer sees the `dev/qa/prod`
# and `local` words (they're not in its MAKECMDGOALS), so it would otherwise
# recompute DATABASE_URL back to the CLOUD default. A command-line variable
# outranks the makefile's own `:=` assignment, so the env/DB you picked here
# (e.g. the LOCAL tunnel URL) is the one the worker + API actually use.
serve:
	"$(MAKE)" -j2 DATABASE_URL="$(DATABASE_URL)" $(SERVICES)

# Environment/DB selector words - no-ops on their own; they only tune the run
# above (see the parsing at the top). Use them as `make serve <word>`.
# `@cd .` is a silent cross-platform no-op (avoids "Nothing to be done").
dev qa prod local:
	@cd .

# --- Individual instances (run inside .venv) ---
# GEO_ADMIN_ENABLED mounts the local-only geocoding correction tool (Part of the
# admin routes). It is set ONLY here, so it is never on in the deployed Lambda.
run-api: export GEO_ADMIN_ENABLED := 1
run-api:
	$(VENV_PY) -m uvicorn api:app --app-dir resources/lambda/api --reload --port $(API_PORT)

run-worker:
	$(VENV_PY) app/worker/worker.py

# Fire ONE synthetic alert to the IoT broadcast topic so you can test the live
# browser push without waiting for a real Oref alert. Publishes to the REAL AWS
# IoT topic (needs AWS creds), so name the env to select the matching topic:
#   make publish-test prod                       # default city
#   make publish-test prod CITY="תל אביב - מרכז העיר"
CITY ?=
publish-test:
	$(VENV_PY) app/dev/publish_test_event.py "$(CITY)"

# Sync the selected DB to the models (Sequelize `sync({alter:true})` style):
# diffs Base.metadata against the live schema and applies the changes in place -
# create tables, add columns, add/drop indexes, etc. No migration files. Manual
# only (the worker never syncs on boot). Additive by default: it never drops a
# table/column unless you opt in. Pick an env (+`local` for the tunnel), e.g.
#   `make sync prod local`  /  `make sync prod`
sync:
	$(VENV_PY) app/sync_db.py

# Backfill coordinates for EVERY city in the selected DB, paced to respect
# Nominatim's ~1 req/sec policy. Uses the same shared geocoding_controller as the
# worker thread. Drains all cities with NULL coordinates; RESET=1 first clears
# every city so even already-resolved ones are looked up again. Pick an env
# (+`local` for the tunnel), e.g.
#   `make geocode prod local`  /  `make geocode prod local LIMIT=500`  /  RESET=1
geocode:
	$(VENV_PY) app/geocode_cities.py

# =============================================================================
# Deploy targets (use as `make <target> <env>`, e.g. `make deploy prod`).
# Credentials come from your ambient AWS session locally / OIDC in CI.
# =============================================================================

# One-time per account+region: provisions the CDK toolkit stack. `cdk bootstrap`
# still synthesizes the app, so we pass the SAME context as `deploy` (all from
# .env.$(ENV)) just to satisfy the app's required-context checks in
# bin/red-alerts.ts. The bootstrap stack itself is env-agnostic (account+region).
bootstrap:
	@echo "Bootstrapping aws://$(AWS_ACCOUNT_ID)/$(AWS_REGION) ..."
	@npx cdk bootstrap aws://$(AWS_ACCOUNT_ID)/$(AWS_REGION) $(CDK_CONTEXT)

# Build the ARM64 worker image and push it to ECR. Ensures the repo + a
# "keep last 5 images" lifecycle policy exist (idempotent), then buildx builds
# and pushes both the git-sha tag and `latest`. The first describe call prints a
# "not found" error the first time - that is expected (the `||` then creates it).
push-docker:
	aws ecr get-login-password --region $(AWS_REGION) | docker login --username AWS --password-stdin $(ECR_REGISTRY)
	aws ecr describe-repositories --repository-names $(ECR_REPO) --region $(AWS_REGION) --query "repositories[0].repositoryName" --output text || aws ecr create-repository --repository-name $(ECR_REPO) --image-scanning-configuration scanOnPush=true --region $(AWS_REGION)
	aws ecr put-lifecycle-policy --repository-name $(ECR_REPO) --region $(AWS_REGION) --lifecycle-policy-text file://resources/ecr-lifecycle.json
	docker buildx build --platform linux/arm64 -f app/worker/Dockerfile -t $(ECR_IMAGE):$(IMAGE_TAG) -t $(ECR_IMAGE):latest --push .

# Deploy the stack for the selected env (always uses the CLOUD database url).
# The recipe is silenced with `@` so make never echoes the expanded command -
# CDK_CONTEXT carries the databaseUrl (with password), so echoing it would leak
# the secret into terminal / GitHub Actions logs. CDK's own progress still shows.
deploy:
	@echo "Deploying $(ENV) stack ..."
	@npx cdk deploy --require-approval never $(CDK_CONTEXT)

# Convenience: push the image, then deploy referencing that exact tag.
release:
	$(MAKE) push-docker $(ENV) IMAGE_TAG=$(IMAGE_TAG)
	$(MAKE) deploy $(ENV) IMAGE_TAG=$(IMAGE_TAG)

# Tear down the stack for the selected env. Passes the same context as `deploy`
# (cdk synthesizes the app even for destroy, so the app's required-context checks
# in bin/red-alerts.ts must be satisfied). DESTRUCTIVE - prod-only guarded.
destroy:
	@echo "Destroying $(ENV) stack ..."
	@npx cdk destroy --force $(CDK_CONTEXT)
