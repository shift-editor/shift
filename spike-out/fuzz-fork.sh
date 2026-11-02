#!/usr/bin/env bash
# Fuzzes the targets that crash at once for 10 minutes each, past known
# crashes (-fork with -ignore_crashes), to count distinct ones.
cd "$(dirname "$0")/../fuzz"
export PATH=$HOME/.cargo/bin:$PATH RUSTC_BOOTSTRAP=1
for target in glyphs opentype; do
  cargo fuzz run -O -s none --target-dir "$HOME/.cache/cargo-targets/shift/fuzz" "$target" "corpus/$target" -- \
    -max_total_time=600 -timeout=10 -rss_limit_mb=2048 -fork=3 -ignore_crashes=1 -ignore_timeouts=1 -ignore_ooms=1 \
    > "../spike-out/fuzz-fork-$target.log" 2>&1 &
done
wait
