SHELL := /bin/sh

OUT_DIR ?= dist
TMP_DIR := $(OUT_DIR).tmp

.PHONY: dist dev mock-dev lint clean

dist:
	@set -eu; \
	build_cmd=""; \
	if command -v npm >/dev/null 2>&1; then \
		if [ ! -d node_modules ]; then \
			if [ -f package-lock.json ]; then npm ci; else npm install; fi; \
		fi; \
		build_cmd="npm run build --"; \
	elif command -v yarn >/dev/null 2>&1; then \
		if [ ! -d node_modules ]; then \
			if [ -f yarn.lock ]; then yarn install --frozen-lockfile; else yarn install; fi; \
		fi; \
		build_cmd="yarn run build --"; \
	else \
		echo "error: yarn or npm is required to build the UI" >&2; \
		exit 1; \
	fi; \
	rm -rf "$(TMP_DIR)"; \
	mkdir -p "$(TMP_DIR)"; \
	$$build_cmd --outDir "$(TMP_DIR)"; \
	rm -rf "$(OUT_DIR)"; \
	mv "$(TMP_DIR)" "$(OUT_DIR)";

dev:
	@set -eu; \
	if command -v npm >/dev/null 2>&1; then \
		if [ ! -d node_modules ]; then \
			if [ -f package-lock.json ]; then npm ci; else npm install; fi; \
		fi; \
		npm run dev; \
	elif command -v yarn >/dev/null 2>&1; then \
		if [ ! -d node_modules ]; then \
			if [ -f yarn.lock ]; then yarn install --frozen-lockfile; else yarn install; fi; \
		fi; \
		yarn run dev; \
	else \
		echo "error: yarn or npm is required to run the UI" >&2; \
		exit 1; \
	fi;

mock-dev:
	@set -eu; \
	if command -v npm >/dev/null 2>&1; then \
		if [ ! -d node_modules ]; then \
			if [ -f package-lock.json ]; then npm ci; else npm install; fi; \
		fi; \
		npm run dev -- --mode mock; \
	elif command -v yarn >/dev/null 2>&1; then \
		if [ ! -d node_modules ]; then \
			if [ -f yarn.lock ]; then yarn install --frozen-lockfile; else yarn install; fi; \
		fi; \
		yarn run dev -- --mode mock; \
	else \
		echo "error: yarn or npm is required to run the UI" >&2; \
		exit 1; \
	fi;

lint:
	@set -eu; \
	if command -v npm >/dev/null 2>&1; then \
		if [ ! -d node_modules ]; then \
			if [ -f package-lock.json ]; then npm ci; else npm install; fi; \
		fi; \
		npm run lint; \
	elif command -v yarn >/dev/null 2>&1; then \
		if [ ! -d node_modules ]; then \
			if [ -f yarn.lock ]; then yarn install --frozen-lockfile; else yarn install; fi; \
		fi; \
		yarn run lint; \
	else \
		echo "error: yarn or npm is required to lint the UI" >&2; \
		exit 1; \
	fi;

clean:
	rm -rf "$(OUT_DIR)" "$(TMP_DIR)"
