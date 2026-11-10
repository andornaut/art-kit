# syntax=docker/dockerfile:1.25
FROM koalaman/shellcheck:v0.11.0 AS shellcheck

FROM node:24.21.0

RUN mkdir -p /opt/tools /opt/lint /opt/check && chown 19001:19001 /opt/tools /opt/lint
COPY --from=shellcheck /bin/shellcheck /usr/local/bin/shellcheck
COPY --chmod=0444 node/package.json /opt/package.json
COPY --chmod=0555 tests/container/check /opt/check/run
RUN ln -s /opt/tools/node_modules /deps
USER 19001:19001
ENV HOME=/tmp npm_config_cache=/tmp/npm-cache
WORKDIR /opt/tools
RUN node --input-type=module -e 'import { readFileSync, writeFileSync } from "node:fs"; const p = JSON.parse(readFileSync("/opt/package.json", "utf8")); writeFileSync("package.json", JSON.stringify({ private: true, dependencies: { ...p.devDependencies, ...p.peerDependencies } }));' \
    && npm install --ignore-scripts --no-audit --no-fund \
    && cd node_modules/skia-canvas \
    && node lib/prebuild.mjs download
WORKDIR /opt/lint
COPY --chmod=0444 tests/container/package.json tests/container/package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
ENV PATH=/opt/lint/node_modules/.bin:${PATH}
WORKDIR /work
ENTRYPOINT ["/opt/check/run"]
