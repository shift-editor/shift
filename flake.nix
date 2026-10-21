{
  description = "Shift Editor development environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    rust-overlay.url = "github:oxalica/rust-overlay";
  };

  outputs = { nixpkgs, rust-overlay, ... }:
    let
      systems = [
        "aarch64-darwin"
        "aarch64-linux"
        "x86_64-darwin"
        "x86_64-linux"
      ];
    in
    {
      devShells = nixpkgs.lib.genAttrs systems (system:
        let
          pkgs = import nixpkgs {
            inherit system;
            overlays = [ (import rust-overlay) ];
          };

          rustToolchainToml = (builtins.fromTOML (builtins.readFile ./rust-toolchain.toml)).toolchain;
          rustToolchain = pkgs.rust-bin.stable.${rustToolchainToml.channel}.default.override {
            extensions = rustToolchainToml.components ++ [ "rust-analyzer" ];
            targets = rustToolchainToml.targets or [ ];
          };

          pnpm = pkgs.writeShellScriptBin "pnpm" ''
            export COREPACK_ENABLE_DOWNLOAD_PROMPT="0"
            export COREPACK_HOME="''${COREPACK_HOME:-''${XDG_CACHE_HOME:-$HOME/.cache}/corepack}"
            exec ${pkgs.nodejs_24}/bin/corepack pnpm "$@"
          '';

          commonPackages = with pkgs; [
            # Builds crates/shift-wasm; wasm-bindgen-cli must match the
            # wasm-bindgen crate version in Cargo.lock exactly. wasm-opt
            # comes from @shift/wasm's binaryen devDependency.
            wasm-bindgen-cli
            # Runs Rust test binaries in parallel for the pre-push hook.
            cargo-nextest
            # Check dependency licenses and advisories (deny.toml), and
            # dependencies no code uses. CI installs the same versions.
            cargo-deny
            cargo-machete
            cmake
            git
            nodejs_24
            pkg-config
            pnpm
            python3
            rustToolchain
            sqlite
          ];

          linuxPackages = with pkgs; lib.optionals stdenv.hostPlatform.isLinux [
            alsa-lib
            at-spi2-atk
            cups
            dbus
            fluxbox
            gtk3
            nss
            xvfb-run
            libx11
            libxscrnsaver
            libxtst
            libxkbfile
          ];

          darwinPackages = with pkgs; lib.optionals stdenv.hostPlatform.isDarwin [
            libiconv
          ];
        in
        {
          default = pkgs.mkShell {
            packages = commonPackages ++ linuxPackages ++ darwinPackages;

            shellHook = ''
              export COREPACK_ENABLE_DOWNLOAD_PROMPT="0"
              echo "Shift dev shell: node $(node --version), pnpm $(pnpm --version), rustc $(rustc --version)"
            '';
          };
        });
    };
}
