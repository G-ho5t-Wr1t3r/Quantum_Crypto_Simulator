# The interface: built with Node, served by nginx.
#
# Two stages, because the toolchain is only needed to produce the bundle. What
# ships is a few hundred kilobytes of static files behind a web server, not a
# Node runtime with a build tree attached.

FROM node:22-alpine AS build

WORKDIR /app

# `npm ci` rather than `npm install`: it installs exactly what the lockfile
# says, so the image cannot quietly acquire a different dependency tree than the
# one that was tested.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build


FROM nginx:1.27-alpine

# nginx also terminates /api, so the browser sees one origin in the container
# exactly as it does behind the dev proxy — which is why the client carries no
# base URL and cannot be pointed at the wrong backend.
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
