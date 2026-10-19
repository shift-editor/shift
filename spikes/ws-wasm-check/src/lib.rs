#[unsafe(no_mangle)]
pub extern "C" fn open() -> i32 { rusqlite::Connection::open_in_memory().map(|c| c.execute_batch("create table t(x); insert into t values (1);").is_ok() as i32).unwrap_or(-1) }
