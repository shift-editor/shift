extern crate napi_build;

fn main() {
  napi_build::setup();

  #[cfg(target_os = "macos")]
  {
    println!("cargo:rustc-link-arg=-undefined");
    println!("cargo:rustc-link-arg=dynamic_lookup");
  }
}
