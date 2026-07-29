#!/bin/sh
set -eu

case "${APP_ROLE:-web}" in
  web)
    exec node server.js
    ;;
  worker)
    exec node scripts/worker.mjs
    ;;
  migrate)
    exec node scripts/migrate.mjs
    ;;
  *)
    echo "APP_ROLE inválido: ${APP_ROLE}. Use web, worker ou migrate." >&2
    exit 1
    ;;
esac
