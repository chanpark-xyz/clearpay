# ClearPay — Next.js app + Maroo VP prover (marood) in one image.
# Build:  docker build -t clearpay .
# Run:    docker run -p 3000:3000 --env-file .env.local clearpay
FROM ubuntu:24.04 AS base
ARG TARGETARCH
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates jq tar git bash && rm -rf /var/lib/apt/lists/*
# Node 22 + pnpm
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs && npm i -g pnpm@10 && rm -rf /var/lib/apt/lists/*
# Foundry (cast)
RUN curl -L https://foundry.paradigm.xyz | bash && /root/.foundry/bin/foundryup -i stable >/dev/null 2>&1 || /root/.foundry/bin/foundryup >/dev/null 2>&1
ENV PATH="/root/.foundry/bin:${PATH}"

# marood v0.11.1 + VP proving bundle (verified SHA-256)
ENV VP_DIR=/opt/maroo
RUN mkdir -p $VP_DIR/bin $VP_DIR/artifacts $VP_DIR/calls $VP_DIR/keys $VP_DIR/client $VP_DIR/scripts $VP_DIR/eas && \
    case "$TARGETARCH" in \
      amd64) T=linux-amd64; SHA=6f525ecece54c4f9976ca19f0e71e83e2c6d39952d2f59ed0821e74ff86cbd0b;; \
      arm64) T=linux-arm64; SHA=95a458be3b634f5c7d13584f66c8d5a8607bab149af6ec283103c6bac66ddd18;; \
      *) echo "unsupported arch $TARGETARCH"; exit 1;; esac && \
    curl -fL --retry 3 "https://asset.delightlabs.io/maroo/release/marood-v0.11.1-$T.tar.gz" -o /tmp/marood.tar.gz && \
    echo "$SHA  /tmp/marood.tar.gz" | sha256sum -c - && \
    tar -xzf /tmp/marood.tar.gz -C $VP_DIR/bin marood && chmod 755 $VP_DIR/bin/marood && rm /tmp/marood.tar.gz && \
    curl -fL --retry 3 https://asset.delightlabs.io/maroo/release/maroo-v0.11-privacy-artifacts.tar.gz -o /tmp/artifacts.tar.gz && \
    echo "d652e914e2e64f8d82bfa7dcec365e7a039cf30c326c85d216422b97f934c659  /tmp/artifacts.tar.gz" | sha256sum -c - && \
    tar -xzf /tmp/artifacts.tar.gz -C $VP_DIR/artifacts && rm /tmp/artifacts.tar.gz
ENV PATH="$VP_DIR/bin:${PATH}"

# App
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN cp maroo/vp.sh $VP_DIR/scripts/vp.sh && chmod +x $VP_DIR/scripts/vp.sh maroo/*.sh && pnpm build

ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
EXPOSE 3000
CMD ["bash", "maroo/docker-entrypoint.sh"]
