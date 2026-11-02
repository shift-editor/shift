#!/usr/bin/env bash
# Runs every fuzz target for 10 minutes at once, from the fuzz crate. No
# sanitizer: the ASan runtime of Rust 1.93 hangs in its init on macOS 26.
cd "$(dirname "$0")/../fuzz"
export PATH=$HOME/.cargo/bin:$PATH RUSTC_BOOTSTRAP=1
for target in glif glyphs designspace opentype proof_text; do
  cargo fuzz run -O -s none --target-dir "$HOME/.cache/cargo-targets/shift/fuzz" "$target" "corpus/$target" -- \
    -max_total_time=600 -timeout=10 -rss_limit_mb=2048 -print_final_stats=1 \
    > "../spike-out/fuzz-$target.log" 2>&1 &
done
wait
