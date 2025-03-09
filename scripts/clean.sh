#!/usr/bin/env bash

rm -rf node_modules
rm -rf .turbo

rm -rf ui/node_modules
rm -rf ui/.turbo
rm -rf ui/dist

cargo clean
