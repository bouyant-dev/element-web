# Copyright 2026 David
# SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-Element-Commercial
# Please see LICENSE in the repository root for full details.

FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY src ./src
RUN mkdir /data && chown node:node /data
USER node
ENV DATA_DIR=/data
CMD ["node", "src/main.ts"]
