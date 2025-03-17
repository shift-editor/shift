#!/usr/bin/env bash

rm -rf node_modules
rm -rf .turbo

rm -rf app/desktop/node_modules
rm -rf app/desktop/.turbo
rm -rf app/desktop/dist

cargo clean
