# The editor as a container: nginx with the built web bundle in it.
#
#   docker run --rm -p 8080:80 ghcr.io/scm-js/scm-js:latest    # then http://localhost:8080
#
# It copies a bundle that was **already built** rather than running `npm ci && vite build`
# in a stage of its own. Two reasons, and they are the same reason twice:
#
#   * The release workflow has built and tested that exact bundle already (it is the
#     `scmJS-web.zip` the release carries). Building it again here would ship an image
#     nothing had run the tests against.
#   * The contents are static files — the same bytes on every architecture. With no `RUN`
#     step, `--platform linux/amd64,linux/arm64` costs one manifest and no emulation; a
#     node build stage would need QEMU and minutes per architecture to produce identical
#     output.
#
# So: `npm run build` first (or `npm run build:image`, which does both). `.dockerignore`
# is what keeps Blizzard's extracted game data out of the context — `vite build` copies
# `public/` into `dist/`, and a clone that ran `npm run extract` has it there.
FROM nginx:1.29-alpine

LABEL org.opencontainers.image.title="scmJS" \
      org.opencontainers.image.description="A StarCraft: Brood War map editor that runs in a browser tab." \
      org.opencontainers.image.source="https://github.com/scm-js/scm-js" \
      org.opencontainers.image.licenses="MIT"

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY dist/ /usr/share/nginx/html/

EXPOSE 80
