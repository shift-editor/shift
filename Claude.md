# Shift Editor - Development Guide

## General Guidelines

* Avoid adding comments unless absolutely neccessary.
* ALWAYS add tests to verify behaviour after completing a feature
* ALWAYS keep documentation up to date
* Consult the documentation and code together
* When finishing a feature check if it ticks off an item in the roadmap

## Package Manager

This project uses **pnpm** (v9.0.0) as its package manager.

## Available Commands

### Development
- `pnpm dev` - Start the Electron app in development mode
- `pnpm dev:app` - Start with watch mode

### Code Quality
- `pnpm format` - Format code with Prettier
- `pnpm format:check` - Check formatting without modifying files
- `pnpm lint` - Lint code with Oxlint (auto-fix)
- `pnpm lint:check` - Lint code without auto-fix
- `pnpm typecheck` - Type check with tsgo

### Testing
- `pnpm test` - Run tests once
- `pnpm test:watch` - Run tests in watch mode

### Building
- `pnpm build:native` - Build Rust native modules
- `pnpm build:native:debug` - Build native modules in debug mode
- `pnpm package` - Package the application
- `pnpm make` - Build and create distribution

### Maintenance
- `pnpm clean` - Clean build artifacts and node_modules
- `pnpm check-deps` - Check for unused dependencies

## Pre-commit Hooks
Husky runs the following checks before each commit:
1. `pnpm format` - Auto-format code
2. `pnpm lint` - Lint code
3. `pnpm typecheck` - Type check
4. `pnpm test` - Run tests

## Project Structure
- `/src` - Electron app source (main, preload, renderer)
- `/crates` - Rust workspace (shift-core, shift-node)
- `/packages` - TypeScript packages
