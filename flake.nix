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
          };

          pnpm = pkgs.writeShellScriptBin "pnpm" ''
            export COREPACK_ENABLE_DOWNLOAD_PROMPT="0"
            export COREPACK_HOME="''${COREPACK_HOME:-''${XDG_CACHE_HOME:-$HOME/.cache}/corepack}"
            exec ${pkgs.nodejs_24}/bin/corepack pnpm "$@"
          '';

          commonPackages = with pkgs; [
            cmake
            git
            nodejs_24
            pkg-config
            pnpm
            python3
            rustToolchain
          ];

          linuxPackages = with pkgs; lib.optionals stdenv.hostPlatform.isLinux [
            alsa-lib
            at-spi2-atk
            cups
            dbus
            gtk3
            nss
            xorg.libX11
            xorg.libXScrnSaver
            xorg.libXtst
            xorg.libxkbfile
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
