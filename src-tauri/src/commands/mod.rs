macro_rules! map_err_str {
    ($expr:expr, $fmt:literal $(, $args:expr )* $(,)?) => {
        $expr.map_err(|error| format!($fmt, $($args, )* error))
    };
}

pub mod context;
pub mod debug;
pub mod export;
pub mod fs;
pub mod path;
pub mod perf;
pub mod recovery;
pub mod shell;
pub mod state;
pub mod watch;
